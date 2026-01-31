-- Schedule olive-heartbeat to run every 15 minutes
SELECT cron.schedule(
  'olive-heartbeat-runner',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-heartbeat',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnNwenZjZXR4bWNmZnR3b25xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4NTEyNzIsImV4cCI6MjA3MDQyNzI3Mn0.RoQlasob6T3SuGmR4r_oFmbIcwrK8r6Q7KQDIwFrPBg"}'::jsonb,
    body := '{"action": "tick"}'::jsonb
  ) AS request_id;
  $$
);