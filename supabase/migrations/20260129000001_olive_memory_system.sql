-- ============================================================================
-- OLIVE MEMORY SYSTEM - Phase 1
-- Persistent, file-based memory inspired by Moltbot architecture
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 1. MEMORY FILES TABLE
-- Stores structured memory files (PROFILE.md, daily logs, patterns, etc.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id TEXT,
  file_type TEXT NOT NULL CHECK (file_type IN (
    'profile',      -- User preferences, routines, important facts
    'daily',        -- Daily interaction logs
    'patterns',     -- Learned behavioral patterns
    'relationship', -- Partner dynamics (personal perspective)
    'household'     -- Shared couple patterns (couple-level)
  )),
  file_date DATE,  -- For daily files only
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT,  -- For change detection
  token_count INTEGER DEFAULT 0,
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_type, file_date)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_memory_files_user ON olive_memory_files(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_files_couple ON olive_memory_files(couple_id);
CREATE INDEX IF NOT EXISTS idx_memory_files_type ON olive_memory_files(file_type);
CREATE INDEX IF NOT EXISTS idx_memory_files_date ON olive_memory_files(file_date DESC);
CREATE INDEX IF NOT EXISTS idx_memory_files_embedding ON olive_memory_files
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 2. MEMORY CHUNKS TABLE
-- Granular memory segments for precise retrieval
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_file_id UUID REFERENCES olive_memory_files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  chunk_type TEXT DEFAULT 'fact' CHECK (chunk_type IN (
    'fact',        -- A stored fact/preference
    'event',       -- Something that happened
    'decision',    -- A decision made
    'pattern',     -- An observed pattern
    'interaction'  -- A notable interaction
  )),
  importance INTEGER DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}',
  source TEXT,  -- Where this chunk came from (whatsapp, app, auto-extracted)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_file ON olive_memory_chunks(memory_file_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_user ON olive_memory_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_type ON olive_memory_chunks(chunk_type);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_importance ON olive_memory_chunks(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_embedding ON olive_memory_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ============================================================================
-- 3. PATTERNS TABLE
-- Stores detected behavioral patterns for proactive features
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id TEXT,
  pattern_type TEXT NOT NULL CHECK (pattern_type IN (
    'grocery_day',           -- Regular grocery shopping day
    'reminder_preference',   -- When user prefers reminders
    'task_assignment',       -- Who typically handles what
    'communication_style',   -- How user prefers to be notified
    'schedule_preference',   -- Busy times, free times
    'category_usage',        -- Most used categories
    'completion_time',       -- When tasks get completed
    'response_pattern',      -- How quickly user responds
    'partner_coordination',  -- How couple divides tasks
    'shopping_frequency'     -- How often user shops
  )),
  pattern_data JSONB NOT NULL,
  confidence FLOAT DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  sample_count INTEGER DEFAULT 1,
  last_triggered TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pattern_type)
);

CREATE INDEX IF NOT EXISTS idx_patterns_user ON olive_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_patterns_couple ON olive_patterns(couple_id);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON olive_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_patterns_confidence ON olive_patterns(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_active ON olive_patterns(is_active) WHERE is_active = true;

-- ============================================================================
-- 4. GATEWAY SESSIONS TABLE
-- Bidirectional messaging session management
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_gateway_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key TEXT UNIQUE NOT NULL,
  user_id TEXT NOT NULL,
  couple_id TEXT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  phone_number TEXT,
  transcript JSONB DEFAULT '[]',
  context_tokens INTEGER DEFAULT 0,
  memory_context JSONB DEFAULT '{}',
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  reset_policy TEXT DEFAULT 'daily' CHECK (reset_policy IN ('daily', 'weekly', 'manual', 'idle')),
  idle_timeout_minutes INTEGER DEFAULT 60,
  next_reset TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON olive_gateway_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_key ON olive_gateway_sessions(session_key);
CREATE INDEX IF NOT EXISTS idx_sessions_activity ON olive_gateway_sessions(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_reset ON olive_gateway_sessions(next_reset);

-- ============================================================================
-- 5. OUTBOUND MESSAGE QUEUE
-- Queue for proactive messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  message TEXT NOT NULL,
  message_type TEXT DEFAULT 'proactive' CHECK (message_type IN (
    'proactive',    -- Heartbeat-triggered
    'reminder',     -- Due reminder
    'notification', -- System notification
    'reply'         -- Delayed reply
  )),
  priority INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_user ON olive_outbound_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON olive_outbound_queue(status);
CREATE INDEX IF NOT EXISTS idx_outbound_scheduled ON olive_outbound_queue(scheduled_for)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_outbound_priority ON olive_outbound_queue(priority DESC, scheduled_for ASC)
  WHERE status = 'pending';

-- ============================================================================
-- 6. HEARTBEAT JOBS TABLE
-- Scheduled proactive job definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_heartbeat_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT UNIQUE NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN (
    'morning_briefing',
    'evening_review',
    'reminder_check',
    'pattern_trigger',
    'important_date',
    'partner_sync',
    'overdue_nudge',
    'weekly_summary',
    'memory_cleanup'
  )),
  user_id TEXT,
  couple_id TEXT,
  schedule TEXT NOT NULL,  -- Cron expression
  timezone TEXT DEFAULT 'UTC',
  config JSONB DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true,
  next_run TIMESTAMPTZ,
  last_run TIMESTAMPTZ,
  last_result JSONB,
  run_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_user ON olive_heartbeat_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeat_type ON olive_heartbeat_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_heartbeat_enabled ON olive_heartbeat_jobs(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_heartbeat_next_run ON olive_heartbeat_jobs(next_run) WHERE is_enabled = true;

-- ============================================================================
-- 7. HEARTBEAT LOG TABLE
-- Execution history for debugging
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_heartbeat_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT REFERENCES olive_heartbeat_jobs(job_id) ON DELETE CASCADE,
  user_id TEXT,
  run_at TIMESTAMPTZ DEFAULT NOW(),
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  result JSONB,
  messages_sent INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_log_job ON olive_heartbeat_log(job_id);
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_user ON olive_heartbeat_log(user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_time ON olive_heartbeat_log(run_at DESC);

-- ============================================================================
-- 8. SKILLS TABLE
-- Extensible skill definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  skill_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  description TEXT,
  category TEXT CHECK (category IN (
    'household', 'productivity', 'finance', 'health',
    'social', 'travel', 'shopping', 'utilities'
  )),
  content TEXT NOT NULL,  -- Full markdown content
  triggers JSONB DEFAULT '[]',  -- Activation triggers
  requires JSONB DEFAULT '{}',  -- Required permissions
  is_builtin BOOLEAN DEFAULT false,
  is_enabled BOOLEAN DEFAULT true,
  install_count INTEGER DEFAULT 0,
  rating FLOAT DEFAULT 0,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON olive_skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_enabled ON olive_skills(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_skills_builtin ON olive_skills(is_builtin);

-- ============================================================================
-- 9. USER SKILLS TABLE
-- User-installed skills with custom config
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  skill_id TEXT REFERENCES olive_skills(skill_id) ON DELETE CASCADE,
  config JSONB DEFAULT '{}',
  is_enabled BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  last_used TIMESTAMPTZ,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_user_skills_user ON olive_user_skills(user_id);
CREATE INDEX IF NOT EXISTS idx_user_skills_enabled ON olive_user_skills(is_enabled) WHERE is_enabled = true;

-- ============================================================================
-- 10. USER PREFERENCES TABLE (extends clerk_profiles)
-- Proactive feature preferences
-- ============================================================================

CREATE TABLE IF NOT EXISTS olive_user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT UNIQUE NOT NULL,

  -- Proactive messaging
  proactive_enabled BOOLEAN DEFAULT true,
  max_daily_messages INTEGER DEFAULT 5,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '07:00',

  -- Briefings
  morning_briefing_enabled BOOLEAN DEFAULT true,
  morning_briefing_time TIME DEFAULT '08:00',
  evening_review_enabled BOOLEAN DEFAULT false,
  evening_review_time TIME DEFAULT '20:00',
  weekly_summary_enabled BOOLEAN DEFAULT true,
  weekly_summary_day INTEGER DEFAULT 0,  -- 0 = Sunday
  weekly_summary_time TIME DEFAULT '19:00',

  -- Memory
  memory_auto_extract BOOLEAN DEFAULT true,
  memory_retention_days INTEGER DEFAULT 365,
  daily_log_enabled BOOLEAN DEFAULT true,

  -- Partner coordination
  partner_sync_enabled BOOLEAN DEFAULT false,
  partner_sync_day INTEGER DEFAULT 0,
  partner_sync_time TIME DEFAULT '19:00',

  -- Notifications
  reminder_advance_minutes INTEGER DEFAULT 30,
  overdue_nudge_enabled BOOLEAN DEFAULT true,
  pattern_suggestions_enabled BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preferences_user ON olive_user_preferences(user_id);

-- ============================================================================
-- 11. RPC FUNCTIONS
-- ============================================================================

-- Function to get or create memory file
CREATE OR REPLACE FUNCTION get_or_create_memory_file(
  p_user_id TEXT,
  p_file_type TEXT,
  p_file_date DATE DEFAULT NULL,
  p_couple_id TEXT DEFAULT NULL
) RETURNS olive_memory_files AS $$
DECLARE
  v_file olive_memory_files;
BEGIN
  -- Try to find existing file
  SELECT * INTO v_file
  FROM olive_memory_files
  WHERE user_id = p_user_id
    AND file_type = p_file_type
    AND (file_date IS NOT DISTINCT FROM p_file_date);

  -- Create if not exists
  IF NOT FOUND THEN
    INSERT INTO olive_memory_files (user_id, couple_id, file_type, file_date, content)
    VALUES (p_user_id, p_couple_id, p_file_type, p_file_date, '')
    RETURNING * INTO v_file;
  END IF;

  RETURN v_file;
END;
$$ LANGUAGE plpgsql;

-- Function to append to daily log
CREATE OR REPLACE FUNCTION append_to_daily_log(
  p_user_id TEXT,
  p_content TEXT,
  p_source TEXT DEFAULT 'app'
) RETURNS olive_memory_files AS $$
DECLARE
  v_file olive_memory_files;
  v_timestamp TEXT;
BEGIN
  v_timestamp := TO_CHAR(NOW(), 'HH24:MI');

  -- Get or create today's daily file
  SELECT * INTO v_file
  FROM get_or_create_memory_file(p_user_id, 'daily', CURRENT_DATE);

  -- Append content with timestamp
  UPDATE olive_memory_files
  SET content = content || E'\n\n## ' || v_timestamp || ' (' || p_source || ')' || E'\n' || p_content,
      updated_at = NOW()
  WHERE id = v_file.id
  RETURNING * INTO v_file;

  RETURN v_file;
END;
$$ LANGUAGE plpgsql;

-- Function to search memory chunks with hybrid approach
CREATE OR REPLACE FUNCTION search_memory_chunks(
  p_user_id TEXT,
  p_query_embedding VECTOR(1536),
  p_match_count INTEGER DEFAULT 10,
  p_min_importance INTEGER DEFAULT 1
) RETURNS TABLE (
  id UUID,
  content TEXT,
  chunk_type TEXT,
  importance INTEGER,
  similarity FLOAT,
  memory_file_id UUID,
  file_type TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.content,
    c.chunk_type,
    c.importance,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    c.memory_file_id,
    f.file_type
  FROM olive_memory_chunks c
  JOIN olive_memory_files f ON f.id = c.memory_file_id
  WHERE c.user_id = p_user_id
    AND c.importance >= p_min_importance
    AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT p_match_count;
END;
$$ LANGUAGE plpgsql;

-- Function to get user context for AI
CREATE OR REPLACE FUNCTION get_user_memory_context(
  p_user_id TEXT,
  p_couple_id TEXT DEFAULT NULL,
  p_include_daily BOOLEAN DEFAULT true
) RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_profile TEXT;
  v_today_log TEXT;
  v_yesterday_log TEXT;
  v_patterns JSONB;
BEGIN
  -- Get profile
  SELECT content INTO v_profile
  FROM olive_memory_files
  WHERE user_id = p_user_id AND file_type = 'profile'
  LIMIT 1;

  -- Get today's daily log
  IF p_include_daily THEN
    SELECT content INTO v_today_log
    FROM olive_memory_files
    WHERE user_id = p_user_id
      AND file_type = 'daily'
      AND file_date = CURRENT_DATE
    LIMIT 1;

    -- Get yesterday's daily log
    SELECT content INTO v_yesterday_log
    FROM olive_memory_files
    WHERE user_id = p_user_id
      AND file_type = 'daily'
      AND file_date = CURRENT_DATE - 1
    LIMIT 1;
  END IF;

  -- Get active patterns
  SELECT jsonb_agg(jsonb_build_object(
    'type', pattern_type,
    'data', pattern_data,
    'confidence', confidence
  ))
  INTO v_patterns
  FROM olive_patterns
  WHERE user_id = p_user_id
    AND is_active = true
    AND confidence > 0.6;

  -- Build result
  v_result := jsonb_build_object(
    'profile', COALESCE(v_profile, ''),
    'today_log', COALESCE(v_today_log, ''),
    'yesterday_log', COALESCE(v_yesterday_log, ''),
    'patterns', COALESCE(v_patterns, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- Function to update pattern from observation
CREATE OR REPLACE FUNCTION update_pattern(
  p_user_id TEXT,
  p_pattern_type TEXT,
  p_observation JSONB,
  p_couple_id TEXT DEFAULT NULL
) RETURNS olive_patterns AS $$
DECLARE
  v_pattern olive_patterns;
  v_new_confidence FLOAT;
BEGIN
  -- Get existing pattern
  SELECT * INTO v_pattern
  FROM olive_patterns
  WHERE user_id = p_user_id AND pattern_type = p_pattern_type;

  IF FOUND THEN
    -- Update existing pattern with new observation
    v_new_confidence := LEAST(1.0, v_pattern.confidence + 0.05);

    UPDATE olive_patterns
    SET pattern_data = v_pattern.pattern_data || p_observation,
        confidence = v_new_confidence,
        sample_count = sample_count + 1,
        updated_at = NOW()
    WHERE id = v_pattern.id
    RETURNING * INTO v_pattern;
  ELSE
    -- Create new pattern
    INSERT INTO olive_patterns (user_id, couple_id, pattern_type, pattern_data, confidence)
    VALUES (p_user_id, p_couple_id, p_pattern_type, p_observation, 0.3)
    RETURNING * INTO v_pattern;
  END IF;

  RETURN v_pattern;
END;
$$ LANGUAGE plpgsql;

-- Function to check quiet hours
CREATE OR REPLACE FUNCTION is_quiet_hours(
  p_user_id TEXT,
  p_timezone TEXT DEFAULT 'UTC'
) RETURNS BOOLEAN AS $$
DECLARE
  v_prefs olive_user_preferences;
  v_current_time TIME;
  v_start TIME;
  v_end TIME;
BEGIN
  SELECT * INTO v_prefs
  FROM olive_user_preferences
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_start := '22:00'::TIME;
    v_end := '07:00'::TIME;
  ELSE
    v_start := v_prefs.quiet_hours_start;
    v_end := v_prefs.quiet_hours_end;
  END IF;

  v_current_time := (NOW() AT TIME ZONE p_timezone)::TIME;

  -- Handle overnight quiet hours (e.g., 22:00 to 07:00)
  IF v_start > v_end THEN
    RETURN v_current_time >= v_start OR v_current_time <= v_end;
  ELSE
    RETURN v_current_time >= v_start AND v_current_time <= v_end;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to count today's proactive messages
CREATE OR REPLACE FUNCTION count_today_proactive_messages(
  p_user_id TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM olive_outbound_queue
  WHERE user_id = p_user_id
    AND message_type = 'proactive'
    AND created_at >= CURRENT_DATE
    AND status IN ('sent', 'pending');

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Function to check if can send proactive message
CREATE OR REPLACE FUNCTION can_send_proactive(
  p_user_id TEXT,
  p_timezone TEXT DEFAULT 'UTC'
) RETURNS BOOLEAN AS $$
DECLARE
  v_prefs olive_user_preferences;
  v_count INTEGER;
BEGIN
  SELECT * INTO v_prefs
  FROM olive_user_preferences
  WHERE user_id = p_user_id;

  -- Check if proactive is enabled
  IF FOUND AND NOT v_prefs.proactive_enabled THEN
    RETURN FALSE;
  END IF;

  -- Check quiet hours
  IF is_quiet_hours(p_user_id, p_timezone) THEN
    RETURN FALSE;
  END IF;

  -- Check daily limit
  v_count := count_today_proactive_messages(p_user_id);
  IF v_count >= COALESCE(v_prefs.max_daily_messages, 5) THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 12. ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS
ALTER TABLE olive_memory_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_gateway_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_outbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_heartbeat_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_heartbeat_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_user_skills ENABLE ROW LEVEL SECURITY;

-- Memory files: Users can only see their own (privacy between partners)
CREATE POLICY memory_files_user_policy ON olive_memory_files
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Memory chunks: Same as files
CREATE POLICY memory_chunks_user_policy ON olive_memory_chunks
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Patterns: User's own patterns only
CREATE POLICY patterns_user_policy ON olive_patterns
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Sessions: User's own sessions
CREATE POLICY sessions_user_policy ON olive_gateway_sessions
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Outbound queue: User's own messages
CREATE POLICY outbound_user_policy ON olive_outbound_queue
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Heartbeat jobs: User's own jobs
CREATE POLICY heartbeat_user_policy ON olive_heartbeat_jobs
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Heartbeat log: User's own logs
CREATE POLICY heartbeat_log_user_policy ON olive_heartbeat_log
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Preferences: User's own preferences
CREATE POLICY preferences_user_policy ON olive_user_preferences
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- User skills: User's own installed skills
CREATE POLICY user_skills_user_policy ON olive_user_skills
  FOR ALL USING (user_id = auth.jwt()->>'sub');

-- Skills table: Public read for all skills
CREATE POLICY skills_read_policy ON olive_skills
  FOR SELECT USING (true);

-- Service role bypass for all tables
CREATE POLICY service_memory_files ON olive_memory_files
  FOR ALL TO service_role USING (true);
CREATE POLICY service_memory_chunks ON olive_memory_chunks
  FOR ALL TO service_role USING (true);
CREATE POLICY service_patterns ON olive_patterns
  FOR ALL TO service_role USING (true);
CREATE POLICY service_sessions ON olive_gateway_sessions
  FOR ALL TO service_role USING (true);
CREATE POLICY service_outbound ON olive_outbound_queue
  FOR ALL TO service_role USING (true);
CREATE POLICY service_heartbeat ON olive_heartbeat_jobs
  FOR ALL TO service_role USING (true);
CREATE POLICY service_heartbeat_log ON olive_heartbeat_log
  FOR ALL TO service_role USING (true);
CREATE POLICY service_preferences ON olive_user_preferences
  FOR ALL TO service_role USING (true);
CREATE POLICY service_user_skills ON olive_user_skills
  FOR ALL TO service_role USING (true);
CREATE POLICY service_skills ON olive_skills
  FOR ALL TO service_role USING (true);

-- ============================================================================
-- 13. ADD FULL-TEXT SEARCH TO NOTES (for hybrid search)
-- ============================================================================

-- Add tsvector column if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clerk_notes' AND column_name = 'search_vector'
  ) THEN
    ALTER TABLE clerk_notes ADD COLUMN search_vector TSVECTOR;
  END IF;
END $$;

-- Create function to update search vector
CREATE OR REPLACE FUNCTION update_notes_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.original_text, '') || ' ' ||
    COALESCE(NEW.summary, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS notes_search_vector_trigger ON clerk_notes;
CREATE TRIGGER notes_search_vector_trigger
  BEFORE INSERT OR UPDATE ON clerk_notes
  FOR EACH ROW EXECUTE FUNCTION update_notes_search_vector();

-- Update existing rows
UPDATE clerk_notes SET search_vector = to_tsvector('english',
  COALESCE(original_text, '') || ' ' ||
  COALESCE(summary, '') || ' ' ||
  COALESCE(array_to_string(tags, ' '), '')
);

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS idx_notes_search_vector ON clerk_notes USING GIN(search_vector);

-- ============================================================================
-- 14. HYBRID SEARCH FUNCTION FOR NOTES
-- ============================================================================

CREATE OR REPLACE FUNCTION hybrid_search_notes(
  p_user_id TEXT,
  p_couple_id TEXT,
  p_query TEXT,
  p_query_embedding VECTOR(1536),
  p_vector_weight FLOAT DEFAULT 0.7,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID,
  original_text TEXT,
  summary TEXT,
  category TEXT,
  due_date DATE,
  priority TEXT,
  completed BOOLEAN,
  score FLOAT
) AS $$
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
      ts_rank(n.search_vector, plainto_tsquery('english', p_query)) AS text_score
    FROM clerk_notes n
    WHERE (n.author_id = p_user_id OR n.couple_id = p_couple_id)
      AND n.search_vector @@ plainto_tsquery('english', p_query)
    LIMIT p_limit * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, t.id) AS note_id,
      COALESCE(v.vector_score, 0) * p_vector_weight +
      COALESCE(t.text_score, 0) * (1 - p_vector_weight) AS combined_score
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
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 15. INSERT DEFAULT BUILTIN SKILLS
-- ============================================================================

INSERT INTO olive_skills (skill_id, name, description, category, content, triggers, is_builtin)
VALUES
  ('couple-coordinator', 'Couple Coordinator', 'Helps fairly assign tasks between partners', 'household',
   E'# Couple Coordinator\n\nWhen assigning tasks, consider:\n1. Current workload of each partner\n2. Past task history\n3. Preferences and strengths\n4. Fairness over time\n\nSuggest assignments with reasoning.',
   '[{"keyword": "assign"}, {"keyword": "who should"}, {"keyword": "divide tasks"}]'::jsonb, true),

  ('grocery-optimizer', 'Grocery Optimizer', 'Organizes grocery lists by store section', 'household',
   E'# Grocery Optimizer\n\nOrganize items by section:\n1. Produce (fruits, vegetables)\n2. Dairy (milk, cheese, yogurt)\n3. Meat & Seafood\n4. Frozen\n5. Pantry (canned goods, pasta, rice)\n6. Beverages\n7. Household items',
   '[{"category": "groceries"}, {"keyword": "optimize groceries"}, {"command": "/groceries"}]'::jsonb, true),

  ('meal-planner', 'Meal Planner', 'Suggests weekly meals based on preferences', 'household',
   E'# Meal Planner\n\nConsider:\n1. Dietary preferences and restrictions\n2. Recent meals (avoid repetition)\n3. Available ingredients\n4. Cooking time available\n5. Budget constraints\n\nSuggest balanced variety.',
   '[{"keyword": "meal plan"}, {"keyword": "what to cook"}, {"keyword": "dinner ideas"}]'::jsonb, true),

  ('gift-recommender', 'Gift Recommender', 'Remembers preferences for gift giving', 'social',
   E'# Gift Recommender\n\nTrack and suggest gifts based on:\n1. Recipient preferences stored in memory\n2. Past gifts given\n3. Occasion type\n4. Budget\n5. Relationship closeness',
   '[{"keyword": "gift"}, {"keyword": "present"}, {"keyword": "birthday"}]'::jsonb, true),

  ('home-maintenance', 'Home Maintenance', 'Tracks recurring home tasks', 'household',
   E'# Home Maintenance\n\nTrack recurring tasks:\n1. Filter replacements (monthly/quarterly)\n2. Deep cleaning (weekly/monthly)\n3. Seasonal maintenance\n4. Appliance maintenance\n5. Garden/yard work',
   '[{"keyword": "maintenance"}, {"keyword": "home task"}, {"category": "household"}]'::jsonb, true),

  ('budget-tracker', 'Budget Tracker', 'Monitors spending patterns', 'finance',
   E'# Budget Tracker\n\nAnalyze spending:\n1. Category breakdown\n2. Trends over time\n3. Comparison to budget\n4. Unusual expenses\n5. Savings opportunities',
   '[{"keyword": "budget"}, {"keyword": "spending"}, {"keyword": "expenses"}, {"category": "finance"}]'::jsonb, true)
ON CONFLICT (skill_id) DO NOTHING;

-- ============================================================================
-- 16. CRON JOBS FOR HEARTBEAT (using pg_cron)
-- ============================================================================

-- Note: These need to be run separately after pg_cron is enabled
-- SELECT cron.schedule('olive-heartbeat-runner', '*/5 * * * *',
--   $$SELECT net.http_post(
--     url := 'https://wtfspzvcetxmcfftwonq.supabase.co/functions/v1/olive-heartbeat',
--     headers := '{"Authorization": "Bearer YOUR_SERVICE_KEY"}'::jsonb
--   )$$
-- );

COMMENT ON TABLE olive_memory_files IS 'Moltbot-style persistent memory files per user';
COMMENT ON TABLE olive_memory_chunks IS 'Granular memory segments for semantic search';
COMMENT ON TABLE olive_patterns IS 'Detected behavioral patterns for proactive features';
COMMENT ON TABLE olive_gateway_sessions IS 'Bidirectional messaging session management';
COMMENT ON TABLE olive_outbound_queue IS 'Queue for proactive outbound messages';
COMMENT ON TABLE olive_heartbeat_jobs IS 'Scheduled proactive job definitions';
COMMENT ON TABLE olive_heartbeat_log IS 'Heartbeat execution history';
COMMENT ON TABLE olive_skills IS 'Extensible skill definitions';
COMMENT ON TABLE olive_user_skills IS 'User-installed skills with custom config';
COMMENT ON TABLE olive_user_preferences IS 'User preferences for proactive features';
