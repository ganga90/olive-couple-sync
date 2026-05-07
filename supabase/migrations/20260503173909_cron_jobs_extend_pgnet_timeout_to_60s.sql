-- ─── Extend pg_net timeout to 60s for cron-driven function calls ───
-- olive-soul-evolve, olive-compile-memory, and olive-memory-maintenance
-- routinely take 10-30s (Pro calls, batch processing). pg_net's default
-- 5s worker timeout was marking these as failed even when the function
-- completed successfully on the other end. This affects cron observability,
-- not correctness — but better to have honest run history.
--
-- 60s ceiling matches Supabase Edge Functions' default 60s execution limit:
-- if the function itself didn't return by 60s, something else is wrong.

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
