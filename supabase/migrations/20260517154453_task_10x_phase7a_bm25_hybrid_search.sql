-- TASK-10X-Phase7a: BM25 full-text + RRF hybrid search on olive_memory_chunks
--
-- Background
--   The 10X audit (P0-2, OLIVE_10X_PLAN.md) flagged that the "70%
--   vector + 30% BM25" hybrid-search claim in the codebase has no DB
--   foundation: there is no tsvector column, no GIN index, no fusion
--   function. Memory retrieval falls back to vector-only — keyword
--   queries ("call dentist Tuesday") that happen to be paraphrased
--   in the embeddings can still be missed.
--
--   This migration is the additive foundation. It does NOT change
--   any read path. Phase 7c will switch _shared/memory-retrieval.ts
--   to call search_memory_chunks_hybrid once we have prod-shape
--   evidence that the rankings are sensible.
--
-- What it adds
--   1. olive_memory_chunks.search_tsv — generated tsvector column
--      over `content` using the english text-search configuration.
--      Generated columns are populated automatically by Postgres
--      on insert/update; no application code change needed.
--   2. idx_chunks_search_tsv — GIN index on the new column. This
--      is the BM25 (ts_rank_cd) backing index. Without it, FTS
--      queries do a full seq-scan over content.
--   3. search_memory_chunks_hybrid(...) — new SQL function that
--      fuses vector-similarity and BM25 rankings using Reciprocal
--      Rank Fusion (RRF). RRF is the canonical fusion algorithm
--      that doesn't require per-source score normalization, so it
--      degrades gracefully when either source returns thin
--      candidates.
--
-- Why RRF over weighted-sum
--   ts_rank_cd returns small unnormalized floats (typically
--   0.0–0.5). Cosine similarity is in [-1, 1]. A simple weighted
--   sum of those is dominated by whichever scale happens to be
--   larger, and shifts when document lengths change. RRF is
--   rank-based: each result contributes 1 / (k + rank). The
--   constant `k=60` is the published default; it keeps top results
--   sharply weighted while smoothing out the long tail.
--
-- Compatibility
--   - Existing search_memory_chunks(...) function is UNCHANGED.
--   - Existing read paths in _shared/memory-retrieval.ts UNCHANGED.
--   - New function is additive; callers opt in by name.
--
-- Cost
--   - One GIN index on olive_memory_chunks (small: 126 rows today;
--     scales as N*M where M is average distinct tokens per chunk).
--   - One tsvector column (English, stemmed; small text overhead).
--   - No backfill needed — the column is GENERATED ALWAYS so it
--     populates on insert/update automatically. The CREATE itself
--     populates existing rows synchronously during the ALTER.
--
-- DOWN
--   DROP FUNCTION IF EXISTS public.search_memory_chunks_hybrid(text, vector, text, integer, integer, double precision, double precision);
--   DROP INDEX IF EXISTS public.idx_chunks_search_tsv;
--   ALTER TABLE public.olive_memory_chunks DROP COLUMN IF EXISTS search_tsv;

-- ──────────────────────────────────────────────────────────────────
-- 1) Generated tsvector column
-- ──────────────────────────────────────────────────────────────────

ALTER TABLE public.olive_memory_chunks
  ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

-- ──────────────────────────────────────────────────────────────────
-- 2) GIN index for fast BM25 / tsvector matches
-- ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_chunks_search_tsv
  ON public.olive_memory_chunks
  USING gin (search_tsv);

-- ──────────────────────────────────────────────────────────────────
-- 3) RRF hybrid search function
--
--   Parameters
--     p_user_id           — scope to one user (RLS-equivalent guard)
--     p_query_embedding   — 768-dim vector from the embedder
--     p_query_text        — raw user query for BM25
--     p_limit             — number of rows to return
--     p_min_importance    — same gate the existing function uses
--     p_vector_weight     — RRF weight on the vector ranking
--     p_bm25_weight       — RRF weight on the BM25 ranking
--
--   Returns the same shape as search_memory_chunks(...) plus two
--   diagnostic columns: bm25_score (raw ts_rank_cd) and
--   hybrid_score (the RRF-fused score used for ORDER BY).
--
--   Algorithm
--     Stage 1 — pull p_limit * 4 candidates from each path:
--       * vector_ranked: HNSW-backed ORDER BY embedding <=> query
--       * bm25_ranked:   GIN-backed ts_rank_cd ranking
--     Stage 2 — RRF fuse by `id`. Candidates that appear in only
--       one path contribute zero on the other side.
--     Stage 3 — return p_limit rows ordered by hybrid_score DESC.
--
--   `k=60` is the published RRF default (Cormack et al. 2009).
-- ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.search_memory_chunks_hybrid(
  p_user_id text,
  p_query_embedding vector,
  p_query_text text,
  p_limit integer DEFAULT 8,
  p_min_importance integer DEFAULT 2,
  p_vector_weight double precision DEFAULT 0.7,
  p_bm25_weight double precision DEFAULT 0.3
)
RETURNS TABLE(
  id uuid,
  content text,
  chunk_type text,
  importance integer,
  similarity double precision,
  bm25_score double precision,
  hybrid_score double precision,
  source text,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH
    -- Top vector candidates ranked by cosine distance to query.
    -- LIMIT 4x oversample so reranking has signal.
    vector_ranked AS (
      SELECT
        c.id,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> p_query_embedding) AS v_rank,
        1.0 - (c.embedding <=> p_query_embedding) AS v_sim
      FROM olive_memory_chunks c
      WHERE c.user_id = p_user_id
        AND c.is_active = true
        AND c.importance >= p_min_importance
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> p_query_embedding
      LIMIT p_limit * 4
    ),
    -- Top BM25 candidates by ts_rank_cd over the GIN-indexed tsvector.
    -- plainto_tsquery is the safest parser for free-form user text
    -- (it ignores operators and just AND's the lemmatised tokens).
    -- When the parsed query is empty (e.g. all stopwords), the @@
    -- match below returns zero rows and the CTE is empty — the RRF
    -- step handles that gracefully via LEFT JOIN below.
    bm25_query AS (
      SELECT plainto_tsquery('english', coalesce(p_query_text, '')) AS q
    ),
    bm25_ranked AS (
      SELECT
        c.id,
        ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.search_tsv, (SELECT q FROM bm25_query)) DESC) AS b_rank,
        ts_rank_cd(c.search_tsv, (SELECT q FROM bm25_query))::double precision AS b_score
      FROM olive_memory_chunks c
      WHERE c.user_id = p_user_id
        AND c.is_active = true
        AND c.importance >= p_min_importance
        AND c.search_tsv @@ (SELECT q FROM bm25_query)
      ORDER BY ts_rank_cd(c.search_tsv, (SELECT q FROM bm25_query)) DESC
      LIMIT p_limit * 4
    ),
    -- Union the two candidate sets so we score every distinct id.
    candidates AS (
      SELECT id FROM vector_ranked
      UNION
      SELECT id FROM bm25_ranked
    )
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    COALESCE(vr.v_sim, 0.0) AS similarity,
    COALESCE(br.b_score, 0.0) AS bm25_score,
    -- Reciprocal Rank Fusion. k=60 is the published default.
    (p_vector_weight * (1.0 / (60.0 + COALESCE(vr.v_rank, 1e9)))
     + p_bm25_weight  * (1.0 / (60.0 + COALESCE(br.b_rank, 1e9)))) AS hybrid_score,
    c.source,
    c.created_at
  FROM candidates ca
  JOIN olive_memory_chunks c ON c.id = ca.id
  LEFT JOIN vector_ranked vr ON vr.id = ca.id
  LEFT JOIN bm25_ranked   br ON br.id = ca.id
  ORDER BY
    (p_vector_weight * (1.0 / (60.0 + COALESCE(vr.v_rank, 1e9)))
     + p_bm25_weight  * (1.0 / (60.0 + COALESCE(br.b_rank, 1e9)))) DESC
  LIMIT p_limit;
$function$;

-- Restrict execution to authenticated roles only (matches the existing
-- search_memory_chunks function's posture).
REVOKE ALL ON FUNCTION public.search_memory_chunks_hybrid(text, vector, text, integer, integer, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_memory_chunks_hybrid(text, vector, text, integer, integer, double precision, double precision) TO authenticated, service_role;
