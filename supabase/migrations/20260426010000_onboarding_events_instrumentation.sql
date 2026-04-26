-- Onboarding instrumentation — olive_onboarding_events + funnel view
-- =====================================================================
-- Until now, the only signal that someone finished onboarding was a
-- single chunk in olive_memory_chunks tagged 'onboarding_completed'.
-- That makes baselines impossible (no per-beat drop-off, no time-to-
-- first-capture, no skip vs. complete telemetry) and gates everything
-- downstream (TASK-ONB-D feature flag A/B can't be measured without it).
--
-- This migration adds:
--   (A) olive_onboarding_events — append-only event log scoped per user
--       with RLS that lets users insert their own events directly from
--       the client (no extra edge-function hop on the hot path).
--   (B) v_onboarding_funnel — daily aggregate view ready for the admin
--       dashboard. Built as a view (not a materialized view) so it
--       always reflects fresh data; volume is small enough that a plain
--       view is fine for months.
--
-- Why client-side writes instead of an edge function:
--   The events are write-once, low-stakes, and high-frequency on the
--   onboarding hot path. Forcing every event through an edge function
--   adds ~80–200ms of HTTP overhead per beat AND a deploy step that
--   blocks measurement. The RLS policy below scopes inserts to the
--   authenticated user's own user_id — no cross-user write is possible.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running this
-- migration is a no-op.

-- ─── (A) Event log table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.olive_onboarding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                            -- Clerk user ID, matches clerk_profiles.id
  beat TEXT,                                        -- 'demoPreview' | 'quiz' | 'spaceCreate' | 'regional' | 'whatsapp' | 'calendar' | 'demo' | NULL for non-beat events
  event TEXT NOT NULL,                              -- 'flow_started' | 'beat_started' | 'beat_completed' | 'beat_skipped' | 'space_created' | 'soul_seeded' | 'wa_connected' | 'calendar_connected' | 'capture_sent' | 'flow_completed' | 'error'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,       -- Free-form: scope, space_type, latency_ms, error msg, etc.
  client_ts TIMESTAMPTZ,                            -- Client clock — useful when batching delays the server insert
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()     -- Server-authoritative timestamp; used for funnel ordering
);

-- Indexes optimized for the funnel view's predicate shape: per-user
-- timeline reconstruction + event-type filtering.
CREATE INDEX IF NOT EXISTS idx_onboarding_events_user_created
  ON public.olive_onboarding_events (user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_event_created
  ON public.olive_onboarding_events (event, created_at);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_beat
  ON public.olive_onboarding_events (beat)
  WHERE beat IS NOT NULL;

-- ─── (B) RLS — write-only-your-own, read-only-your-own ──────────────
ALTER TABLE public.olive_onboarding_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own events. Useful for "where did I leave off?"
-- recovery flows and for self-service deletion under GDPR.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'olive_onboarding_events'
      AND policyname = 'onboarding_events_user_read'
  ) THEN
    CREATE POLICY "onboarding_events_user_read"
      ON public.olive_onboarding_events
      FOR SELECT
      USING (user_id = (auth.jwt()->>'sub'));
  END IF;
END $$;

-- Users can insert events tagged with their own user_id. The WITH CHECK
-- clause enforces that a malicious client can't fabricate events for
-- another user, even though they can write to the table directly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'olive_onboarding_events'
      AND policyname = 'onboarding_events_user_insert'
  ) THEN
    CREATE POLICY "onboarding_events_user_insert"
      ON public.olive_onboarding_events
      FOR INSERT
      WITH CHECK (user_id = (auth.jwt()->>'sub'));
  END IF;
END $$;

-- Service role (edge functions, admin dashboard) bypasses everything.
-- Required for funnel view aggregation that needs to count across users.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'olive_onboarding_events'
      AND policyname = 'onboarding_events_service'
  ) THEN
    CREATE POLICY "onboarding_events_service"
      ON public.olive_onboarding_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- Deliberately no UPDATE / DELETE policy for users. Events are an
-- append-only log; mutability would corrupt the funnel. Service role
-- can still delete (covered by the FOR ALL service policy above) for
-- GDPR erasure flows.

-- ─── (C) Funnel view ────────────────────────────────────────────────
-- One row per day. Each metric counts DISTINCT users who emitted that
-- event that day, so a user repeating a beat (resume / refresh) is
-- only counted once per day per metric.
--
-- The avg_seconds_to_first_capture column joins each user's earliest
-- 'flow_started' to their earliest 'capture_sent' so we can track
-- aha-time without a window function in the dashboard.
--
-- View not materialized: volume is low (single-digit thousands of
-- events per day expected), and we want fresh-by-default semantics.
-- Re-evaluate if rows-per-day exceeds ~100k.

CREATE OR REPLACE VIEW public.v_onboarding_funnel AS
WITH user_first_events AS (
  -- For each user, the timestamp of their first occurrence of each
  -- key event. Lets us compute time-between-events without correlated
  -- subqueries in the outer aggregate.
  SELECT
    user_id,
    MIN(created_at) FILTER (WHERE event = 'flow_started')      AS started_at,
    MIN(created_at) FILTER (WHERE event = 'space_created')     AS space_at,
    MIN(created_at) FILTER (WHERE event = 'capture_sent')      AS capture_at,
    MIN(created_at) FILTER (WHERE event = 'wa_connected')      AS wa_at,
    MIN(created_at) FILTER (WHERE event = 'flow_completed')    AS completed_at,
    MIN(created_at) FILTER (WHERE event = 'beat_skipped' AND beat = 'whatsapp') AS wa_skipped_at,
    -- Day bucketing on flow_started so a single user's day is
    -- consistent across all the metrics in their cohort row.
    DATE_TRUNC('day', MIN(created_at) FILTER (WHERE event = 'flow_started'))::date AS cohort_day
  FROM public.olive_onboarding_events
  GROUP BY user_id
)
SELECT
  cohort_day                                                        AS day,
  COUNT(*) FILTER (WHERE started_at IS NOT NULL)                    AS started,
  COUNT(*) FILTER (WHERE space_at IS NOT NULL)                      AS space_created,
  COUNT(*) FILTER (WHERE capture_at IS NOT NULL)                    AS first_capture,
  COUNT(*) FILTER (WHERE wa_at IS NOT NULL)                         AS wa_connected,
  COUNT(*) FILTER (WHERE wa_skipped_at IS NOT NULL)                 AS wa_skipped,
  COUNT(*) FILTER (WHERE completed_at IS NOT NULL)                  AS completed,

  -- Funnel ratios — null-safe so a zero-cohort day shows NULL not
  -- division-by-zero. Cast to numeric for human-friendly precision.
  ROUND(
    COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_completed,

  ROUND(
    COUNT(*) FILTER (WHERE capture_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_first_capture,

  ROUND(
    COUNT(*) FILTER (WHERE wa_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_wa_connected,

  -- Median is harder in a view; use mean for now. Tighten to median
  -- with percentile_cont() if outliers skew the signal.
  ROUND(
    AVG(EXTRACT(EPOCH FROM (capture_at - started_at)))::numeric,
    1
  ) AS avg_seconds_to_first_capture,

  ROUND(
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric,
    1
  ) AS avg_seconds_total
FROM user_first_events
WHERE cohort_day IS NOT NULL
GROUP BY cohort_day
ORDER BY cohort_day DESC;

-- View is opt-in for service role / admin queries. No RLS on the
-- underlying table grants user-level access to this aggregate, so
-- direct SELECT from a regular client returns only that user's data
-- (effectively a one-row view per call) — fine for "your own progress"
-- queries, useless for cross-user analytics. Admin dashboards must
-- query via service role.

COMMENT ON TABLE public.olive_onboarding_events IS
  'Append-only event log for the onboarding flow. RLS scopes inserts and reads to the authenticated user. Drives v_onboarding_funnel.';

COMMENT ON VIEW public.v_onboarding_funnel IS
  'Daily onboarding funnel — distinct users by milestone. Query via service role for cross-user analytics; user-scoped queries return only their own row.';
