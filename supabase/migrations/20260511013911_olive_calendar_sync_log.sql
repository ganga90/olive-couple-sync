-- olive_calendar_sync_log
-- ─────────────────────────────────────────────────────────────────────
-- Every interaction Olive has with Google Calendar — create/update/
-- delete/sync — writes a row here. Separate from olive_llm_calls because
-- these are not LLM events; mixing the two muddies analytics queries.
--
-- This is what makes Phase 1's sync-success-rate SLO measurable. The
-- weekly query in CLAUDE.md gets a sibling here: rate of synced_to_google
-- = true vs the failure breakdown, p50/p95 latency, etag-conflict rate.
--
-- ROLLBACK (manual, if ever needed):
--   DROP TABLE IF EXISTS public.olive_calendar_sync_log;

CREATE TABLE IF NOT EXISTS public.olive_calendar_sync_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          text NOT NULL,
  note_id          uuid,                            -- nullable: not all syncs are note-linked
  connection_id    uuid,                            -- nullable when user has no connection (status='not_connected')
  google_event_id  text,                            -- nullable for not_connected / no_linked_event
  action           text NOT NULL,                   -- 'create' | 'update' | 'delete'
  sync_status      text NOT NULL,                   -- e.g. 'updated','deleted','not_connected','no_linked_event','etag_conflict','google_api_error','token_refresh_failed','invoke_failed','already_gone'
  http_status      integer,                         -- Google's HTTP response status when applicable
  etag_conflict    boolean NOT NULL DEFAULT false,
  latency_ms       integer,                         -- end-to-end including refresh + Google round-trip
  invoked_from     text,                            -- 'ask-olive-stream' | 'ask-olive-individual' | 'auto-calendar-event' | 'calendar-create-event' | 'whatsapp-webhook'
  error_message    text,                            -- truncated; full body lives in logs
  metadata         jsonb,                           -- room for future fields without migrations
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Hot-path query: "what's the recent sync state for this user/note" — used
-- when re-issuing a failed sync (retry queue Phase 2 will live alongside).
CREATE INDEX IF NOT EXISTS idx_olive_calendar_sync_log_user_created
  ON public.olive_calendar_sync_log (user_id, created_at DESC);

-- Analytics query: "what's our sync success rate this week" — by status,
-- across users. Partial index on failure rows keeps the index small while
-- the weekly aggregate stays fast.
CREATE INDEX IF NOT EXISTS idx_olive_calendar_sync_log_failures
  ON public.olive_calendar_sync_log (sync_status, created_at DESC)
  WHERE sync_status NOT IN ('updated','deleted','created','already_gone','not_connected','no_linked_event');

CREATE INDEX IF NOT EXISTS idx_olive_calendar_sync_log_note
  ON public.olive_calendar_sync_log (note_id)
  WHERE note_id IS NOT NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────
-- The table is service-role-owned (edge functions write to it) but we
-- still enable RLS + grant SELECT to the owning user so the in-app
-- Memory/Admin pages can surface a user's recent calendar sync history
-- without bypassing RLS via the service key.
ALTER TABLE public.olive_calendar_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY olive_calendar_sync_log_select_own
  ON public.olive_calendar_sync_log
  FOR SELECT
  USING ((auth.uid())::text = user_id);

-- Inserts/updates/deletes only via service role (no policy = blocked for
-- authenticated/anon). This is the same posture as olive_llm_calls.
