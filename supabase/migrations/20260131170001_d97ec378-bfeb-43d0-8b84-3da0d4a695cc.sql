-- Olive Memory System Tables (Moltbot-inspired features)

-- Table for structured memory files (profile, daily logs, patterns)
CREATE TABLE IF NOT EXISTS public.olive_memory_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id),
  file_type TEXT NOT NULL CHECK (file_type IN ('profile', 'daily', 'patterns', 'relationship', 'household')),
  file_date DATE,
  content TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  token_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, file_type, file_date)
);

-- Table for granular memory chunks for semantic search
CREATE TABLE IF NOT EXISTS public.olive_memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_file_id UUID REFERENCES public.olive_memory_files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  chunk_index INTEGER DEFAULT 0,
  content TEXT NOT NULL,
  chunk_type TEXT DEFAULT 'fact' CHECK (chunk_type IN ('fact', 'event', 'decision', 'pattern', 'interaction')),
  importance INTEGER DEFAULT 3 CHECK (importance BETWEEN 1 AND 5),
  embedding vector(1536),
  source TEXT DEFAULT 'auto',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for behavioral patterns
CREATE TABLE IF NOT EXISTS public.olive_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  couple_id UUID REFERENCES public.clerk_couples(id),
  pattern_type TEXT NOT NULL,
  pattern_data JSONB NOT NULL DEFAULT '{}',
  confidence FLOAT DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  sample_count INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pattern_type)
);

-- Table for user preferences (proactive settings)
CREATE TABLE IF NOT EXISTS public.olive_user_preferences (
  user_id TEXT PRIMARY KEY,
  proactive_enabled BOOLEAN DEFAULT TRUE,
  max_daily_messages INTEGER DEFAULT 5,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '07:00',
  morning_briefing_enabled BOOLEAN DEFAULT FALSE,
  evening_review_enabled BOOLEAN DEFAULT FALSE,
  weekly_summary_enabled BOOLEAN DEFAULT FALSE,
  overdue_nudge_enabled BOOLEAN DEFAULT TRUE,
  pattern_suggestions_enabled BOOLEAN DEFAULT TRUE,
  timezone TEXT DEFAULT 'UTC',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for WhatsApp gateway sessions
CREATE TABLE IF NOT EXISTS public.olive_gateway_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp',
  conversation_context JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  last_activity TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for outbound message queue
CREATE TABLE IF NOT EXISTS public.olive_outbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  media_url TEXT,
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for heartbeat scheduled jobs
CREATE TABLE IF NOT EXISTS public.olive_heartbeat_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for heartbeat execution log
CREATE TABLE IF NOT EXISTS public.olive_heartbeat_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  message_preview TEXT,
  execution_time_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for skill definitions
CREATE TABLE IF NOT EXISTS public.olive_skills (
  skill_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  triggers JSONB DEFAULT '[]',
  content TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table for user-installed skills
CREATE TABLE IF NOT EXISTS public.olive_user_skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  skill_id TEXT REFERENCES public.olive_skills(skill_id),
  enabled BOOLEAN DEFAULT TRUE,
  config JSONB DEFAULT '{}',
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, skill_id)
);

-- Enable RLS on all tables
ALTER TABLE public.olive_memory_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_gateway_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_outbound_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_heartbeat_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_heartbeat_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.olive_user_skills ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user data access
CREATE POLICY "olive_memory_files_user" ON public.olive_memory_files FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_memory_chunks_user" ON public.olive_memory_chunks FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_patterns_user" ON public.olive_patterns FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_user_preferences_user" ON public.olive_user_preferences FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_gateway_sessions_user" ON public.olive_gateway_sessions FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_outbound_queue_user" ON public.olive_outbound_queue FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_heartbeat_jobs_user" ON public.olive_heartbeat_jobs FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_heartbeat_log_user" ON public.olive_heartbeat_log FOR ALL USING (user_id = (auth.jwt()->>'sub'));
CREATE POLICY "olive_skills_read" ON public.olive_skills FOR SELECT USING (true);
CREATE POLICY "olive_user_skills_user" ON public.olive_user_skills FOR ALL USING (user_id = (auth.jwt()->>'sub'));

-- Insert default skills
INSERT INTO public.olive_skills (skill_id, name, description, category, triggers) VALUES
('couple-coordinator', 'Couple Coordinator', 'Helps assign tasks fairly between partners', 'household', '["assign", "divide", "split", "fair", "share tasks"]'),
('grocery-optimizer', 'Grocery Optimizer', 'Optimizes shopping lists by store section', 'shopping', '["groceries", "shopping list", "optimize", "/groceries"]'),
('meal-planner', 'Meal Planner', 'Suggests meals based on preferences', 'food', '["meal plan", "what to cook", "dinner ideas", "/meals"]'),
('gift-recommender', 'Gift Recommender', 'Tracks gift ideas and preferences', 'personal', '["gift", "present", "birthday gift", "/gifts"]'),
('home-maintenance', 'Home Maintenance', 'Tracks recurring household tasks', 'household', '["maintenance", "home repair", "fix", "/home"]'),
('budget-tracker', 'Budget Tracker', 'Monitors spending patterns', 'finance', '["budget", "spending", "expense", "/budget"]')
ON CONFLICT (skill_id) DO NOTHING;