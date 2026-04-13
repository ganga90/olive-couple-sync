-- Sprint 6: Consolidation + Evolution Safety
-- =============================================
-- Adds nightly memory consolidation tracking, memory relevance decay,
-- soul evolution safety rails (drift detection, rollback, rate limiting).
-- All tables are ADDITIVE — no existing tables modified or dropped.

-- ─── Memory Consolidation Runs ────────────────────────────────
-- Tracks each nightly consolidation run: what was merged, deduped, compacted.
CREATE TABLE IF NOT EXISTS olive_consolidation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Run metadata
  run_type TEXT NOT NULL DEFAULT 'nightly'
    CHECK (run_type IN ('nightly', 'manual', 'weekly_deep')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'partial')),

  -- Results
  memories_scanned INT DEFAULT 0,
  memories_merged INT DEFAULT 0,        -- similar memories combined
  memories_archived INT DEFAULT 0,      -- decayed memories moved to cold
  memories_deduplicated INT DEFAULT 0,  -- exact/near-exact duplicates removed
  chunks_compacted INT DEFAULT 0,       -- daily log chunks summarized
  daily_logs_compacted INT DEFAULT 0,   -- daily logs older than 30d summarized
  token_savings INT DEFAULT 0,          -- estimated tokens freed

  -- Details
  merge_details JSONB DEFAULT '[]',     -- [{ memory_ids: [], merged_into: id, reason }]
  error_message TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consolidation_runs_user
  ON olive_consolidation_runs (user_id, started_at DESC);

-- ─── Memory Relevance Scores ──────────────────────────────────
-- Time-weighted relevance for each memory. Decays over time, boosted by access.
-- Lives alongside user_memories (not replacing it).
CREATE TABLE IF NOT EXISTS olive_memory_relevance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL,               -- FK to user_memories.id
  user_id TEXT NOT NULL,

  -- Relevance scoring
  relevance_score FLOAT NOT NULL DEFAULT 1.0,  -- 0.0 to 1.0
  access_count INT DEFAULT 0,                  -- times retrieved for context
  last_accessed_at TIMESTAMPTZ,
  decay_rate FLOAT DEFAULT 0.02,               -- daily decay factor

  -- Archival
  is_archived BOOLEAN DEFAULT false,           -- moved to cold storage
  archived_at TIMESTAMPTZ,
  archive_reason TEXT,                         -- 'decay', 'consolidation', 'manual'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (memory_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memory_relevance_user
  ON olive_memory_relevance (user_id, relevance_score DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_memory_relevance_archived
  ON olive_memory_relevance (user_id, is_archived)
  WHERE is_archived = true;

-- ─── Soul Evolution Safety ────────────────────────────────────
-- Tracks evolution cycles with drift detection and rate limiting.
CREATE TABLE IF NOT EXISTS olive_soul_evolution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  layer_type TEXT NOT NULL,

  -- What changed
  proposals_count INT DEFAULT 0,
  proposals_applied INT DEFAULT 0,
  proposals_deferred INT DEFAULT 0,
  proposals_blocked INT DEFAULT 0,         -- blocked by safety rails

  -- Drift detection
  drift_score FLOAT DEFAULT 0.0,           -- 0.0 = no drift, 1.0 = complete identity shift
  drift_details JSONB DEFAULT '{}',        -- { fields_changed: [], token_delta, semantic_distance }

  -- Safety
  was_rate_limited BOOLEAN DEFAULT false,
  was_rollback BOOLEAN DEFAULT false,
  rollback_reason TEXT,
  rollback_to_version INT,

  -- Metadata
  trigger TEXT,                            -- 'cron', 'manual', 'reflection'
  changes_summary TEXT[],                  -- human-readable list of changes
  pre_snapshot_version INT,                -- version before evolution
  post_snapshot_version INT,               -- version after evolution

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soul_evolution_log_user
  ON olive_soul_evolution_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soul_evolution_log_drift
  ON olive_soul_evolution_log (user_id, drift_score DESC)
  WHERE drift_score > 0.3;

-- ─── Soul Rollback Requests ───────────────────────────────────
-- When a user or safety system wants to roll back a soul evolution.
CREATE TABLE IF NOT EXISTS olive_soul_rollbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  layer_id UUID NOT NULL,                  -- FK to olive_soul_layers.id
  layer_type TEXT NOT NULL,

  -- Rollback details
  from_version INT NOT NULL,
  to_version INT NOT NULL,
  reason TEXT NOT NULL,                    -- 'user_request', 'drift_exceeded', 'safety_violation', 'auto_revert'
  requested_by TEXT NOT NULL DEFAULT 'user', -- 'user', 'system', 'safety_rail'

  -- Status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'failed')),
  applied_at TIMESTAMPTZ,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_soul_rollbacks_user
  ON olive_soul_rollbacks (user_id, created_at DESC);

-- ─── RPC: Apply memory decay ──────────────────────────────────
-- Called by the consolidation pipeline. Decays all non-archived memories
-- based on time since last access. Returns count of newly archived.
CREATE OR REPLACE FUNCTION apply_memory_decay(p_user_id TEXT, p_archive_threshold FLOAT DEFAULT 0.1)
RETURNS INT AS $$
DECLARE
  v_archived_count INT;
BEGIN
  -- Decay relevance based on days since last access
  UPDATE olive_memory_relevance
  SET
    relevance_score = GREATEST(0.0, relevance_score - (
      decay_rate * EXTRACT(EPOCH FROM (now() - COALESCE(last_accessed_at, created_at))) / 86400.0
    )),
    updated_at = now()
  WHERE user_id = p_user_id
    AND is_archived = false;

  -- Archive memories below threshold
  UPDATE olive_memory_relevance
  SET
    is_archived = true,
    archived_at = now(),
    archive_reason = 'decay'
  WHERE user_id = p_user_id
    AND is_archived = false
    AND relevance_score < p_archive_threshold;

  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  -- Also soft-delete the corresponding user_memories entries
  UPDATE user_memories
  SET is_active = false, updated_at = now()
  WHERE user_id = p_user_id
    AND id IN (
      SELECT memory_id FROM olive_memory_relevance
      WHERE user_id = p_user_id AND is_archived = true AND archive_reason = 'decay'
    )
    AND is_active = true;

  RETURN v_archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RPC: Boost memory relevance on access ────────────────────
CREATE OR REPLACE FUNCTION boost_memory_relevance(p_memory_id UUID, p_user_id TEXT, p_boost FLOAT DEFAULT 0.15)
RETURNS void AS $$
BEGIN
  INSERT INTO olive_memory_relevance (memory_id, user_id, relevance_score, access_count, last_accessed_at)
  VALUES (p_memory_id, p_user_id, LEAST(1.0, 1.0), 1, now())
  ON CONFLICT (memory_id, user_id) DO UPDATE SET
    relevance_score = LEAST(1.0, olive_memory_relevance.relevance_score + p_boost),
    access_count = olive_memory_relevance.access_count + 1,
    last_accessed_at = now(),
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RLS Policies ──────────────────────────────��──────────────
ALTER TABLE olive_consolidation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_memory_relevance ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_soul_evolution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_soul_rollbacks ENABLE ROW LEVEL SECURITY;

-- Consolidation runs: users see their own
CREATE POLICY "Users see own consolidation runs"
  ON olive_consolidation_runs FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages consolidation runs"
  ON olive_consolidation_runs FOR ALL
  USING (true) WITH CHECK (true);

-- Memory relevance: users see their own
CREATE POLICY "Users see own memory relevance"
  ON olive_memory_relevance FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages memory relevance"
  ON olive_memory_relevance FOR ALL
  USING (true) WITH CHECK (true);

-- Soul evolution log: users see their own
CREATE POLICY "Users see own soul evolution log"
  ON olive_soul_evolution_log FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages soul evolution log"
  ON olive_soul_evolution_log FOR ALL
  USING (true) WITH CHECK (true);

-- Soul rollbacks: users see their own
CREATE POLICY "Users see own soul rollbacks"
  ON olive_soul_rollbacks FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can create own soul rollbacks"
  ON olive_soul_rollbacks FOR INSERT
  WITH CHECK (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages soul rollbacks"
  ON olive_soul_rollbacks FOR ALL
  USING (true) WITH CHECK (true);
