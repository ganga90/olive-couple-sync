-- fix_olive_calendar_sync_queue_rls_for_clerk
-- ─────────────────────────────────────────────────────────────────────
-- The original olive_calendar_sync_queue table (Phase 2.1) shipped with
-- a SELECT policy that compares `auth.uid()::text` to `user_id`:
--
--   USING (auth.uid()::text = user_id)
--
-- But this app authenticates via Clerk, not Supabase Auth — the user
-- identifier lives in `auth.jwt() ->> 'sub'` (a Clerk-issued
-- `user_xxx…` text id), and `auth.uid()` returns either NULL or a
-- Supabase auth UUID that never matches. So the policy as-shipped
-- silently rejects every read from the client side. Service-role
-- callers bypass RLS so the retry worker still works, but anything
-- behind a user JWT (the PR 2C queue-pending badge query, the future
-- /calendar visibility surface) sees zero rows.
--
-- This migration replaces the policy with the same Clerk-compatible
-- pattern every other table in the repo uses (clerk_notes,
-- calendar_connections, olive_calendar_sync_log, etc):
--
--   USING (user_id = (auth.jwt() ->> 'sub'))
--
-- DROP + recreate is the only path because Postgres doesn't have
-- ALTER POLICY for the USING clause until PG15+, and we don't want to
-- depend on that version.
--
-- ROLLBACK (manual):
--   DROP POLICY IF EXISTS olive_calendar_sync_queue_select_own ON olive_calendar_sync_queue;
--   CREATE POLICY olive_calendar_sync_queue_select_own
--     ON olive_calendar_sync_queue FOR SELECT
--     USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS olive_calendar_sync_queue_select_own ON olive_calendar_sync_queue;

CREATE POLICY olive_calendar_sync_queue_select_own
  ON olive_calendar_sync_queue
  FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'::text));

COMMENT ON POLICY olive_calendar_sync_queue_select_own ON olive_calendar_sync_queue IS
'Clerk-compatible SELECT policy. Replaces the original auth.uid()-based policy that never matched because this app uses Clerk JWTs, not Supabase Auth. Matches the pattern in clerk_notes / calendar_connections.';
