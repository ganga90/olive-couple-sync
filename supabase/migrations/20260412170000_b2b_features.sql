-- B2B Features — Industry Templates, Client Pipeline, Expense Splitting, Decision Log
-- ===================================================================================
-- Extends Olive for small-business use: pre-configured industry templates,
-- client lifecycle tracking, shared expense splitting, and team decision logging.

-- ─── Industry Templates ───────────────────────────────────────
-- Pre-configured starter kits per industry (realtor, contractor, freelancer, small_team).
-- Each template bundles: lists, skills, budget categories, proactive rules, and soul seed hints.
CREATE TABLE IF NOT EXISTS olive_industry_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry TEXT NOT NULL CHECK (industry IN (
    'realtor', 'contractor', 'freelancer', 'small_team',
    'restaurant', 'retail', 'consulting', 'creative_agency'
  )),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,  -- emoji or lucide icon name
  version INT NOT NULL DEFAULT 1,
  -- Bundled configuration
  lists JSONB NOT NULL DEFAULT '[]',          -- [{name, items[], category}]
  skills JSONB NOT NULL DEFAULT '[]',         -- [skill_id strings to auto-enable]
  budget_categories JSONB NOT NULL DEFAULT '[]',  -- [{category, suggested_limit}]
  proactive_rules JSONB NOT NULL DEFAULT '[]',    -- [{trigger, action, description}]
  soul_hints JSONB NOT NULL DEFAULT '{}',     -- Personality tweaks for the industry
  note_categories JSONB NOT NULL DEFAULT '[]',    -- Custom note categories for this industry
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_industry_templates_industry ON olive_industry_templates (industry) WHERE is_active = true;

-- Track which templates a space has applied
CREATE TABLE IF NOT EXISTS olive_space_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES olive_industry_templates(id) ON DELETE CASCADE,
  applied_by TEXT NOT NULL,  -- user_id who applied the template
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  config_overrides JSONB DEFAULT '{}',  -- User customizations on top of template defaults
  UNIQUE(space_id, template_id)
);

CREATE INDEX idx_space_templates_space ON olive_space_templates (space_id);

-- ─── Client Pipeline ─────────────────────────────────────────
-- Client lifecycle tracking: lead → prospect → active → completed/lost.
-- Supports follow-up scheduling, notes, and value tracking.
CREATE TABLE IF NOT EXISTS olive_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- creator/owner
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN (
    'lead', 'prospect', 'active', 'completed', 'lost', 'paused'
  )),
  source TEXT,  -- e.g. 'referral', 'website', 'walk-in', 'whatsapp'
  estimated_value NUMERIC(12, 2),
  actual_value NUMERIC(12, 2),
  currency TEXT NOT NULL DEFAULT 'USD',
  tags JSONB DEFAULT '[]',
  notes TEXT,
  follow_up_date TIMESTAMPTZ,
  last_contact TIMESTAMPTZ,
  stage_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_space ON olive_clients (space_id, stage) WHERE NOT is_archived;
CREATE INDEX idx_clients_user ON olive_clients (user_id, stage) WHERE NOT is_archived;
CREATE INDEX idx_clients_follow_up ON olive_clients (follow_up_date) WHERE follow_up_date IS NOT NULL AND NOT is_archived;

-- Client activity log (stage transitions, notes, contacts)
CREATE TABLE IF NOT EXISTS olive_client_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES olive_clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN (
    'stage_change', 'note', 'call', 'email', 'meeting', 'follow_up_set', 'follow_up_completed', 'value_updated'
  )),
  from_value TEXT,
  to_value TEXT,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_activity_client ON olive_client_activity (client_id, created_at DESC);

-- ─── Expense Splitting ───────────────────────────────────────
-- Splits transactions between space members with settlement tracking.
CREATE TABLE IF NOT EXISTS olive_expense_splits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
  created_by TEXT NOT NULL,
  description TEXT NOT NULL,
  total_amount NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  split_type TEXT NOT NULL DEFAULT 'equal' CHECK (split_type IN ('equal', 'percentage', 'exact', 'shares')),
  is_settled BOOLEAN NOT NULL DEFAULT false,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_splits_space ON olive_expense_splits (space_id) WHERE NOT is_settled;

-- Individual shares for each split
CREATE TABLE IF NOT EXISTS olive_expense_split_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  split_id UUID NOT NULL REFERENCES olive_expense_splits(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  percentage NUMERIC(5, 2),  -- for percentage splits
  is_paid BOOLEAN NOT NULL DEFAULT false,
  paid_at TIMESTAMPTZ,
  UNIQUE(split_id, user_id)
);

CREATE INDEX idx_split_shares_user ON olive_expense_split_shares (user_id) WHERE NOT is_paid;
CREATE INDEX idx_split_shares_split ON olive_expense_split_shares (split_id);

-- ─── Decision Log ────────────────────────────────────────────
-- Team decisions with context, participants, rationale, and outcome tracking.
CREATE TABLE IF NOT EXISTS olive_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- who logged it
  title TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN (
    'financial', 'operational', 'strategic', 'hiring', 'product',
    'client', 'policy', 'other'
  )),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'discussed', 'decided', 'implemented', 'revisited', 'reversed'
  )),
  decision_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  participants JSONB DEFAULT '[]',  -- [user_id strings]
  context TEXT,       -- what prompted this decision
  rationale TEXT,     -- why this option was chosen
  alternatives JSONB DEFAULT '[]',  -- [{option, pros, cons}]
  outcome TEXT,       -- what happened after implementing
  outcome_date TIMESTAMPTZ,
  related_note_ids JSONB DEFAULT '[]',  -- references to clerk_notes
  tags JSONB DEFAULT '[]',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_decisions_space ON olive_decisions (space_id, status) WHERE NOT is_archived;
CREATE INDEX idx_decisions_category ON olive_decisions (space_id, category) WHERE NOT is_archived;
CREATE INDEX idx_decisions_date ON olive_decisions (decision_date DESC);

-- ─── Auto-update timestamps ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_b2b_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_industry_templates_updated_at
  BEFORE UPDATE ON olive_industry_templates
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON olive_clients
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();

CREATE TRIGGER trg_expense_splits_updated_at
  BEFORE UPDATE ON olive_expense_splits
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();

CREATE TRIGGER trg_decisions_updated_at
  BEFORE UPDATE ON olive_decisions
  FOR EACH ROW EXECUTE FUNCTION update_b2b_updated_at();

-- ─── Auto-log client stage changes ──────────────────────────
CREATE OR REPLACE FUNCTION log_client_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    NEW.stage_changed_at = now();
    INSERT INTO olive_client_activity (client_id, user_id, activity_type, from_value, to_value, description)
    VALUES (NEW.id, NEW.user_id, 'stage_change', OLD.stage, NEW.stage,
            'Stage changed from ' || OLD.stage || ' to ' || NEW.stage);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_client_stage_change
  BEFORE UPDATE ON olive_clients
  FOR EACH ROW EXECUTE FUNCTION log_client_stage_change();

-- ─── Engagement events for B2B ──────────────────────────────
-- Extend the engagement events CHECK if it exists on olive_engagement_events
DO $$
BEGIN
  -- Add B2B event types to olive_engagement_events if the table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'olive_engagement_events') THEN
    ALTER TABLE olive_engagement_events DROP CONSTRAINT IF EXISTS olive_engagement_events_event_type_check;
    ALTER TABLE olive_engagement_events ADD CONSTRAINT olive_engagement_events_event_type_check
      CHECK (event_type IN (
        -- Existing events
        'note_created', 'note_viewed', 'note_searched',
        'reminder_set', 'reminder_completed', 'reminder_snoozed',
        'list_created', 'list_item_checked',
        'calendar_viewed', 'calendar_event_created',
        'memory_recalled', 'memory_corrected',
        'whatsapp_message_sent', 'whatsapp_message_received',
        'proactive_accepted', 'proactive_dismissed', 'proactive_ignored',
        'skill_used', 'reflection_created',
        'trust_approved', 'trust_denied',
        -- Delegation events (Sprint 5)
        'delegation_created', 'delegation_accepted', 'delegation_declined',
        'delegation_completed', 'delegation_snoozed', 'delegation_reassigned',
        'briefing_read',
        -- B2B events (Sprint 7)
        'template_applied', 'client_created', 'client_stage_changed',
        'expense_split_created', 'expense_split_settled',
        'decision_logged', 'decision_implemented'
      ));
  END IF;
END $$;

-- ─── Seed Industry Templates ─────────────────────────────────

-- Realtor template
INSERT INTO olive_industry_templates (industry, name, description, icon, lists, skills, budget_categories, proactive_rules, soul_hints, note_categories)
VALUES (
  'realtor',
  'Real Estate Agent',
  'MLS tracking, showing schedules, client pipeline, and offer management',
  'Home',
  '[
    {"name": "Active Listings", "items": [], "category": "listings"},
    {"name": "Showing Schedule", "items": [], "category": "showings"},
    {"name": "Pending Offers", "items": [], "category": "offers"},
    {"name": "Closing Checklist", "items": [], "category": "closing"}
  ]'::jsonb,
  '["client_pipeline", "budget_tracker", "receipt_scanner", "calendar_sync"]'::jsonb,
  '[
    {"category": "Marketing", "suggested_limit": 2000},
    {"category": "Staging", "suggested_limit": 1500},
    {"category": "Photography", "suggested_limit": 500},
    {"category": "Client Entertainment", "suggested_limit": 300}
  ]'::jsonb,
  '[
    {"trigger": "follow_up_overdue", "action": "remind", "description": "Nudge when a client follow-up is overdue"},
    {"trigger": "showing_tomorrow", "action": "briefing", "description": "Morning briefing with tomorrow''s showings"},
    {"trigger": "offer_deadline", "action": "alert", "description": "Alert 4h before offer deadline"}
  ]'::jsonb,
  '{"domain": "real_estate", "vocabulary": ["listing", "MLS", "showing", "offer", "closing", "escrow", "open house"]}'::jsonb,
  '["Listing", "Showing", "Offer", "Closing", "Client Meeting", "Open House", "Market Research"]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Contractor template
INSERT INTO olive_industry_templates (industry, name, description, icon, lists, skills, budget_categories, proactive_rules, soul_hints, note_categories)
VALUES (
  'contractor',
  'General Contractor',
  'Job tracking, material orders, crew scheduling, and invoice management',
  'Hammer',
  '[
    {"name": "Active Jobs", "items": [], "category": "jobs"},
    {"name": "Material Orders", "items": [], "category": "materials"},
    {"name": "Crew Schedule", "items": [], "category": "crew"},
    {"name": "Pending Invoices", "items": [], "category": "invoices"}
  ]'::jsonb,
  '["client_pipeline", "budget_tracker", "receipt_scanner"]'::jsonb,
  '[
    {"category": "Materials", "suggested_limit": 5000},
    {"category": "Labor", "suggested_limit": 8000},
    {"category": "Permits", "suggested_limit": 1000},
    {"category": "Equipment Rental", "suggested_limit": 2000}
  ]'::jsonb,
  '[
    {"trigger": "invoice_overdue", "action": "remind", "description": "Nudge when an invoice is overdue by 7 days"},
    {"trigger": "job_milestone", "action": "checklist", "description": "Show milestone checklist when job stage advances"},
    {"trigger": "material_delivery", "action": "alert", "description": "Alert day before material delivery"}
  ]'::jsonb,
  '{"domain": "trades_service", "vocabulary": ["job site", "permit", "inspection", "subcontractor", "change order", "punch list"]}'::jsonb,
  '["Job Note", "Material Order", "Inspection", "Change Order", "Invoice", "Safety Report"]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Freelancer template
INSERT INTO olive_industry_templates (industry, name, description, icon, lists, skills, budget_categories, proactive_rules, soul_hints, note_categories)
VALUES (
  'freelancer',
  'Freelancer / Solopreneur',
  'Project tracking, invoice management, client communication, and tax prep',
  'Laptop',
  '[
    {"name": "Active Projects", "items": [], "category": "projects"},
    {"name": "Invoices", "items": [], "category": "invoices"},
    {"name": "Leads", "items": [], "category": "leads"},
    {"name": "Tax Deductions", "items": [], "category": "tax"}
  ]'::jsonb,
  '["client_pipeline", "budget_tracker", "receipt_scanner"]'::jsonb,
  '[
    {"category": "Software & Tools", "suggested_limit": 500},
    {"category": "Marketing", "suggested_limit": 300},
    {"category": "Office Supplies", "suggested_limit": 200},
    {"category": "Professional Development", "suggested_limit": 200}
  ]'::jsonb,
  '[
    {"trigger": "invoice_unpaid_14d", "action": "remind", "description": "Nudge when invoice unpaid after 14 days"},
    {"trigger": "quarterly_tax", "action": "alert", "description": "Quarterly tax deadline reminder"},
    {"trigger": "project_deadline", "action": "briefing", "description": "Weekly project deadline overview"}
  ]'::jsonb,
  '{"domain": "freelance", "vocabulary": ["retainer", "scope", "deliverable", "milestone", "rate", "proposal"]}'::jsonb,
  '["Project Note", "Client Communication", "Invoice", "Proposal", "Contract", "Tax Receipt"]'::jsonb
)
ON CONFLICT DO NOTHING;

-- Small Team template
INSERT INTO olive_industry_templates (industry, name, description, icon, lists, skills, budget_categories, proactive_rules, soul_hints, note_categories)
VALUES (
  'small_team',
  'Small Team',
  'Task delegation, shared expenses, team decisions, and project coordination',
  'Users',
  '[
    {"name": "Team Tasks", "items": [], "category": "tasks"},
    {"name": "Shared Expenses", "items": [], "category": "expenses"},
    {"name": "Meeting Notes", "items": [], "category": "meetings"},
    {"name": "Team Decisions", "items": [], "category": "decisions"}
  ]'::jsonb,
  '["client_pipeline", "budget_tracker", "receipt_scanner", "calendar_sync"]'::jsonb,
  '[
    {"category": "Office", "suggested_limit": 1000},
    {"category": "Team Meals", "suggested_limit": 500},
    {"category": "Software", "suggested_limit": 800},
    {"category": "Travel", "suggested_limit": 1500}
  ]'::jsonb,
  '[
    {"trigger": "delegation_overdue", "action": "escalate", "description": "Escalate when delegated task is overdue"},
    {"trigger": "weekly_sync", "action": "briefing", "description": "Monday morning team briefing"},
    {"trigger": "expense_threshold", "action": "alert", "description": "Alert when monthly spend exceeds 80% of budget"}
  ]'::jsonb,
  '{"domain": "team_management", "vocabulary": ["standup", "sprint", "blocker", "sync", "action item", "OKR"]}'::jsonb,
  '["Meeting Notes", "Action Item", "Decision", "Standup", "Retrospective", "Expense"]'::jsonb
)
ON CONFLICT DO NOTHING;

-- ─── RLS Policies ─────────────────────────────────────────────
ALTER TABLE olive_industry_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_space_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_client_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_expense_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_expense_split_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_decisions ENABLE ROW LEVEL SECURITY;

-- Templates are readable by all (public catalog)
CREATE POLICY "Anyone can read industry templates"
  ON olive_industry_templates FOR SELECT
  USING (true);

CREATE POLICY "Service role manages industry templates"
  ON olive_industry_templates FOR ALL
  USING (true) WITH CHECK (true);

-- Space templates: members of the space
CREATE POLICY "Space members see applied templates"
  ON olive_space_templates FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages space templates"
  ON olive_space_templates FOR ALL
  USING (true) WITH CHECK (true);

-- Clients: space members can view, owner + admins can modify
CREATE POLICY "Space members see clients"
  ON olive_clients FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages clients"
  ON olive_clients FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Space members see client activity"
  ON olive_client_activity FOR SELECT
  USING (
    client_id IN (
      SELECT id FROM olive_clients
      WHERE space_id IN (
        SELECT space_id FROM olive_space_members
        WHERE user_id = (SELECT auth.uid()::text)
      )
    )
  );

CREATE POLICY "Service role manages client activity"
  ON olive_client_activity FOR ALL
  USING (true) WITH CHECK (true);

-- Expense splits: space members
CREATE POLICY "Space members see expense splits"
  ON olive_expense_splits FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages expense splits"
  ON olive_expense_splits FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Users see own split shares"
  ON olive_expense_split_shares FOR SELECT
  USING (
    user_id = (SELECT auth.uid()::text) OR
    split_id IN (
      SELECT id FROM olive_expense_splits
      WHERE space_id IN (
        SELECT space_id FROM olive_space_members
        WHERE user_id = (SELECT auth.uid()::text)
      )
    )
  );

CREATE POLICY "Service role manages split shares"
  ON olive_expense_split_shares FOR ALL
  USING (true) WITH CHECK (true);

-- Decisions: space members
CREATE POLICY "Space members see decisions"
  ON olive_decisions FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages decisions"
  ON olive_decisions FOR ALL
  USING (true) WITH CHECK (true);
