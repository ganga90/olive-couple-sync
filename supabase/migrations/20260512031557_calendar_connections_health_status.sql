-- calendar_connections_health_status
-- ─────────────────────────────────────────────────────────────────────
-- Persists what Layer 2 of the 2026-05-12 fix detects: when Google
-- responds 401 (auth_expired) or 403 (scope_insufficient) to a write,
-- the connection is in a state no amount of retrying will fix — the
-- user has to reconnect. PR 2 surfaces that fact in the `sync_status`
-- field of the response payload and in the chat reply suffix; this PR
-- gives it durable storage so the UI can render a persistent banner
-- (and so future analytics can answer "how many users are stuck on a
-- bad connection right now").
--
-- Three columns, partial index, no behavior change on existing rows
-- (default = 'healthy', so every current connection is treated as
-- healthy until something proves otherwise).
--
-- ROLLBACK (manual):
--   ALTER TABLE calendar_connections DROP COLUMN IF EXISTS health_status;
--   ALTER TABLE calendar_connections DROP COLUMN IF EXISTS last_health_change_at;
--   ALTER TABLE calendar_connections DROP COLUMN IF EXISTS health_message;
--   DROP INDEX IF EXISTS idx_calendar_connections_health_unhealthy;

-- ── Columns ──────────────────────────────────────────────────────────
-- DEFAULT 'healthy' + NOT NULL keeps queries simple — every connection
-- has a current status, no NULL handling in downstream code.
ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'healthy';

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS last_health_change_at timestamptz;

ALTER TABLE calendar_connections
  ADD COLUMN IF NOT EXISTS health_message text;

-- ── CHECK constraint ─────────────────────────────────────────────────
-- Idempotent via DO block — `ADD CONSTRAINT IF NOT EXISTS` doesn't
-- exist in standard Postgres. Without this guard re-running the
-- migration on a half-applied database errors out.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'calendar_connections_health_status_check'
      AND conrelid = 'public.calendar_connections'::regclass
  ) THEN
    ALTER TABLE calendar_connections
      ADD CONSTRAINT calendar_connections_health_status_check
      CHECK (
        health_status IN (
          'healthy',
          'auth_expired',
          'scope_insufficient',
          'persistently_failing'
        )
      );
  END IF;
END$$;

-- ── Partial index ────────────────────────────────────────────────────
-- The UI banner query is "find connections for user X where
-- health_status != 'healthy'". The vast majority of rows will be
-- healthy at any given time, so a partial index on the small subset
-- is cheap and avoids bloating the index when ~all rows match.
CREATE INDEX IF NOT EXISTS idx_calendar_connections_health_unhealthy
  ON calendar_connections(user_id, health_status)
  WHERE health_status != 'healthy';

COMMENT ON COLUMN calendar_connections.health_status IS
'Current health of this OAuth connection. healthy=normal; auth_expired/scope_insufficient=needs user reconnect; persistently_failing=reserved for repeated transient failures exceeding retry budget. Maintained by calendar-update-event / calendar-delete-event based on classifyHttpError results.';

COMMENT ON COLUMN calendar_connections.last_health_change_at IS
'Timestamp of the most recent health_status change. NULL when the connection has only ever been healthy.';

COMMENT ON COLUMN calendar_connections.health_message IS
'Truncated error message captured when health_status moved off healthy. Free-form; for operator diagnosis only, not user-facing.';
