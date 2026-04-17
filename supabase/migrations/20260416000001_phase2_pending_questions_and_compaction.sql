-- Phase 2 — Close Phase 1 loops (heartbeat worker + thread compaction)
-- ======================================================================
-- This migration adds the two pieces needed to make the Phase 1 schemas
-- actually *do something*:
--
--   1. olive_pending_questions — tracks "Olive is waiting on a user
--      answer" (currently only used for contradiction resolution, but
--      modeled generically so future question types can piggyback).
--
--   2. reset_gateway_session_counter(p_session_id) — atomic RPC used
--      by the compaction worker after it writes a new summary. Matches
--      the pattern established by increment_gateway_session_message().
--
-- All additions are idempotent and backwards-compatible.

-- ─── Task 2-A: Pending questions table ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.olive_pending_questions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  -- Scoped list so we can add new question types without schema changes.
  question_type     TEXT NOT NULL
    CHECK (question_type IN ('contradiction_resolve')),
  -- FK-shaped reference; not a hard FK because reference_id may point at
  -- different tables per question_type in the future.
  reference_id      UUID NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'web')),
  question_text     TEXT NOT NULL,
  -- Free-form extra context the resolver needs (e.g. both chunk bodies
  -- for a contradiction, so the resolver doesn't have to re-fetch).
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  asked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Questions auto-expire so we don't mis-interpret an unrelated user
  -- message from tomorrow as an answer. 24h matches the WhatsApp window.
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  answered_at       TIMESTAMPTZ,
  answer_text       TEXT,
  -- Structured resolver output for analytics/debugging:
  --   { winner: 'a'|'b'|'merge'|'neither', merge_text?: string,
  --     reasoning?: string, model?: string }
  resolution        JSONB,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'expired', 'cancelled'))
);

-- Fast lookup: "is there a pending question for this user right now?"
-- Used on every inbound WhatsApp message before intent classification.
CREATE INDEX IF NOT EXISTS idx_pending_questions_active_user
  ON public.olive_pending_questions(user_id, asked_at DESC)
  WHERE status = 'pending';

-- Expiry sweep support (future cron can flip status='expired').
CREATE INDEX IF NOT EXISTS idx_pending_questions_expires
  ON public.olive_pending_questions(expires_at)
  WHERE status = 'pending';

COMMENT ON TABLE public.olive_pending_questions IS
  'Tracks questions Olive has asked the user and is waiting for an answer to. On inbound, whatsapp-webhook checks for a pending row before normal intent classification. Modeled generically so future question types (preference_confirm, goal_check, etc.) can reuse the table.';
COMMENT ON COLUMN public.olive_pending_questions.question_type IS
  'Discriminator. Currently only contradiction_resolve. When adding a new type, relax the CHECK constraint and the resolver dispatcher.';
COMMENT ON COLUMN public.olive_pending_questions.reference_id IS
  'Soft pointer to the row the question is about (e.g. olive_memory_contradictions.id for contradiction_resolve).';
COMMENT ON COLUMN public.olive_pending_questions.expires_at IS
  'After this point, a user reply is NOT treated as an answer to this question. Default 24h aligns with the WhatsApp session window.';
COMMENT ON COLUMN public.olive_pending_questions.resolution IS
  'Structured resolver output: { winner, merge_text?, reasoning?, model? }.';

-- RLS: service role writes; users read their own (future dashboard).
ALTER TABLE public.olive_pending_questions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'olive_pending_questions'
      AND policyname = 'pending_questions_user_read'
  ) THEN
    CREATE POLICY pending_questions_user_read ON public.olive_pending_questions
      FOR SELECT
      USING (user_id = (auth.jwt() ->> 'sub'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'olive_pending_questions'
      AND policyname = 'pending_questions_service_all'
  ) THEN
    CREATE POLICY pending_questions_service_all ON public.olive_pending_questions
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;


-- ─── Task 2-B: Compaction commit RPC ───────────────────────────────
-- After the compactor writes a new summary, it needs to atomically:
--   (a) store the summary + last_compacted_at cursor,
--   (b) subtract the compacted count from message_count (NOT a hard
--       reset — messages that raced the compaction stay counted toward
--       the next window via the cursor).
-- Doing this in a single SQL statement keeps the cursor and the counter
-- consistent even if inbound messages land mid-compaction.
CREATE OR REPLACE FUNCTION public.apply_gateway_session_compaction(
  p_session_id        UUID,
  p_compact_summary   TEXT,
  p_cursor_ts         TIMESTAMPTZ,
  p_compacted_count   INTEGER
)
RETURNS TABLE(
  message_count        INTEGER,
  total_messages_ever  INTEGER,
  last_compacted_at    TIMESTAMPTZ
)
LANGUAGE sql VOLATILE SET search_path = 'public'
AS $$
  UPDATE public.olive_gateway_sessions
     SET compact_summary   = p_compact_summary,
         last_compacted_at = p_cursor_ts,
         -- Subtract what we compacted. If inbound messages raced and
         -- bumped message_count while we were summarizing, they stay
         -- on the counter and push the next compaction earlier.
         message_count     = GREATEST(0, message_count - GREATEST(0, p_compacted_count))
   WHERE id = p_session_id
  RETURNING message_count, total_messages_ever, last_compacted_at;
$$;

COMMENT ON FUNCTION public.apply_gateway_session_compaction(UUID, TEXT, TIMESTAMPTZ, INTEGER) IS
  'Commits a compaction result: writes compact_summary + last_compacted_at cursor, and subtracts p_compacted_count from message_count (clamped to 0). Messages that raced compaction stay on the counter, preserving accurate threshold-to-next-compaction accounting.';
