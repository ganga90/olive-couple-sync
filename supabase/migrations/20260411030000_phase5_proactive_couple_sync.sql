-- Phase 5: Proactive Intelligence (Option A) + Couple Sync (Option B)
-- Adds proactive-intelligence agent, couple_id on relationships, couple-level compilation

-- ─── 1. Add couple_id to olive_relationships ───────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_relationships' AND column_name = 'couple_id'
  ) THEN
    ALTER TABLE olive_relationships ADD COLUMN couple_id UUID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_relationships_couple
  ON olive_relationships(couple_id)
  WHERE couple_id IS NOT NULL;

-- ─── 2. Register proactive-intelligence agent ──────────────────────
INSERT INTO olive_skills (
  skill_id, name, description, category, agent_type, schedule,
  agent_config, requires_connection, requires_approval
)
VALUES (
  'proactive-intelligence',
  'Proactive Intelligence',
  'Reads your compiled knowledge (profile, patterns, household) to generate smart, personalized nudges based on your routines and habits.',
  'productivity',
  'background_agent',
  'daily_9am',
  '{"nudge_types": ["routine_reminder", "pattern_deviation", "goal_progress", "couple_coordination"], "max_nudges": 3}'::jsonb,
  NULL,
  false
)
ON CONFLICT (skill_id) DO UPDATE SET
  description = EXCLUDED.description,
  agent_config = EXCLUDED.agent_config,
  schedule = EXCLUDED.schedule;

-- ─── 3. Couple-scoped memory file query helper ────────────────────
-- Get compiled memory files for an entire couple (both partners)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.get_couple_compiled_files(
  p_couple_id UUID,
  p_file_types TEXT[] DEFAULT ARRAY['profile', 'patterns', 'relationship', 'household']
)
RETURNS TABLE(
  id UUID,
  user_id TEXT,
  file_type TEXT,
  content TEXT,
  content_hash TEXT,
  token_count INT,
  updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT
    f.id,
    f.user_id,
    f.file_type,
    f.content,
    f.content_hash,
    f.token_count,
    f.updated_at
  FROM olive_memory_files f
  JOIN clerk_couple_members m ON m.user_id = f.user_id
  WHERE m.couple_id = p_couple_id
    AND f.file_type = ANY(p_file_types)
    AND f.file_date IS NULL
  ORDER BY f.user_id, f.file_type;
$$;

-- ─── 4. Cross-couple entity resolution helper ─────────────────────
-- Find entities that exist for both partners (candidates for merging)
CREATE OR REPLACE FUNCTION public.find_shared_entities(
  p_couple_id UUID,
  p_min_similarity FLOAT DEFAULT 0.85
)
RETURNS TABLE(
  entity_a_id UUID,
  entity_a_user TEXT,
  entity_a_name TEXT,
  entity_b_id UUID,
  entity_b_user TEXT,
  entity_b_name TEXT,
  entity_type TEXT,
  name_similarity FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    a.id AS entity_a_id,
    a.user_id AS entity_a_user,
    a.name AS entity_a_name,
    b.id AS entity_b_id,
    b.user_id AS entity_b_user,
    b.name AS entity_b_name,
    a.entity_type,
    similarity(LOWER(a.name), LOWER(b.name))::float AS name_similarity
  FROM olive_entities a
  JOIN olive_entities b ON a.entity_type = b.entity_type AND a.user_id < b.user_id
  JOIN clerk_couple_members ma ON ma.user_id = a.user_id
  JOIN clerk_couple_members mb ON mb.user_id = b.user_id AND mb.couple_id = ma.couple_id
  WHERE ma.couple_id = p_couple_id
    AND similarity(LOWER(a.name), LOWER(b.name)) >= p_min_similarity;
$$;

-- ─── 5. Partner task delegation pattern helper ─────────────────────
-- Analyze which categories each partner handles (for delegation suggestions)
CREATE OR REPLACE FUNCTION public.get_partner_task_patterns(
  p_couple_id UUID,
  p_days INT DEFAULT 90
)
RETURNS TABLE(
  user_id TEXT,
  display_name TEXT,
  category TEXT,
  total_tasks BIGINT,
  completed_tasks BIGINT,
  completion_rate NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    n.author_id AS user_id,
    p.display_name,
    COALESCE(n.category, 'general') AS category,
    COUNT(*) AS total_tasks,
    COUNT(*) FILTER (WHERE n.completed = true) AS completed_tasks,
    ROUND(
      COUNT(*) FILTER (WHERE n.completed = true)::numeric / NULLIF(COUNT(*), 0),
      2
    ) AS completion_rate
  FROM clerk_notes n
  JOIN clerk_couple_members m ON m.user_id = n.author_id
  JOIN clerk_profiles p ON p.id = n.author_id
  WHERE m.couple_id = p_couple_id
    AND n.created_at >= now() - (p_days || ' days')::interval
  GROUP BY n.author_id, p.display_name, COALESCE(n.category, 'general')
  HAVING COUNT(*) >= 2
  ORDER BY n.author_id, COUNT(*) DESC;
$$;

-- ─── 6. Backfill couple_id on existing relationships ───────────────
-- Set couple_id on relationships where the user belongs to a couple
UPDATE olive_relationships r
SET couple_id = m.couple_id
FROM clerk_couple_members m
WHERE r.user_id = m.user_id
  AND r.couple_id IS NULL;
