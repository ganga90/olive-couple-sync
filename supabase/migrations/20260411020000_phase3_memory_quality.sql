-- Phase 3: Memory Quality Loop + Conversational Memory
-- Adds maintenance tracking, contradiction logging, and conversation memory support

-- ─── 1. Memory maintenance log ──────────────────────────────────────
-- Tracks every maintenance run (consolidation, decay, dedup, contradiction)
CREATE TABLE IF NOT EXISTS olive_memory_maintenance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  run_type TEXT NOT NULL CHECK (run_type IN (
    'consolidation', 'decay', 'contradiction', 'entity_dedup', 'full'
  )),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  stats JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_log_user
  ON olive_memory_maintenance_log(user_id, run_type, started_at DESC);

-- ─── 2. Contradiction log ───────────────────────────────────────────
-- When the system detects conflicting facts, they're logged here
-- for the compilation step to resolve
CREATE TABLE IF NOT EXISTS olive_memory_contradictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  chunk_a_id UUID REFERENCES olive_memory_chunks(id) ON DELETE SET NULL,
  chunk_b_id UUID REFERENCES olive_memory_chunks(id) ON DELETE SET NULL,
  chunk_a_content TEXT NOT NULL,
  chunk_b_content TEXT NOT NULL,
  contradiction_type TEXT NOT NULL CHECK (contradiction_type IN (
    'factual', 'preference', 'temporal', 'behavioral'
  )),
  confidence FLOAT NOT NULL DEFAULT 0.5,
  resolution TEXT CHECK (resolution IN (
    'keep_newer', 'keep_older', 'merge', 'ask_user', 'unresolved'
  )) DEFAULT 'unresolved',
  resolved_content TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contradictions_user_unresolved
  ON olive_memory_contradictions(user_id, resolution)
  WHERE resolution = 'unresolved';

-- ─── 3. Add maintenance columns to olive_memory_chunks ──────────────
-- last_accessed_at: when this chunk was last used in context building
-- decay_factor: importance multiplier (1.0 = full, decays over time)
-- consolidated_into: if merged, points to the surviving chunk
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_chunks' AND column_name = 'last_accessed_at'
  ) THEN
    ALTER TABLE olive_memory_chunks ADD COLUMN last_accessed_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_chunks' AND column_name = 'decay_factor'
  ) THEN
    ALTER TABLE olive_memory_chunks ADD COLUMN decay_factor FLOAT NOT NULL DEFAULT 1.0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_chunks' AND column_name = 'consolidated_into'
  ) THEN
    ALTER TABLE olive_memory_chunks ADD COLUMN consolidated_into UUID REFERENCES olive_memory_chunks(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_chunks' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE olive_memory_chunks ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
  END IF;
END $$;

-- Index for active chunks (used in search & maintenance)
CREATE INDEX IF NOT EXISTS idx_chunks_active
  ON olive_memory_chunks(user_id, is_active, importance DESC)
  WHERE is_active = true;

-- Index for decay candidates
CREATE INDEX IF NOT EXISTS idx_chunks_decay
  ON olive_memory_chunks(user_id, last_accessed_at)
  WHERE is_active = true AND last_accessed_at IS NOT NULL;

-- ─── 4. Conversation memory source tracking ─────────────────────────
-- Add source_message_id to trace chunks back to specific conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_memory_chunks' AND column_name = 'source_message_id'
  ) THEN
    ALTER TABLE olive_memory_chunks ADD COLUMN source_message_id TEXT;
  END IF;
END $$;

-- ─── 5. Helper: Find similar chunks for consolidation ───────────────
CREATE OR REPLACE FUNCTION public.find_similar_chunks(
  p_user_id TEXT,
  p_embedding vector(768),
  p_threshold FLOAT DEFAULT 0.92,
  p_limit INT DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  chunk_type TEXT,
  importance INT,
  source TEXT,
  similarity FLOAT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    c.source,
    1 - (c.embedding <=> p_embedding) AS similarity,
    c.created_at
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> p_embedding) >= p_threshold
  ORDER BY c.embedding <=> p_embedding
  LIMIT p_limit;
$$;

-- ─── 6. Helper: Get chunks needing decay ────────────────────────────
CREATE OR REPLACE FUNCTION public.get_decay_candidates(
  p_user_id TEXT,
  p_stale_days INT DEFAULT 90,
  p_limit INT DEFAULT 100
)
RETURNS TABLE(
  id UUID,
  content TEXT,
  importance INT,
  decay_factor FLOAT,
  last_accessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  days_stale INT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.content,
    c.importance,
    c.decay_factor,
    c.last_accessed_at,
    c.created_at,
    EXTRACT(DAY FROM now() - COALESCE(c.last_accessed_at, c.created_at))::INT AS days_stale
  FROM olive_memory_chunks c
  WHERE c.user_id = p_user_id
    AND c.is_active = true
    AND c.importance <= 3  -- Only decay low-importance chunks
    AND COALESCE(c.last_accessed_at, c.created_at) < now() - (p_stale_days || ' days')::interval
  ORDER BY COALESCE(c.last_accessed_at, c.created_at) ASC
  LIMIT p_limit;
$$;

-- ─── 7. Helper: Memory health metrics ──────────────────────────────
CREATE OR REPLACE FUNCTION public.get_memory_health(p_user_id TEXT)
RETURNS JSONB
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'total_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id),
    'active_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'inactive_chunks', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = false),
    'avg_importance', (SELECT ROUND(AVG(importance)::numeric, 2) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'avg_decay', (SELECT ROUND(AVG(decay_factor)::numeric, 3) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true),
    'chunks_with_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NOT NULL),
    'chunks_without_embeddings', (SELECT count(*) FROM olive_memory_chunks WHERE user_id = p_user_id AND is_active = true AND embedding IS NULL),
    'unresolved_contradictions', (SELECT count(*) FROM olive_memory_contradictions WHERE user_id = p_user_id AND resolution = 'unresolved'),
    'total_memories', (SELECT count(*) FROM user_memories WHERE user_id = p_user_id AND is_active = true),
    'total_entities', (SELECT count(*) FROM olive_entities WHERE user_id = p_user_id),
    'total_relationships', (SELECT count(*) FROM olive_relationships WHERE user_id = p_user_id),
    'memory_files', (SELECT count(*) FROM olive_memory_files WHERE user_id = p_user_id),
    'last_maintenance', (
      SELECT jsonb_build_object('run_type', run_type, 'completed_at', completed_at, 'stats', stats)
      FROM olive_memory_maintenance_log
      WHERE user_id = p_user_id AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT 1
    ),
    'last_compilation', (
      SELECT updated_at FROM olive_memory_files
      WHERE user_id = p_user_id AND file_type = 'profile'
      AND file_date IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    )
  );
$$;

-- ─── 8. pg_cron: Weekly maintenance at 3am UTC on Sundays ──────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'olive-memory-maintenance-weekly'
  ) THEN
    PERFORM cron.schedule(
      'olive-memory-maintenance-weekly',
      '0 3 * * 0',
      $$
      SELECT net.http_post(
        url := current_setting('supabase_functions_endpoint') || '/olive-memory-maintenance',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        ),
        body := '{"action":"run_maintenance","run_type":"full"}'::jsonb
      );
      $$
    );
  END IF;
END $$;
