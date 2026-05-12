-- olive_calendar_sync_queue
-- ─────────────────────────────────────────────────────────────────────
-- Phase 2.1 — durable retry queue for failed Google Calendar syncs.
--
-- Today, a transient 5xx from Google leaves the user's calendar
-- permanently out of sync — we tell them honestly and abandon. This
-- queue makes those failures recoverable: enqueue on transient error,
-- a cron-driven worker re-runs with exponential backoff, the user's
-- calendar eventually catches up without their having to retry by
-- hand.
--
-- Distinct from olive_calendar_sync_log (the analytics record). The log
-- captures EVERY interaction including successful ones; this queue
-- only carries the work that needs to happen later.
--
-- ROLLBACK (manual, if ever needed):
--   SELECT cron.unschedule('olive-calendar-sync-retry');
--   DROP TABLE IF EXISTS public.olive_calendar_sync_queue;

CREATE TABLE IF NOT EXISTS public.olive_calendar_sync_queue (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           text NOT NULL,
  note_id           uuid,                            -- nullable: not every sync is note-linked
  -- Action discriminator. Matches the calendar-* edge function endpoints
  -- so the worker knows which one to invoke.
  action            text NOT NULL CHECK (action IN ('update', 'delete', 'create')),
  -- Full request body for the target edge function. Stored verbatim so
  -- the worker can re-issue the exact same call without re-deriving
  -- state from the (possibly-changed) database.
  payload           jsonb NOT NULL,
  -- Lifecycle state. We never DELETE rows from this table — completed
  -- and abandoned rows stay for analytics and post-mortem. A nightly
  -- prune job can reclaim space later if the table grows.
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_flight', 'succeeded', 'failed', 'abandoned')),
  attempts          integer NOT NULL DEFAULT 0,
  last_attempt_at   timestamptz,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  last_error        text,
  -- Free-form metadata: original sync_status, http status, etc. — used
  -- by the worker to make smarter retry decisions and by analytics to
  -- categorize failures.
  metadata          jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Worker-hot-path index. Predicate keeps the index small (rows in
-- terminal states aren't candidates) and ordered (the worker scans
-- earliest-due first).
CREATE INDEX IF NOT EXISTS idx_olive_calendar_sync_queue_due
  ON public.olive_calendar_sync_queue (next_attempt_at)
  WHERE status = 'pending';

-- Per-user lookup for diagnostic UIs.
CREATE INDEX IF NOT EXISTS idx_olive_calendar_sync_queue_user
  ON public.olive_calendar_sync_queue (user_id, created_at DESC);

-- updated_at maintenance trigger (matches existing convention from
-- baseline migration where set_updated_at() is defined).
DROP TRIGGER IF EXISTS olive_calendar_sync_queue_updated_at ON public.olive_calendar_sync_queue;
CREATE TRIGGER olive_calendar_sync_queue_updated_at
  BEFORE UPDATE ON public.olive_calendar_sync_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────
-- Same posture as olive_calendar_sync_log: SELECT scoped to the owning
-- user (so an in-app "stuck syncs" diagnostic UI works without service-
-- role keys), INSERT/UPDATE/DELETE blocked at the RLS layer (workers
-- bypass via service_role).
ALTER TABLE public.olive_calendar_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY olive_calendar_sync_queue_select_own
  ON public.olive_calendar_sync_queue
  FOR SELECT
  USING ((auth.uid())::text = user_id);

-- ─── Atomic claim helper ─────────────────────────────────────────────
-- The worker calls this to claim up to N due rows in one transaction.
-- Without an atomic claim, two simultaneous worker invocations would
-- happily both pick up the same row and call Google twice. UPDATE ...
-- RETURNING with a SELECT ... FOR UPDATE SKIP LOCKED inside is the
-- standard postgres pattern. SECURITY DEFINER + locked search_path so
-- it works under RLS.
CREATE OR REPLACE FUNCTION public.olive_claim_calendar_sync_jobs(p_limit integer)
RETURNS SETOF public.olive_calendar_sync_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.olive_calendar_sync_queue q
  SET
    status = 'in_flight',
    attempts = q.attempts + 1,
    last_attempt_at = now(),
    updated_at = now()
  WHERE q.id IN (
    SELECT id
    FROM public.olive_calendar_sync_queue
    WHERE status = 'pending'
      AND next_attempt_at <= now()
    ORDER BY next_attempt_at ASC
    LIMIT GREATEST(p_limit, 0)
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

-- ─── pg_cron schedule ─────────────────────────────────────────────────
-- Every 2 minutes the cron job hits the calendar-sync-retry edge
-- function. 2-minute cadence is a balance: the early-attempt schedule
-- (30s, 2m, 10m, 1h, 6h) means rows can wait at most ~2min before
-- their first retry actually fires, which matches user expectation of
-- "automatic, doesn't feel manual." Slower cadence would push retry-1
-- toward 15min and feel broken.
--
-- Wraps in DO block so the migration is rerunnable — pg_cron's API
-- raises an error if you re-schedule a name that's already there.
DO $$
DECLARE
  v_url text := current_setting('app.supabase_url', true);
  v_key text := current_setting('app.supabase_service_role_key', true);
BEGIN
  -- Skip if pg_cron isn't installed (e.g. local dev). The schedule will
  -- be added by re-running this migration in environments where it is.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping calendar-sync-retry schedule';
    RETURN;
  END IF;

  -- Drop existing schedule if present so we can re-create it idempotently.
  PERFORM cron.unschedule('olive-calendar-sync-retry')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'olive-calendar-sync-retry');

  -- The actual http call goes through pg_net, which the rest of the
  -- Olive scheduling stack uses. The URL/key are read from runtime
  -- settings the deploy pipeline injects, mirroring the existing
  -- olive-heartbeat schedule.
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'app.supabase_url / app.supabase_service_role_key not set — schedule not created. Set them and re-run the migration.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'olive-calendar-sync-retry',
    '*/2 * * * *',
    format(
      $cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
      $cron$,
      v_url || '/functions/v1/calendar-sync-retry',
      v_key
    )
  );
END;
$$;
