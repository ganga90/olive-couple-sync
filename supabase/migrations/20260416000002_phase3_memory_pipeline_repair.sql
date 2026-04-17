-- Phase 3 — Memory Pipeline Repair
-- =================================
-- The memory pipeline has a critical gap: chunks are extracted from
-- conversations but (a) the RPCs the orchestrator calls to search them
-- don't exist in production, and (b) many chunks lack embeddings.
--
-- This migration:
--   1. Creates `search_memory_chunks` — semantic vector search on
--      olive_memory_chunks (the RPC the orchestrator already calls).
--   2. Creates `hybrid_search_notes` — combined vector + text search
--      on clerk_notes (the RPC the orchestrator already calls).
--   3. Creates `fetch_top_memory_chunks` — importance-only fallback
--      that works WITHOUT an embedding (for when we don't have a
--      query vector, e.g. proactive messages, batch operations).
--   4. Creates `backfill_chunk_embeddings` — returns chunks needing
--      embedding backfill so the heartbeat can drive repairs.
--
-- All functions use unconstrained `vector` (no dimension suffix) to
-- match the actual column types in production.

-- ─── 1. search_memory_chunks ──────────────────────────────────────
-- Semantic search on olive_memory_chunks via cosine similarity.
-- Called by orchestrator.ts Layer 4 (line ~710).
CREATE OR REPLACE FUNCTION public.search_memory_chunks(
  p_user_id       TEXT,
  p_query_embedding vector,
  p_limit         INTEGER DEFAULT 8,
  p_min_importance INTEGER DEFAULT 2
)
RETURNS TABLE(
  id          UUID,
  content     TEXT,
  chunk_type  TEXT,
  importance  INTEGER,
  similarity  FLOAT,
  source      TEXT,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    c.source,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.importance >= p_min_importance
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.search_memory_chunks(TEXT, vector, INTEGER, INTEGER) IS
  'Semantic search on olive_memory_chunks. Returns top-k chunks by cosine similarity, filtered by importance floor. Used by orchestrator Layer 4.';


-- ─── 2. hybrid_search_notes ──────────────────────────────────────
-- Combined vector + full-text search on clerk_notes.
-- Called by orchestrator.ts Layer 4 for contextual_ask intent.
CREATE OR REPLACE FUNCTION public.hybrid_search_notes(
  p_user_id        TEXT,
  p_couple_id      TEXT,
  p_query          TEXT,
  p_query_embedding vector,
  p_vector_weight  FLOAT DEFAULT 0.7,
  p_limit          INTEGER DEFAULT 15
)
RETURNS TABLE(
  id            UUID,
  original_text TEXT,
  summary       TEXT,
  category      TEXT,
  due_date      DATE,
  priority      TEXT,
  completed     BOOLEAN,
  score         FLOAT
)
LANGUAGE plpgsql STABLE SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      n.id,
      1 - (n.embedding <=> p_query_embedding) AS vector_score
    FROM clerk_notes n
    WHERE (n.author_id = p_user_id OR n.couple_id = p_couple_id)
      AND n.embedding IS NOT NULL
    ORDER BY n.embedding <=> p_query_embedding
    LIMIT p_limit * 2
  ),
  text_results AS (
    SELECT
      n.id,
      ts_rank_cd(n.search_vector, websearch_to_tsquery('english', p_query)) AS text_score
    FROM clerk_notes n
    WHERE (n.author_id = p_user_id OR n.couple_id = p_couple_id)
      AND n.search_vector IS NOT NULL
      AND n.search_vector @@ websearch_to_tsquery('english', p_query)
    ORDER BY text_score DESC
    LIMIT p_limit * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) AS note_id,
      COALESCE(v.vector_score, 0) * p_vector_weight
        + COALESCE(t.text_score, 0) * (1 - p_vector_weight) AS combined_score
    FROM vector_results v
    FULL OUTER JOIN text_results t ON v.id = t.id
  )
  SELECT
    n.id,
    n.original_text,
    n.summary,
    n.category,
    n.due_date,
    n.priority,
    n.completed,
    c.combined_score AS score
  FROM combined c
  JOIN clerk_notes n ON n.id = c.note_id
  ORDER BY c.combined_score DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.hybrid_search_notes(TEXT, TEXT, TEXT, vector, FLOAT, INTEGER) IS
  'Hybrid vector + full-text search on clerk_notes. Combines cosine similarity with ts_rank for relevance scoring.';


-- ─── 3. fetch_top_memory_chunks (importance-only, NO embedding) ──
-- Fallback for when no query embedding is available.
-- Returns top-k active chunks by importance × recency.
CREATE OR REPLACE FUNCTION public.fetch_top_memory_chunks(
  p_user_id        TEXT,
  p_limit          INTEGER DEFAULT 8,
  p_min_importance INTEGER DEFAULT 3
)
RETURNS TABLE(
  id          UUID,
  content     TEXT,
  chunk_type  TEXT,
  importance  INTEGER,
  source      TEXT,
  decay_factor FLOAT,
  created_at  TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    c.source,
    c.decay_factor,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.importance >= p_min_importance
  ORDER BY
    -- Primary: importance (weighted by decay)
    c.importance * COALESCE(c.decay_factor, 1.0) DESC,
    -- Secondary: recency
    c.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fetch_top_memory_chunks(TEXT, INTEGER, INTEGER) IS
  'Importance-only retrieval of memory chunks. No embedding required. Used as fallback when no query embedding is available, ensuring maintained memories always reach the LLM prompt.';


-- ─── 4. backfill_chunk_embeddings — returns chunks needing repair ─
-- Used by the heartbeat to drive incremental embedding backfill
-- instead of waiting for the weekly maintenance cron.
CREATE OR REPLACE FUNCTION public.get_chunks_needing_embeddings(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  id      UUID,
  user_id TEXT,
  content TEXT
)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $$
  SELECT c.id, c.user_id, c.content
  FROM olive_memory_chunks c
  WHERE c.is_active = true
    AND c.embedding IS NULL
    AND c.content IS NOT NULL
    AND length(c.content) > 5
  ORDER BY c.importance DESC, c.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_chunks_needing_embeddings(INTEGER) IS
  'Returns active memory chunks missing embeddings, ordered by importance. Used by heartbeat for incremental backfill (not waiting for weekly maintenance).';


-- ─── 5. get_notes_needing_embeddings — same for clerk_notes ──────
CREATE OR REPLACE FUNCTION public.get_notes_needing_embeddings(
  p_limit INTEGER DEFAULT 20
)
RETURNS TABLE(
  id      UUID,
  user_id TEXT,
  content TEXT
)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $$
  SELECT n.id, n.author_id AS user_id,
         COALESCE(n.original_text, n.summary, '') AS content
  FROM clerk_notes n
  WHERE n.embedding IS NULL
    AND n.original_text IS NOT NULL
    AND length(COALESCE(n.original_text, n.summary, '')) > 5
  ORDER BY n.created_at DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.get_notes_needing_embeddings(INTEGER) IS
  'Returns clerk_notes missing embeddings for incremental backfill by heartbeat.';


-- ─── 6. Index to accelerate importance-only retrieval ─────────────
-- The existing idx_chunks_active covers (user_id, is_active, importance DESC)
-- which is exactly what fetch_top_memory_chunks needs. Verify it exists:
CREATE INDEX IF NOT EXISTS idx_chunks_active
  ON olive_memory_chunks(user_id, is_active, importance DESC)
  WHERE is_active = true;

-- Index for embedding-null backfill scan
CREATE INDEX IF NOT EXISTS idx_chunks_null_embedding
  ON olive_memory_chunks(importance DESC, created_at DESC)
  WHERE is_active = true AND embedding IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_null_embedding
  ON clerk_notes(created_at DESC)
  WHERE embedding IS NULL AND original_text IS NOT NULL;
