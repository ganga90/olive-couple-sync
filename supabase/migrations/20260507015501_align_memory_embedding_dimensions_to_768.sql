-- Already applied to prod via MCP — this is the audit trail.
--
-- Aligns olive_memory_files and olive_memory_chunks embedding columns
-- from vector(1536) to vector(768) so they match the dim that
-- olive-compile-memory and _shared/orchestrator.ts generate (Gemini
-- gemini-embedding-001 with outputDimensionality: 768).
--
-- Without this, olive-compile-memory had been silently failing daily
-- compactions for ~3 weeks with "expected 1536 dimensions, not 768"
-- errors. Visible symptoms in prod before the fix:
--   • olive_memory_chunks: 84 rows, all embedding NULL
--   • olive_memory_files: 4 rows with stale 1536-dim embeddings (from
--     the prior OpenAI-era embedding model, never refreshed since the
--     dim mismatch broke the pipeline)
--
-- Likely fallout from PR #12 (clerk_notes 768 alignment) which updated
-- some tables but not the memory tables.
--
-- The 4 existing olive_memory_files.embedding rows are NULLed first so
-- the column type change can proceed. They will be regenerated on the
-- next olive-compile-memory cron run (daily 02:00 UTC).
--
-- olive_memory_chunks.embedding is already 100% NULL — no pre-clear
-- needed.
--
-- No HNSW/IVFFlat indexes on these columns to recreate. The partial
-- index idx_chunks_null_embedding (importance, created_at WHERE
-- embedding IS NULL) is unaffected — it does not index the vector
-- itself, just predicates on null-ness.

UPDATE olive_memory_files SET embedding = NULL;

ALTER TABLE olive_memory_files
  ALTER COLUMN embedding TYPE vector(768);

ALTER TABLE olive_memory_chunks
  ALTER COLUMN embedding TYPE vector(768);
