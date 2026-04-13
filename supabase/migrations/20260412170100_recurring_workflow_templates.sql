-- Recurring Workflow Templates — Built-in automated workflows
-- ============================================================
-- Extends the skill/agent system with 3 built-in recurring workflows:
-- 1. Weekly Review — Monday 9am: summarize week, carry over incomplete, set priorities
-- 2. Monthly Budget Review — 1st of month: spending summary, budget comparison, anomaly flagging
-- 3. Client Follow-up — Custom intervals: remind to follow up, draft message

-- ─── Workflow Templates Table ─────────────────────────────────
-- Stores workflow definitions that can be activated per-space.
-- Builds on olive_skills but adds workflow-specific scheduling and configuration.
CREATE TABLE IF NOT EXISTS olive_workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT NOT NULL DEFAULT 'productivity' CHECK (category IN (
    'productivity', 'finance', 'client', 'team', 'health'
  )),
  -- Schedule configuration
  default_schedule TEXT NOT NULL,  -- e.g. 'weekly_monday_9am', 'monthly_1st_9am', 'daily_check'
  schedule_options JSONB DEFAULT '[]',  -- Alternative schedules user can pick
  -- Workflow steps
  steps JSONB NOT NULL DEFAULT '[]',  -- [{step_id, name, action, config}]
  -- Output configuration
  output_type TEXT NOT NULL DEFAULT 'briefing' CHECK (output_type IN (
    'briefing', 'delegation', 'notification', 'report'
  )),
  output_channel TEXT NOT NULL DEFAULT 'in_app' CHECK (output_channel IN (
    'in_app', 'whatsapp', 'both'
  )),
  -- Availability
  requires_feature JSONB DEFAULT '[]',  -- e.g. ["client_pipeline", "budgets"]
  min_space_members INT DEFAULT 1,
  applicable_space_types JSONB DEFAULT '["couple", "family", "household", "business", "custom"]',
  is_builtin BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Active Workflow Instances ────────────────────────────────
-- Tracks which workflows are enabled for which space, with user customizations.
CREATE TABLE IF NOT EXISTS olive_workflow_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id TEXT NOT NULL REFERENCES olive_workflow_templates(workflow_id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  enabled_by TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  schedule_override TEXT,  -- User can override default schedule
  config JSONB DEFAULT '{}',  -- User customizations (e.g. which budget categories to track)
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('success', 'partial', 'failed', 'skipped')),
  run_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, space_id)
);

CREATE INDEX idx_workflow_instances_space ON olive_workflow_instances (space_id) WHERE is_enabled = true;
CREATE INDEX idx_workflow_instances_schedule ON olive_workflow_instances (is_enabled, last_run_at);

-- ─── Workflow Run History ─────────────────────────────────────
-- Logs each execution for audit and debugging.
CREATE TABLE IF NOT EXISTS olive_workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID NOT NULL REFERENCES olive_workflow_instances(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL,
  space_id UUID NOT NULL,
  triggered_by TEXT NOT NULL DEFAULT 'schedule' CHECK (triggered_by IN ('schedule', 'manual', 'event')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped')),
  steps_completed INT DEFAULT 0,
  steps_total INT DEFAULT 0,
  output JSONB DEFAULT '{}',  -- The generated briefing/report/notification content
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_workflow_runs_instance ON olive_workflow_runs (instance_id, started_at DESC);

-- ─── Seed: Weekly Review Workflow ─────────────────────────────
INSERT INTO olive_workflow_templates (
  workflow_id, name, description, icon, category,
  default_schedule, schedule_options, steps, output_type, output_channel,
  requires_feature, min_space_members, applicable_space_types
) VALUES (
  'weekly-review',
  'Weekly Review',
  'Every Monday morning: summarize last week, carry over incomplete tasks, and set priorities for the new week.',
  'CalendarCheck',
  'productivity',
  'weekly_monday_9am',
  '[
    {"value": "weekly_monday_9am", "label": "Monday 9am"},
    {"value": "weekly_sunday_6pm", "label": "Sunday 6pm"},
    {"value": "weekly_friday_5pm", "label": "Friday 5pm"}
  ]'::jsonb,
  '[
    {"step_id": "gather_tasks", "name": "Gather completed tasks", "action": "query_notes", "config": {"filter": "completed_last_7d"}},
    {"step_id": "gather_incomplete", "name": "Find incomplete tasks", "action": "query_notes", "config": {"filter": "incomplete_overdue"}},
    {"step_id": "gather_delegations", "name": "Check delegation status", "action": "query_delegations", "config": {"filter": "all_active"}},
    {"step_id": "summarize", "name": "Generate weekly summary", "action": "ai_summarize", "config": {"prompt_template": "weekly_review"}},
    {"step_id": "deliver", "name": "Send briefing", "action": "send_briefing", "config": {"type": "weekly"}}
  ]'::jsonb,
  'briefing',
  'both',
  '[]'::jsonb,
  1,
  '["couple", "family", "household", "business", "custom"]'::jsonb
) ON CONFLICT (workflow_id) DO NOTHING;

-- ─── Seed: Monthly Budget Review ──────────────────────────────
INSERT INTO olive_workflow_templates (
  workflow_id, name, description, icon, category,
  default_schedule, schedule_options, steps, output_type, output_channel,
  requires_feature, min_space_members, applicable_space_types
) VALUES (
  'monthly-budget-review',
  'Monthly Budget Review',
  'First of every month: summarize spending by category, compare to budgets, flag anomalies and trends.',
  'TrendingUp',
  'finance',
  'monthly_1st_9am',
  '[
    {"value": "monthly_1st_9am", "label": "1st of month, 9am"},
    {"value": "monthly_last_day_5pm", "label": "Last day of month, 5pm"}
  ]'::jsonb,
  '[
    {"step_id": "gather_transactions", "name": "Collect month transactions", "action": "query_transactions", "config": {"period": "last_month"}},
    {"step_id": "gather_budgets", "name": "Load budget limits", "action": "query_budgets", "config": {}},
    {"step_id": "compare", "name": "Compare spending vs budgets", "action": "compute_budget_comparison", "config": {}},
    {"step_id": "detect_anomalies", "name": "Flag unusual spending", "action": "ai_anomaly_detection", "config": {"threshold_percent": 30}},
    {"step_id": "generate_report", "name": "Generate budget report", "action": "ai_summarize", "config": {"prompt_template": "monthly_budget"}},
    {"step_id": "deliver", "name": "Send report", "action": "send_briefing", "config": {"type": "monthly_budget"}}
  ]'::jsonb,
  'report',
  'both',
  '["budgets"]'::jsonb,
  1,
  '["couple", "family", "household", "business", "custom"]'::jsonb
) ON CONFLICT (workflow_id) DO NOTHING;

-- ─── Seed: Client Follow-up ──────────────────────────────────
INSERT INTO olive_workflow_templates (
  workflow_id, name, description, icon, category,
  default_schedule, schedule_options, steps, output_type, output_channel,
  requires_feature, min_space_members, applicable_space_types
) VALUES (
  'client-follow-up',
  'Client Follow-up',
  'Daily check for overdue client follow-ups. Reminds you and can draft personalized follow-up messages.',
  'UserCheck',
  'client',
  'daily_9am',
  '[
    {"value": "daily_9am", "label": "Daily at 9am"},
    {"value": "daily_8am", "label": "Daily at 8am"},
    {"value": "weekdays_9am", "label": "Weekdays at 9am"}
  ]'::jsonb,
  '[
    {"step_id": "check_overdue", "name": "Find overdue follow-ups", "action": "query_clients", "config": {"filter": "overdue_follow_ups"}},
    {"step_id": "check_upcoming", "name": "Find upcoming follow-ups (3d)", "action": "query_clients", "config": {"filter": "upcoming_3d"}},
    {"step_id": "draft_messages", "name": "Draft follow-up messages", "action": "ai_draft", "config": {"prompt_template": "client_follow_up"}},
    {"step_id": "deliver", "name": "Send reminders", "action": "send_notification", "config": {"include_draft": true}}
  ]'::jsonb,
  'notification',
  'both',
  '["client_pipeline"]'::jsonb,
  1,
  '["business"]'::jsonb
) ON CONFLICT (workflow_id) DO NOTHING;

-- ─── RLS Policies ─────────────────────────────────────────────
ALTER TABLE olive_workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_workflow_runs ENABLE ROW LEVEL SECURITY;

-- Templates are readable by all
CREATE POLICY "Anyone can read workflow templates"
  ON olive_workflow_templates FOR SELECT
  USING (true);

CREATE POLICY "Service role manages workflow templates"
  ON olive_workflow_templates FOR ALL
  USING (true) WITH CHECK (true);

-- Instances: space members
CREATE POLICY "Space members see workflow instances"
  ON olive_workflow_instances FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages workflow instances"
  ON olive_workflow_instances FOR ALL
  USING (true) WITH CHECK (true);

-- Runs: space members
CREATE POLICY "Space members see workflow runs"
  ON olive_workflow_runs FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages workflow runs"
  ON olive_workflow_runs FOR ALL
  USING (true) WITH CHECK (true);

-- ─── Auto-update timestamps ──────────────────────────────────
CREATE TRIGGER trg_workflow_templates_updated_at
  BEFORE UPDATE ON olive_workflow_templates
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();

CREATE TRIGGER trg_workflow_instances_updated_at
  BEFORE UPDATE ON olive_workflow_instances
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();
