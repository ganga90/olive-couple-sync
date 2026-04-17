-- Phase 1 — Foundation of Robustness & Observability
-- ====================================================
-- Tasks:
--   1-C: Contradiction resolution strategy + winning chunk + notes
--   1-D: WhatsApp thread instrumentation (message counters + compact summary)
--
-- All changes are additive and idempotent. Safe to re-run.

-- ─── Task 1-C: Contradiction resolution extensions ──────────────────
-- Existing columns:
--   id, user_id, chunk_a_id, chunk_b_id, chunk_a_content, chunk_b_content,
--   contradiction_type, confidence, resolution, resolved_content,
--   resolved_at, created_at
--
-- New columns:
--   resolution_strategy — how the resolution was picked (AUTO_RECENCY,
--                         AUTO_FREQUENCY, ASK_USER, MANUAL, AI_SUGGESTED)
--   winning_chunk_id    — structured pointer to the surviving chunk
--                         (complements resolved_content which is free text)
--   resolution_notes    — human-readable explanation for the audit trail
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_contradictions' AND column_name = 'resolution_strategy'
  ) THEN
    ALTER TABLE public.olive_memory_contradictions
      ADD COLUMN resolution_strategy TEXT
        CHECK (resolution_strategy IN (
          'AUTO_RECENCY', 'AUTO_FREQUENCY', 'ASK_USER', 'MANUAL', 'AI_SUGGESTED'
        ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_contradictions' AND column_name = 'winning_chunk_id'
  ) THEN
    ALTER TABLE public.olive_memory_contradictions
      ADD COLUMN winning_chunk_id UUID
        REFERENCES public.olive_memory_chunks(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_contradictions' AND column_name = 'resolution_notes'
  ) THEN
    ALTER TABLE public.olive_memory_contradictions
      ADD COLUMN resolution_notes TEXT;
  END IF;
END $$;

-- Index for quickly finding ASK_USER contradictions that need a heartbeat job
CREATE INDEX IF NOT EXISTS idx_contradictions_ask_user_pending
  ON public.olive_memory_contradictions(user_id, created_at DESC)
  WHERE resolution_strategy = 'ASK_USER'
    AND resolution = 'unresolved';

-- Index for winning_chunk_id lookups (provenance queries)
CREATE INDEX IF NOT EXISTS idx_contradictions_winning_chunk
  ON public.olive_memory_contradictions(winning_chunk_id)
  WHERE winning_chunk_id IS NOT NULL;

COMMENT ON COLUMN public.olive_memory_contradictions.resolution_strategy IS
  'How the contradiction was resolved: AUTO_RECENCY (newer chunk wins — default), AUTO_FREQUENCY (more-mentioned entity wins), ASK_USER (surfaced via heartbeat job), MANUAL (user resolved in UI), AI_SUGGESTED (legacy path where AI picked keep_newer/merge).';

COMMENT ON COLUMN public.olive_memory_contradictions.winning_chunk_id IS
  'Structured pointer to the surviving chunk after resolution. Complements resolved_content (free-text merge output). NULL when resolution was merge or ask_user.';

COMMENT ON COLUMN public.olive_memory_contradictions.resolution_notes IS
  'Human-readable audit trail: who resolved it (system/user), why, and any caveats.';


-- ─── Task 1-D: WhatsApp thread instrumentation ──────────────────────
-- Existing columns on olive_gateway_sessions:
--   id, user_id, channel, conversation_context, is_active,
--   last_activity, created_at
--
-- New columns for Phase 2 thread-compaction prep:
--   message_count         — inbound messages in CURRENT thread (since last compact)
--   compact_summary       — LLM-generated summary of pre-compact messages
--   last_compacted_at     — when we last ran compaction on this thread
--   total_messages_ever   — lifetime inbound counter (never reset)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_gateway_sessions' AND column_name = 'message_count'
  ) THEN
    ALTER TABLE public.olive_gateway_sessions
      ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_gateway_sessions' AND column_name = 'compact_summary'
  ) THEN
    ALTER TABLE public.olive_gateway_sessions
      ADD COLUMN compact_summary TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_gateway_sessions' AND column_name = 'last_compacted_at'
  ) THEN
    ALTER TABLE public.olive_gateway_sessions
      ADD COLUMN last_compacted_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_gateway_sessions' AND column_name = 'total_messages_ever'
  ) THEN
    ALTER TABLE public.olive_gateway_sessions
      ADD COLUMN total_messages_ever INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Index for "sessions ready to compact" queries (Phase 2)
CREATE INDEX IF NOT EXISTS idx_gateway_sessions_compact_ready
  ON public.olive_gateway_sessions(user_id, message_count)
  WHERE is_active = true AND message_count > 0;

COMMENT ON COLUMN public.olive_gateway_sessions.message_count IS
  'Inbound messages in the current thread, resets to 0 after compaction.';

COMMENT ON COLUMN public.olive_gateway_sessions.compact_summary IS
  'LLM-generated summary of pre-compaction messages. Fed into context assembly instead of raw history.';

COMMENT ON COLUMN public.olive_gateway_sessions.last_compacted_at IS
  'Last compaction timestamp. NULL = never compacted.';

COMMENT ON COLUMN public.olive_gateway_sessions.total_messages_ever IS
  'Lifetime inbound message counter. Never reset by compaction — used for user-level analytics.';


-- ─── Atomic message counter RPC ─────────────────────────────────────
-- Why an RPC: increments need to be atomic. Read-modify-write from the
-- edge function has TOCTOU races. Use a single UPDATE statement.
CREATE OR REPLACE FUNCTION public.increment_gateway_session_message(
  p_session_id UUID
)
RETURNS TABLE(message_count INTEGER, total_messages_ever INTEGER)
LANGUAGE sql VOLATILE SET search_path = 'public'
AS $$
  UPDATE public.olive_gateway_sessions
     SET message_count       = message_count + 1,
         total_messages_ever = total_messages_ever + 1,
         last_activity       = now()
   WHERE id = p_session_id
  RETURNING message_count, total_messages_ever;
$$;

COMMENT ON FUNCTION public.increment_gateway_session_message(UUID) IS
  'Atomically increments both message counters on olive_gateway_sessions. Returns the new values for downstream compaction-threshold checks.';
