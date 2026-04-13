-- Sprint 8: Polish + Monetize
-- ============================
-- Pricing tiers, usage metering, cross-space intelligence,
-- conflict detection, polls & quick decisions, performance indexes.

-- ─── 1. PRICING & SUBSCRIPTIONS ──────────────────────────────

-- Pricing plan definitions
CREATE TABLE IF NOT EXISTS olive_pricing_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id TEXT UNIQUE NOT NULL,  -- 'free', 'personal', 'team', 'business'
  name TEXT NOT NULL,
  description TEXT,
  -- Limits
  max_spaces INT NOT NULL DEFAULT 1,
  max_members_per_space INT NOT NULL DEFAULT 2,
  max_notes_per_month INT NOT NULL DEFAULT 100,
  max_ai_requests_per_day INT NOT NULL DEFAULT 20,
  max_whatsapp_messages_per_day INT NOT NULL DEFAULT 10,
  max_file_storage_mb INT NOT NULL DEFAULT 100,
  -- Feature flags
  features JSONB NOT NULL DEFAULT '{}',  -- {calendar_sync, oura, email_triage, client_pipeline, ...}
  -- Pricing
  price_monthly_cents INT NOT NULL DEFAULT 0,
  price_yearly_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  stripe_price_id_monthly TEXT,
  stripe_price_id_yearly TEXT,
  -- Display
  sort_order INT NOT NULL DEFAULT 0,
  is_popular BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User subscriptions
CREATE TABLE IF NOT EXISTS olive_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES olive_pricing_plans(plan_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'trialing', 'past_due', 'canceled', 'paused', 'expired'
  )),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly', 'lifetime')),
  -- Stripe/RevenueCat
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  revenucat_subscriber_id TEXT,
  -- Dates
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  -- Metadata
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_subscriptions_user ON olive_subscriptions (user_id) WHERE status IN ('active', 'trialing');
CREATE INDEX idx_subscriptions_stripe ON olive_subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- ─── 2. USAGE METERING ──────────────────────────────────────

-- Daily usage counters per user
CREATE TABLE IF NOT EXISTS olive_usage_meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  meter_date DATE NOT NULL DEFAULT CURRENT_DATE,
  -- Counters
  notes_created INT NOT NULL DEFAULT 0,
  ai_requests INT NOT NULL DEFAULT 0,
  whatsapp_messages_sent INT NOT NULL DEFAULT 0,
  whatsapp_messages_received INT NOT NULL DEFAULT 0,
  file_uploads INT NOT NULL DEFAULT 0,
  file_storage_bytes BIGINT NOT NULL DEFAULT 0,
  delegations_created INT NOT NULL DEFAULT 0,
  workflow_runs INT NOT NULL DEFAULT 0,
  search_queries INT NOT NULL DEFAULT 0,
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, meter_date)
);

CREATE INDEX idx_usage_meters_user_date ON olive_usage_meters (user_id, meter_date DESC);

-- Increment usage helper function
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id TEXT,
  p_meter TEXT,
  p_amount INT DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO olive_usage_meters (user_id, meter_date)
  VALUES (p_user_id, CURRENT_DATE)
  ON CONFLICT (user_id, meter_date) DO NOTHING;

  EXECUTE format(
    'UPDATE olive_usage_meters SET %I = %I + $1, updated_at = now() WHERE user_id = $2 AND meter_date = CURRENT_DATE',
    p_meter, p_meter
  ) USING p_amount, p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Check if user is within quota
CREATE OR REPLACE FUNCTION check_quota(
  p_user_id TEXT,
  p_meter TEXT
) RETURNS TABLE(current_usage INT, max_allowed INT, is_within_quota BOOLEAN) AS $$
DECLARE
  v_plan_id TEXT;
  v_current INT;
  v_max INT;
BEGIN
  -- Get user's active plan
  SELECT s.plan_id INTO v_plan_id
  FROM olive_subscriptions s
  WHERE s.user_id = p_user_id AND s.status IN ('active', 'trialing')
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    v_plan_id := 'free';
  END IF;

  -- Get current usage
  EXECUTE format(
    'SELECT COALESCE((SELECT %I FROM olive_usage_meters WHERE user_id = $1 AND meter_date = CURRENT_DATE), 0)',
    p_meter
  ) INTO v_current USING p_user_id;

  -- Get max from plan
  EXECUTE format(
    'SELECT COALESCE((SELECT %I FROM olive_pricing_plans WHERE plan_id = $1), 0)',
    CASE p_meter
      WHEN 'ai_requests' THEN 'max_ai_requests_per_day'
      WHEN 'whatsapp_messages_sent' THEN 'max_whatsapp_messages_per_day'
      WHEN 'notes_created' THEN 'max_notes_per_month'
      ELSE 'max_ai_requests_per_day'
    END
  ) INTO v_max USING v_plan_id;

  RETURN QUERY SELECT v_current, v_max, v_current < v_max;
END;
$$ LANGUAGE plpgsql;

-- ─── 3. CROSS-SPACE INTELLIGENCE ────────────────────────────

-- Cross-space insights (privacy-safe aggregated patterns)
CREATE TABLE IF NOT EXISTS olive_cross_space_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,  -- The user who benefits from the insight
  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'scheduling_conflict', 'budget_overlap', 'task_duplication',
    'pattern_transfer', 'time_optimization'
  )),
  source_spaces JSONB NOT NULL DEFAULT '[]',  -- [space_id] (for audit, not data leakage)
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  suggestion TEXT,
  confidence FLOAT DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'accepted', 'dismissed')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ  -- Auto-cleanup old insights
);

CREATE INDEX idx_cross_space_insights_user ON olive_cross_space_insights (user_id, status) WHERE status = 'new';
CREATE INDEX idx_cross_space_insights_expiry ON olive_cross_space_insights (expires_at) WHERE expires_at IS NOT NULL;

-- ─── 4. CONFLICT DETECTION ──────────────────────────────────

-- Detected conflicts between tasks, events, or deadlines
CREATE TABLE IF NOT EXISTS olive_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,  -- who the conflict affects
  conflict_type TEXT NOT NULL CHECK (conflict_type IN (
    'schedule_overlap', 'deadline_conflict', 'resource_conflict',
    'assignment_overload', 'budget_conflict'
  )),
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title TEXT NOT NULL,
  description TEXT,
  -- References to conflicting entities
  entity_a_type TEXT NOT NULL,  -- 'note', 'calendar_event', 'delegation', 'budget'
  entity_a_id TEXT NOT NULL,
  entity_b_type TEXT NOT NULL,
  entity_b_id TEXT NOT NULL,
  -- Resolution
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  resolution TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  -- Metadata
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_conflicts_space ON olive_conflicts (space_id, status) WHERE status = 'open';
CREATE INDEX idx_conflicts_user ON olive_conflicts (user_id, status) WHERE status = 'open';

-- ─── 5. POLLS & QUICK DECISIONS ─────────────────────────────

-- Polls for team decision-making
CREATE TABLE IF NOT EXISTS olive_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES olive_spaces(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  question TEXT NOT NULL,
  description TEXT,
  poll_type TEXT NOT NULL DEFAULT 'single' CHECK (poll_type IN ('single', 'multiple', 'ranked')),
  options JSONB NOT NULL DEFAULT '[]',  -- [{id, text, color?}]
  -- Settings
  allow_add_options BOOLEAN NOT NULL DEFAULT false,
  anonymous BOOLEAN NOT NULL DEFAULT false,
  closes_at TIMESTAMPTZ,
  -- Status
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'canceled')),
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_polls_space ON olive_polls (space_id, status) WHERE status = 'open';

-- Poll votes
CREATE TABLE IF NOT EXISTS olive_poll_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES olive_polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  option_ids JSONB NOT NULL DEFAULT '[]',  -- Array of selected option IDs
  ranking JSONB,  -- For ranked polls: [{option_id, rank}]
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(poll_id, user_id)
);

CREATE INDEX idx_poll_votes_poll ON olive_poll_votes (poll_id);

-- ─── 6. PERFORMANCE INDEXES ─────────────────────────────────

-- Composite indexes for common multi-member queries
CREATE INDEX IF NOT EXISTS idx_notes_space_priority
  ON clerk_notes (space_id, priority, is_completed)
  WHERE space_id IS NOT NULL AND NOT is_completed;

CREATE INDEX IF NOT EXISTS idx_notes_space_category
  ON clerk_notes (space_id, category)
  WHERE space_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notes_user_recent
  ON clerk_notes (author_id, updated_at DESC)
  WHERE NOT is_completed;

-- Partial indexes for active data
CREATE INDEX IF NOT EXISTS idx_delegations_active
  ON olive_delegations (space_id, delegated_to, status)
  WHERE status IN ('pending', 'accepted');

CREATE INDEX IF NOT EXISTS idx_space_members_active
  ON olive_space_members (space_id, user_id, role);

-- Full-text search index for notes (enables faster search for 10-member spaces)
CREATE INDEX IF NOT EXISTS idx_notes_search_trgm
  ON clerk_notes USING gin (title gin_trgm_ops)
  WHERE title IS NOT NULL;

-- Enable trigram extension if not already
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── SEED PRICING PLANS ─────────────────────────────────────

INSERT INTO olive_pricing_plans (plan_id, name, description, max_spaces, max_members_per_space, max_notes_per_month, max_ai_requests_per_day, max_whatsapp_messages_per_day, max_file_storage_mb, features, price_monthly_cents, price_yearly_cents, sort_order, is_popular)
VALUES
  ('free', 'Free', 'Get started with Olive basics', 1, 2, 100, 20, 10, 100,
   '{"calendar_sync": false, "oura": false, "email_triage": false, "client_pipeline": false, "workflows": false, "expense_splitting": false}'::jsonb,
   0, 0, 0, false),

  ('personal', 'Personal', 'For individuals who want more from Olive', 2, 2, 500, 100, 50, 500,
   '{"calendar_sync": true, "oura": true, "email_triage": false, "client_pipeline": false, "workflows": true, "expense_splitting": false}'::jsonb,
   799, 7990, 1, false),

  ('team', 'Team', 'Perfect for couples, families, and small teams', 5, 10, 2000, 500, 200, 2000,
   '{"calendar_sync": true, "oura": true, "email_triage": true, "client_pipeline": false, "workflows": true, "expense_splitting": true}'::jsonb,
   1499, 14990, 2, true),

  ('business', 'Business', 'Full Olive experience for your business', 10, 10, 10000, 2000, 1000, 10000,
   '{"calendar_sync": true, "oura": true, "email_triage": true, "client_pipeline": true, "workflows": true, "expense_splitting": true, "industry_templates": true, "decision_log": true}'::jsonb,
   2999, 29990, 3, false)
ON CONFLICT (plan_id) DO NOTHING;

-- ─── RLS POLICIES ────────────────────────────────────────────
ALTER TABLE olive_pricing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_usage_meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_cross_space_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_poll_votes ENABLE ROW LEVEL SECURITY;

-- Pricing plans: public
CREATE POLICY "Anyone can read pricing plans"
  ON olive_pricing_plans FOR SELECT USING (true);

CREATE POLICY "Service role manages pricing plans"
  ON olive_pricing_plans FOR ALL USING (true) WITH CHECK (true);

-- Subscriptions: own only
CREATE POLICY "Users see own subscriptions"
  ON olive_subscriptions FOR SELECT
  USING (user_id = (SELECT auth.uid()::text));

CREATE POLICY "Service role manages subscriptions"
  ON olive_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- Usage meters: own only
CREATE POLICY "Users see own usage"
  ON olive_usage_meters FOR SELECT
  USING (user_id = (SELECT auth.uid()::text));

CREATE POLICY "Service role manages usage meters"
  ON olive_usage_meters FOR ALL USING (true) WITH CHECK (true);

-- Cross-space insights: own only
CREATE POLICY "Users see own insights"
  ON olive_cross_space_insights FOR SELECT
  USING (user_id = (SELECT auth.uid()::text));

CREATE POLICY "Service role manages insights"
  ON olive_cross_space_insights FOR ALL USING (true) WITH CHECK (true);

-- Conflicts: space members
CREATE POLICY "Space members see conflicts"
  ON olive_conflicts FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages conflicts"
  ON olive_conflicts FOR ALL USING (true) WITH CHECK (true);

-- Polls: space members
CREATE POLICY "Space members see polls"
  ON olive_polls FOR SELECT
  USING (
    space_id IN (
      SELECT space_id FROM olive_space_members
      WHERE user_id = (SELECT auth.uid()::text)
    )
  );

CREATE POLICY "Service role manages polls"
  ON olive_polls FOR ALL USING (true) WITH CHECK (true);

-- Poll votes: space members (own votes only for anonymous polls handled at app level)
CREATE POLICY "Space members see poll votes"
  ON olive_poll_votes FOR SELECT
  USING (
    poll_id IN (
      SELECT id FROM olive_polls
      WHERE space_id IN (
        SELECT space_id FROM olive_space_members
        WHERE user_id = (SELECT auth.uid()::text)
      )
    )
  );

CREATE POLICY "Service role manages poll votes"
  ON olive_poll_votes FOR ALL USING (true) WITH CHECK (true);

-- ─── Add plan_id to user preferences ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'olive_user_preferences' AND column_name = 'plan_id'
  ) THEN
    ALTER TABLE olive_user_preferences ADD COLUMN plan_id TEXT DEFAULT 'free' REFERENCES olive_pricing_plans(plan_id);
  END IF;
END $$;
