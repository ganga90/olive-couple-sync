-- Background Agents Infrastructure
-- Extends olive_skills for background agent support and adds agent run tracking

-- 1. Extend olive_skills with agent columns
ALTER TABLE olive_skills ADD COLUMN IF NOT EXISTS agent_type TEXT DEFAULT 'skill';
ALTER TABLE olive_skills ADD COLUMN IF NOT EXISTS schedule TEXT;
ALTER TABLE olive_skills ADD COLUMN IF NOT EXISTS agent_config JSONB DEFAULT '{}';
ALTER TABLE olive_skills ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;
ALTER TABLE olive_skills ADD COLUMN IF NOT EXISTS requires_connection TEXT; -- e.g. 'gmail', 'oura', null

-- 2. Agent execution runs (state persistence + audit trail)
CREATE TABLE IF NOT EXISTS olive_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  couple_id TEXT,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'awaiting_approval', 'cancelled')),
  state JSONB DEFAULT '{}',
  result JSONB,
  steps_completed INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON olive_agent_runs(user_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON olive_agent_runs(status, started_at);

-- 3. Email connections (for MCP Email Agent)
CREATE TABLE IF NOT EXISTS olive_email_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'gmail',
  email_address TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMPTZ,
  scopes TEXT[],
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Seed Tier 1 background agents into olive_skills
INSERT INTO olive_skills (skill_id, name, description, category, is_active, agent_type, schedule, agent_config, requires_approval, triggers)
VALUES
  ('stale-task-strategist', 'Stale Task Strategist', 'Analyzes tasks stuck for 2+ weeks and suggests actions: break down, delegate, reschedule, or archive.', 'general', true, 'background_agent', 'weekly_monday_9am', '{"staleness_days": 14}', false, '[]'::jsonb),
  ('smart-bill-reminder', 'Smart Bill Reminder', 'Scans your notes for upcoming bills and payments, sends reminders before they''re due.', 'finance', true, 'background_agent', 'daily_9am', '{"reminder_days": [3, 1]}', false, '[]'::jsonb),
  ('energy-task-suggester', 'Energy-Aware Task Suggester', 'Reads your Oura energy data and suggests optimal task ordering for the day.', 'general', true, 'background_agent', 'daily_morning_briefing', '{}', false, '[]'::jsonb),
  ('sleep-optimization-coach', 'Sleep Optimization Coach', 'Analyzes your 7-day sleep trends and sends personalized improvement tips.', 'personal', true, 'background_agent', 'daily_10am', '{"sensitivity": "actionable_only"}', false, '[]'::jsonb),
  ('birthday-gift-agent', 'Anniversary & Birthday Gifter', 'Generates personalized gift suggestions 30, 14, and 7 days before important dates.', 'personal', true, 'background_agent', 'daily_check', '{"reminder_tiers": [30, 14, 7], "budget_range": "moderate"}', false, '[]'::jsonb),
  ('weekly-couple-sync', 'Weekly Couple Sync', 'Generates a weekly alignment summary with both partners'' activity and discussion topics.', 'general', true, 'background_agent', 'weekly_sunday_6pm', '{}', false, '[]'::jsonb),
  ('email-triage-agent', 'Email Triage Agent', 'Scans your inbox and extracts actionable tasks from emails automatically.', 'general', true, 'background_agent', 'every_15min', '{}', false, '[]'::jsonb)
ON CONFLICT (skill_id) DO UPDATE SET
  agent_type = EXCLUDED.agent_type,
  schedule = EXCLUDED.schedule,
  agent_config = EXCLUDED.agent_config,
  requires_approval = EXCLUDED.requires_approval;

-- Set requires_connection for agents that need external services
UPDATE olive_skills SET requires_connection = 'oura' WHERE skill_id IN ('energy-task-suggester', 'sleep-optimization-coach');
UPDATE olive_skills SET requires_connection = 'gmail' WHERE skill_id = 'email-triage-agent';
