-- olive_user_patterns
-- ─────────────────────────────────────────────────────────────────────
-- Phase 3.5 — pattern learning store. Records detected user behaviors
-- across reschedule actions so Olive can surface "you usually move
-- Tuesday tasks to Thursday — sure?" at offer time. This is one of
-- the compounding-moat features: hyperscalers can't replicate it
-- because they don't have per-user scoped memory tied to a private
-- offer loop.
--
-- This table grows slowly per user (one row per detected
-- (pattern_type, from→to) tuple), incremented every time the user
-- repeats the behavior. No raw-event log; the table IS the aggregate.
--
-- ROLLBACK (manual, if ever needed):
--   DROP TABLE IF EXISTS public.olive_user_patterns;

CREATE TABLE IF NOT EXISTS public.olive_user_patterns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         text NOT NULL,
  -- Pattern discriminator. Future variants (time_band_shift,
  -- duration_change, day-of-month-shift) live alongside without a
  -- schema change.
  pattern_type    text NOT NULL CHECK (pattern_type IN ('weekday_shift')),
  -- Per-pattern data. For weekday_shift: { from_dow: 2, to_dow: 4 }
  -- (Sun=0..Sat=6). Stored as jsonb so future pattern types don't need
  -- a new column.
  pattern_data    jsonb NOT NULL,
  -- Number of times this pattern has been observed.
  count           integer NOT NULL DEFAULT 1,
  -- Total reschedules of this user in the rolling window. Used to
  -- compute confidence (count / total_window) at lookup time so we
  -- don't surface "moved Tue→Thu 3 times" if they also moved
  -- Tue→Mon, Tue→Wed, Tue→Fri (count=3 but no real pattern).
  total_observations integer NOT NULL DEFAULT 1,
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  -- Hash of (pattern_type, pattern_data) for the unique constraint —
  -- jsonb doesn't have a natural uniqueness story across instances,
  -- so we store the canonical fingerprint and constrain on that.
  fingerprint     text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per (user, pattern_type, fingerprint). UPSERT-friendly.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_olive_user_patterns_fingerprint
  ON public.olive_user_patterns (user_id, pattern_type, fingerprint);

-- Lookup index for the planner — "any strong patterns for this user
-- in this pattern_type?" Most reads filter by user_id and pattern_type,
-- so a compound index is the right shape. ORDER BY count DESC is fast
-- with a partial-or-trailing column; we keep it simple.
CREATE INDEX IF NOT EXISTS idx_olive_user_patterns_user_type
  ON public.olive_user_patterns (user_id, pattern_type, count DESC);

-- updated_at trigger — match the existing baseline convention.
DROP TRIGGER IF EXISTS olive_user_patterns_updated_at ON public.olive_user_patterns;
CREATE TRIGGER olive_user_patterns_updated_at
  BEFORE UPDATE ON public.olive_user_patterns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────
-- SELECT scoped to the owning user (so a future "what does Olive know
-- about me?" page can render these); writes service-role only. Same
-- posture as olive_calendar_sync_log + olive_calendar_sync_queue.
ALTER TABLE public.olive_user_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY olive_user_patterns_select_own
  ON public.olive_user_patterns
  FOR SELECT
  USING ((auth.uid())::text = user_id);

-- ─── Atomic upsert helper ────────────────────────────────────────────
-- The recorder calls this to either increment an existing pattern row
-- or insert a new one. Doing this in two app-side statements would
-- race — a single SECURITY DEFINER RPC keeps it atomic without a
-- transaction round-trip. Also bumps total_observations on every
-- matching user row so the confidence denominator stays current.
CREATE OR REPLACE FUNCTION public.olive_record_user_pattern(
  p_user_id text,
  p_pattern_type text,
  p_pattern_data jsonb,
  p_fingerprint text
)
RETURNS public.olive_user_patterns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.olive_user_patterns;
BEGIN
  -- Bump total_observations on every existing pattern row for this user
  -- + pattern_type. We do this BEFORE the upsert so the new/updated
  -- row's total_observations reflects the same just-observed event.
  UPDATE public.olive_user_patterns
  SET total_observations = total_observations + 1, updated_at = now()
  WHERE user_id = p_user_id AND pattern_type = p_pattern_type;

  -- Upsert. ON CONFLICT bumps count and last_seen_at; the unique index
  -- on (user_id, pattern_type, fingerprint) is what makes this work.
  INSERT INTO public.olive_user_patterns (
    user_id, pattern_type, pattern_data, fingerprint,
    count, total_observations, first_seen_at, last_seen_at
  )
  VALUES (
    p_user_id, p_pattern_type, p_pattern_data, p_fingerprint,
    1, 1, now(), now()
  )
  ON CONFLICT (user_id, pattern_type, fingerprint)
  DO UPDATE SET
    count = olive_user_patterns.count + 1,
    last_seen_at = now(),
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
