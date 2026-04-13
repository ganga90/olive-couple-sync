-- Olive SOUL.MD System — Composable Soul Architecture
-- =====================================================
-- Implements a layered soul system where each layer evolves independently.
-- Layers: base (system), user (personal), space (group), skill (dynamic), trust (per-action).
-- Feature-flagged via olive_user_preferences.soul_enabled (default false).

-- ─── Soul Layers Table ──────────────────────────────────────────
-- Each row is one layer of the soul stack for a specific owner.
CREATE TABLE IF NOT EXISTS olive_soul_layers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_type TEXT NOT NULL CHECK (layer_type IN ('base', 'user', 'space', 'skill', 'trust')),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('system', 'user', 'space')),
  owner_id TEXT,  -- null for system, user_id (TEXT) for user, space_id (UUID::TEXT) for space
  version INT NOT NULL DEFAULT 1,
  content JSONB NOT NULL DEFAULT '{}',
  content_rendered TEXT,  -- Pre-rendered markdown for LLM injection (cached)
  token_count INT DEFAULT 0,  -- Pre-computed token count for budget tracking
  is_locked BOOLEAN NOT NULL DEFAULT false,  -- User can lock layers to prevent evolution
  evolved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint: one layer per type per owner
CREATE UNIQUE INDEX idx_soul_layers_unique
  ON olive_soul_layers (layer_type, owner_type, COALESCE(owner_id, '__system__'));

-- Fast lookups
CREATE INDEX idx_soul_layers_user
  ON olive_soul_layers (owner_id) WHERE owner_type = 'user';
CREATE INDEX idx_soul_layers_space
  ON olive_soul_layers (owner_id) WHERE owner_type = 'space';

-- ─── Soul Version History ───────────────────────────────────────
-- Stores previous versions of each layer for rollback.
-- Keep last 20 versions per layer (enforced at application level).
CREATE TABLE IF NOT EXISTS olive_soul_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layer_id UUID NOT NULL REFERENCES olive_soul_layers(id) ON DELETE CASCADE,
  version INT NOT NULL,
  content JSONB NOT NULL,
  content_rendered TEXT,
  change_summary TEXT,
  trigger TEXT CHECK (trigger IN (
    'onboarding', 'pattern_detection', 'explicit_intent', 'engagement_decay',
    'feedback', 'reflection', 'trust_escalation', 'manual', 'system'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_soul_versions_layer
  ON olive_soul_versions (layer_id, version DESC);

-- ─── Reflections Table ──────────────────────────────────────────
-- Tracks outcomes of Olive's actions for self-improvement.
CREATE TABLE IF NOT EXISTS olive_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  space_id TEXT,  -- null for personal context
  action_type TEXT NOT NULL,  -- e.g. 'categorize_note', 'send_reminder', 'delegation'
  action_detail JSONB DEFAULT '{}',
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'modified', 'rejected', 'ignored')),
  user_modification TEXT,  -- what the user changed (if modified)
  lesson TEXT,  -- distilled learning
  confidence FLOAT DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  applied_to_soul BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reflections_user ON olive_reflections (user_id, created_at DESC);
CREATE INDEX idx_reflections_action ON olive_reflections (action_type, outcome);
CREATE INDEX idx_reflections_unapplied ON olive_reflections (applied_to_soul) WHERE applied_to_soul = false;

-- ─── Engagement Metrics Table ───────────────────────────────────
-- Rolling engagement score that governs proactivity level.
CREATE TABLE IF NOT EXISTS olive_engagement_metrics (
  user_id TEXT PRIMARY KEY,
  score INT NOT NULL DEFAULT 50 CHECK (score BETWEEN 0 AND 100),
  messages_sent_7d INT NOT NULL DEFAULT 0,
  messages_responded_7d INT NOT NULL DEFAULT 0,
  proactive_accepted_7d INT NOT NULL DEFAULT 0,
  proactive_ignored_7d INT NOT NULL DEFAULT 0,
  proactive_rejected_7d INT NOT NULL DEFAULT 0,
  avg_response_time_seconds INT,
  last_interaction TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Feature Flag: soul_enabled ─────────────────────────────────
-- Add to existing preferences table. Default FALSE = no disruption to existing users.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_user_preferences' AND column_name = 'soul_enabled'
  ) THEN
    ALTER TABLE olive_user_preferences ADD COLUMN soul_enabled BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- ─── Seed Layer 0: Base Soul ────────────────────────────────────
-- The universal Olive identity, same for all users, never evolves.
INSERT INTO olive_soul_layers (layer_type, owner_type, owner_id, version, content, content_rendered, token_count, is_locked)
VALUES (
  'base',
  'system',
  NULL,
  1,
  '{
    "identity": {
      "name": "Olive",
      "role": "AI assistant that organizes chaos",
      "core_principle": "She remembers, so you don''t have to"
    },
    "personality": {
      "default_tone": "warm",
      "empathy": true,
      "proactive": true,
      "honest": true
    },
    "rules": {
      "never_fabricate_data": true,
      "respect_privacy_boundaries": true,
      "ask_before_irreversible_actions": true,
      "respect_quiet_hours": true,
      "never_share_cross_space_data": true
    }
  }',
  E'You are Olive, a warm and intelligent AI assistant who organizes chaos. Your core principle: "She remembers, so you don''t have to."\n\nPersonality: warm, empathetic, proactive, honest. You take initiative but always respect boundaries.\n\nRules you never break:\n- Never fabricate data or memories\n- Respect privacy boundaries between spaces\n- Ask before taking irreversible actions\n- Respect quiet hours\n- Never share one space''s data with another space''s members',
  120,
  true  -- Base soul is always locked
)
ON CONFLICT DO NOTHING;  -- Idempotent: don't re-insert if already exists

-- ─── RLS Policies ───────────────────────────────────────────────
ALTER TABLE olive_soul_layers ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_soul_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_engagement_metrics ENABLE ROW LEVEL SECURITY;

-- Soul layers: users see system layers + their own
CREATE POLICY "Users see base and own soul layers"
  ON olive_soul_layers FOR SELECT
  USING (owner_type = 'system' OR owner_id = (SELECT auth.uid()::text));

-- Service role can do everything (edge functions use service key)
CREATE POLICY "Service role manages soul layers"
  ON olive_soul_layers FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users see own soul versions"
  ON olive_soul_versions FOR SELECT
  USING (
    layer_id IN (
      SELECT id FROM olive_soul_layers
      WHERE owner_type = 'system' OR owner_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages soul versions"
  ON olive_soul_versions FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users see own reflections"
  ON olive_reflections FOR SELECT
  USING (user_id = (SELECT auth.uid()::text));

CREATE POLICY "Service role manages reflections"
  ON olive_reflections FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users see own engagement"
  ON olive_engagement_metrics FOR SELECT
  USING (user_id = (SELECT auth.uid()::text));

CREATE POLICY "Service role manages engagement"
  ON olive_engagement_metrics FOR ALL
  USING (true) WITH CHECK (true);
