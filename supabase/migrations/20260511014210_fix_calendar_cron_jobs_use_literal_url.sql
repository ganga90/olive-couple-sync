-- fix_calendar_cron_jobs_use_literal_url
-- ─────────────────────────────────────────────────────────────────────
-- Sibling of `20260503173725_fix_broken_cron_jobs_use_literal_url`.
--
-- Phase 2.1 + 2.2 migrations originally used `current_setting('app.supabase_url')`
-- and `current_setting('app.supabase_service_role_key')` to fetch the
-- callback URL + auth token at schedule time. That's not the convention
-- this codebase actually uses — all existing crons (olive-heartbeat-runner,
-- send-reminders-every-minute, etc.) bake a literal URL + anon-key
-- Bearer into the cron.schedule command. When my migrations ran in prod,
-- the runtime settings weren't set, so cron creation was skipped via
-- the safety NOTICE branch.
--
-- This migration corrects course by creating the two schedules with the
-- literal-URL pattern, matching the rest of the codebase.
--
-- ROLLBACK (manual):
--   SELECT cron.unschedule('olive-calendar-sync-retry');
--   SELECT cron.unschedule('olive-calendar-watch-renew');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping calendar cron schedules';
    RETURN;
  END IF;

  -- Remove any partial schedules from prior runs so this migration is
  -- safely re-runnable. cron.unschedule errors when the job doesn't
  -- exist, so guard via cron.job.
  PERFORM cron.unschedule('olive-calendar-sync-retry')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'olive-calendar-sync-retry');

  PERFORM cron.unschedule('olive-calendar-watch-renew')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'olive-calendar-watch-renew');

  -- Phase 2.1 — Retry queue worker, every 2 minutes. Hits
  -- calendar-sync-retry which claims pending rows from
  -- olive_calendar_sync_queue and re-invokes the original calendar-*
  -- edge function for each.
  PERFORM cron.schedule(
    'olive-calendar-sync-retry',
    '*/2 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/calendar-sync-retry',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
    $cron$
  );

  -- Phase 2.2 — Watch channel renewal, hourly at :17 (offset from :00
  -- fan-out). Walks calendar_connections whose watch_expiry_at is
  -- within the next 24h or whose watch_state is failed/stopped, and
  -- re-registers via calendar-watch-register.
  PERFORM cron.schedule(
    'olive-calendar-watch-renew',
    '17 * * * *',
    $cron$
    SELECT net.http_post(
      url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/calendar-watch-renew',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
    $cron$
  );
END;
$$;
