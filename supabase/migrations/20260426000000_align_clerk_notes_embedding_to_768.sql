-- Align clerk_notes.embedding to vector(768)
-- ============================================
-- Context: clerk_notes.embedding was changed to vector(1536) by a stray earlier
-- migration, but EVERY caller in the codebase generates 768-dim Gemini embeddings
-- (gemini-embedding-001 with outputDimensionality: 768 — see whatsapp-webhook,
-- olive-memory, olive-search, olive-knowledge-extract, olive-heartbeat,
-- olive-compile-memory, _shared/orchestrator.ts, manage-memories,
-- olive-memory-maintenance, repair-embeddings, and the existing process-note
-- duplicate-detection path). The dimension mismatch silently failed every
-- write — verified live: 0 of 566 notes have embeddings populated for the
-- heaviest user. find_similar_notes consequently returns 0 every time, so
-- semantic search has been dead code in production.
--
-- Verified before writing this migration:
--   SELECT COUNT(*) FROM clerk_notes WHERE embedding IS NOT NULL  → 0 (zero data loss)
--   format_type on embedding column                               → vector(1536)
--   Every generateEmbedding caller (13 files)                     → outputDimensionality: 768
--   user_memories.embedding (used by repair-embeddings)           → already vector(768)
--
-- Operations:
--   (1) Drop the ivfflat index — required before changing column type.
--   (2) Safety guard: abort if anyone snuck in a non-null embedding meanwhile.
--   (3) Alter column type to vector(768).
--   (4) Recreate the ivfflat index at the new dim.
--
-- find_similar_notes does NOT need updating — its parameter is the
-- un-dimensioned `extensions.vector` (per migration 20260411191423), which
-- accepts any dimension and uses the cosine operator on the column.

-- (1) Drop the ivfflat index
DROP INDEX IF EXISTS public.idx_clerk_notes_embedding;

-- (2) Safety guard
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt FROM public.clerk_notes WHERE embedding IS NOT NULL;
  IF cnt > 0 THEN
    RAISE EXCEPTION 'Refusing to alter clerk_notes.embedding dim: % rows have non-null embedding (would lose data). Dump and re-embed first.', cnt;
  END IF;
END $$;

-- (3) Change dimension 1536 → 768 to match every caller in the codebase
ALTER TABLE public.clerk_notes
  ALTER COLUMN embedding TYPE extensions.vector(768);

-- (4) Recreate the ivfflat index at the corrected dimension
CREATE INDEX idx_clerk_notes_embedding
  ON public.clerk_notes
  USING ivfflat (embedding extensions.vector_cosine_ops)
  WITH (lists = 100);
