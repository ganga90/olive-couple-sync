-- calendar_watch_channels
-- ─────────────────────────────────────────────────────────────────────
-- Phase 2.2 — bidirectional sync via Google Calendar push channels.
--
-- Google delivers webhook callbacks when a calendar changes. To
-- receive them we register a "watch" against the user's primary
-- calendar; Google sends an empty POST to our callback URL with the
-- channel id + token in headers. We then use the syncToken stored on
-- calendar_sync_state to fetch only the changes since last sync.
--
-- Channel state is per-connection (1:1). We add the columns here
-- rather than create a separate table because:
--   - Channels are owned by the connection; no history needed today.
--   - Single row per connection avoids a join on the hot push path.
--   - Stopping the watch on disconnect is a single UPDATE-then-DELETE
--     rather than a multi-row dance.
--
-- ROLLBACK (manual, if ever needed):
--   ALTER TABLE public.calendar_connections
--     DROP COLUMN watch_channel_id,
--     DROP COLUMN watch_resource_id,
--     DROP COLUMN watch_token,
--     DROP COLUMN watch_expiry_at,
--     DROP COLUMN watch_state;
--   SELECT cron.unschedule('olive-calendar-watch-renew');

ALTER TABLE public.calendar_connections
  ADD COLUMN IF NOT EXISTS watch_channel_id  text,
  ADD COLUMN IF NOT EXISTS watch_resource_id text,
  -- Random secret we generate on registration. Google echoes it back
  -- as `X-Goog-Channel-Token` on every push callback so we can
  -- authenticate the request. Not derived from access_token (which
  -- rotates) so renewal across token refreshes is safe.
  ADD COLUMN IF NOT EXISTS watch_token       text,
  ADD COLUMN IF NOT EXISTS watch_expiry_at   timestamptz,
  -- Lifecycle marker for the channel:
  --   'active'   — registered and currently receiving callbacks
  --   'expired'  — past expiry; renewal cron will repair
  --   'stopped'  — explicitly stopped (disconnect) and not renewed
  --   'failed'   — registration failed; user will get next sync via
  --                manual /fetch_events button
  ADD COLUMN IF NOT EXISTS watch_state       text;

-- Renewal cron candidates — channels expiring soon. Partial index
-- keeps the table scan tight on what's typically <100 rows but could
-- be 10k+ over time.
CREATE INDEX IF NOT EXISTS idx_calendar_connections_watch_due
  ON public.calendar_connections (watch_expiry_at)
  WHERE watch_state = 'active' AND watch_expiry_at IS NOT NULL;

-- Callback lookup index — every push handler does a lookup by
-- watch_channel_id. Unique because channel ids are globally unique
-- (we generate UUIDv4 client-side before registering).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_calendar_connections_watch_channel
  ON public.calendar_connections (watch_channel_id)
  WHERE watch_channel_id IS NOT NULL;

-- ─── pg_cron schedule for renewal ─────────────────────────────────────
-- Channels expire after at most 30 days (Google's hard limit). We
-- renew everything expiring within 24 hours, hourly. Frequent enough
-- that a single failed renewal cycle still has 23 retries before any
-- channel goes dark; cheap because the worker is no-op when there's
-- nothing due.
--
-- Idempotent block — same pattern as olive-calendar-sync-retry: skip
-- gracefully when pg_cron isn't installed (local dev) or when the
-- runtime settings aren't injected.
DO $$
DECLARE
  v_url text := current_setting('app.supabase_url', true);
  v_key text := current_setting('app.supabase_service_role_key', true);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping calendar-watch-renew schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule('olive-calendar-watch-renew')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'olive-calendar-watch-renew');

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'app.supabase_url / app.supabase_service_role_key not set — schedule not created. Set them and re-run.';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'olive-calendar-watch-renew',
    '17 * * * *',  -- top of the hour + 17 min, to dodge the *:00 fan-out
    format(
      $cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Authorization', 'Bearer %s', 'Content-Type', 'application/json'),
        body := '{}'::jsonb
      );
      $cron$,
      v_url || '/functions/v1/calendar-watch-renew',
      v_key
    )
  );
END;
$$;
