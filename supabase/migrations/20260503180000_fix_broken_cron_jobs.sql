-- Fix four broken cron jobs that were 100% failing
-- ============================================================================
-- AUDIT: queried `cron.job_run_details` on 2026-05-03 and found:
--   olive-compile-memory-daily         : 23/23 failed since Apr 11
--   olive-memory-maintenance-weekly    :  4/4  failed since Apr 12
--   olive-soul-evolve-weekly           :  1/1  failed since Apr 26
--   olive-prompt-evolve-weekly         :  0    not yet fired (would fail)
--
-- All four shared the same defect: `current_setting('supabase_functions_endpoint')`
-- is not a real GUC on this Supabase project, so every run failed before
-- the cron's HTTP call left the database. Daily memory compilation, weekly
-- maintenance, and Phase A's soul-evolution keystone had never actually
-- run in production despite being scheduled.
--
-- The working crons (heartbeat, send-reminders, inbound-buffer-cleanup) all
-- use a literal URL + literal anon-key bearer JWT. We mirror that pattern
-- exactly. The anon JWT is project-public (already in the heartbeat cron
-- migration, see 20260131182119_*.sql) and serves only as gateway auth —
-- the functions read SUPABASE_SERVICE_ROLE_KEY from env at runtime to do
-- their privileged work.
--
-- Also adds `timeout_milliseconds := 60000`. Default pg_net worker timeout
-- is 5s, but soul-evolve and compile-memory routinely take 10-30s
-- (Gemini Pro calls, batch processing). The 60s ceiling matches Supabase
-- Edge Functions' execution limit — if the function didn't return by then,
-- something else is wrong.
--
-- Verified post-apply by manually triggering each cron and reading
-- net._http_response:
--   prompt-evolve   → 200 OK, gated by PROMPT_EVOLVE_ENABLED
--   soul-evolve     → 200 OK, processed 35 users (first successful run)
--   compile-memory  → 200 OK (separate pre-existing embedding-dim bug,
--                     out of scope for this migration)
--   memory-maintenance → 200 OK, repaired 45 records across 3 users

-- 1. olive-compile-memory-daily — daily memory compilation at 02:00 UTC
SELECT cron.unschedule('olive-compile-memory-daily');
SELECT cron.schedule(
  'olive-compile-memory-daily',
  '0 2 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-compile-memory',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{"action":"compile","force":false}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $cmd$
);

-- 2. olive-memory-maintenance-weekly — Sundays 03:00 UTC
SELECT cron.unschedule('olive-memory-maintenance-weekly');
SELECT cron.schedule(
  'olive-memory-maintenance-weekly',
  '0 3 * * 0',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-memory-maintenance',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{"action":"run_maintenance","run_type":"full"}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $cmd$
);

-- 3. olive-soul-evolve-weekly — Sundays 04:00 UTC. Phase A's keystone cron.
SELECT cron.unschedule('olive-soul-evolve-weekly');
SELECT cron.schedule(
  'olive-soul-evolve-weekly',
  '0 4 * * 0',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-soul-evolve',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $cmd$
);

-- 4. olive-prompt-evolve-weekly — Sundays 05:00 UTC (Phase D-1)
SELECT cron.unschedule('olive-prompt-evolve-weekly');
SELECT cron.schedule(
  'olive-prompt-evolve-weekly',
  '0 5 * * 0',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-prompt-evolve',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) AS request_id;
  $cmd$
);
