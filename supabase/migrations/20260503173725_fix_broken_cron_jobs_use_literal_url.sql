-- ─── Fix broken cron jobs ──────────────────────────────────────────
-- All four use-current_setting-pattern crons have been failing 100% of
-- their runs because `supabase_functions_endpoint` is not a real GUC
-- on this project. Audit confirmed via cron.job_run_details:
--
--   olive-compile-memory-daily        : 23/23 failed since Apr 11
--   olive-memory-maintenance-weekly   :  4/4  failed since Apr 12
--   olive-soul-evolve-weekly          :  1/1  failed since Apr 26
--   olive-prompt-evolve-weekly        :  0    not yet fired (would fail)
--
-- The working crons (heartbeat, send-reminders, inbound-buffer) all use
-- a literal URL + literal anon-key bearer JWT. We mirror that pattern.
--
-- The anon JWT is project-public (already in the heartbeat cron command,
-- a previously-shipped migration in the repo). It serves only as gateway
-- auth — the functions themselves read SUPABASE_SERVICE_ROLE_KEY from
-- env at runtime to do their actual privileged work.

-- 1. olive-compile-memory-daily — daily memory compilation at 02:00 UTC
SELECT cron.unschedule('olive-compile-memory-daily');
SELECT cron.schedule(
  'olive-compile-memory-daily',
  '0 2 * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-compile-memory',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{"action":"compile","force":false}'::jsonb
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
    body := '{"action":"run_maintenance","run_type":"full"}'::jsonb
  ) AS request_id;
  $cmd$
);

-- 3. olive-soul-evolve-weekly — Sundays 04:00 UTC. Phase A's keystone cron
-- has actually been broken since shipped — this is also a real Phase A fix.
SELECT cron.unschedule('olive-soul-evolve-weekly');
SELECT cron.schedule(
  'olive-soul-evolve-weekly',
  '0 4 * * 0',
  $cmd$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-soul-evolve',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{}'::jsonb
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
    body := '{}'::jsonb
  ) AS request_id;
  $cmd$
);
