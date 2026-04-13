-- Sprint 4: Trust + Reflection System
-- ====================================
-- Adds the trust enforcement layer (pending approval queue),
-- trust notifications, and engagement tracking hooks.
-- All tables are ADDITIVE — no existing tables modified or dropped.

-- ─── Trust Actions Queue ───────────────────────────────────────
-- When an action's trust level requires approval (INFORM or SUGGEST),
-- it gets queued here instead of being executed immediately.
CREATE TABLE IF NOT EXISTS olive_trust_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                        -- Clerk user ID
  space_id UUID REFERENCES olive_spaces(id) ON DELETE SET NULL,

  -- What Olive wants to do
  action_type TEXT NOT NULL,                    -- matches trust_matrix keys (e.g. 'assign_task', 'send_whatsapp_to_partner')
  action_payload JSONB NOT NULL DEFAULT '{}',   -- full action data needed to execute
  action_description TEXT NOT NULL,             -- human-readable description for the user

  -- Trust context
  trust_level INT NOT NULL DEFAULT 0,           -- 0=inform, 1=suggest, 2=act_report, 3=autonomous
  required_level INT NOT NULL DEFAULT 2,        -- minimum level needed to auto-execute

  -- Status flow: pending → approved/rejected/expired
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed')),

  -- User response
  user_response TEXT,                           -- optional: user's modification or reason for rejection
  responded_at TIMESTAMPTZ,

  -- Execution tracking
  executed_at TIMESTAMPTZ,
  execution_result JSONB,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  -- Source context
  trigger_type TEXT DEFAULT 'proactive',        -- 'proactive', 'user_message', 'agent', 'scheduled'
  trigger_context JSONB DEFAULT '{}'            -- original message/context that triggered this
);

CREATE INDEX IF NOT EXISTS idx_trust_actions_user_pending
  ON olive_trust_actions (user_id, status, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_trust_actions_user_recent
  ON olive_trust_actions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trust_actions_space
  ON olive_trust_actions (space_id, status) WHERE space_id IS NOT NULL;

-- Auto-expire old pending actions
CREATE OR REPLACE FUNCTION expire_old_trust_actions()
RETURNS void AS $$
BEGIN
  UPDATE olive_trust_actions
  SET status = 'expired'
  WHERE status = 'pending' AND expires_at < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Trust Notifications ───────────────────────────────────────
-- Lightweight notification table for trust-related events:
-- escalation proposals, deferred soul changes, action approvals needed.
CREATE TABLE IF NOT EXISTS olive_trust_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,

  -- Notification type
  type TEXT NOT NULL CHECK (type IN (
    'action_approval',       -- Olive wants to do something, needs user OK
    'trust_escalation',      -- Olive proposes higher trust for an action type
    'soul_evolution',        -- Major soul change proposed, needs confirmation
    'engagement_drop',       -- Engagement score dropped significantly
    'trust_de_escalation'    -- Trust auto-decreased due to rejections
  )),

  -- Content
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',         -- type-specific data

  -- Linked entities
  trust_action_id UUID REFERENCES olive_trust_actions(id) ON DELETE SET NULL,

  -- Status
  read_at TIMESTAMPTZ,
  acted_on_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_notifications_user_unread
  ON olive_trust_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- ─── Engagement Event Log ──────────────────────────────────────
-- Granular event log for computing engagement metrics accurately.
-- olive_engagement_metrics stores aggregates; this stores raw events.
CREATE TABLE IF NOT EXISTS olive_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'message_sent',          -- Olive sent a message
    'message_responded',     -- User responded to Olive
    'proactive_accepted',    -- User accepted a proactive suggestion
    'proactive_ignored',     -- User ignored (no response in 24h)
    'proactive_rejected',    -- User explicitly rejected
    'action_approved',       -- User approved a queued action
    'action_rejected',       -- User rejected a queued action
    'task_completed',        -- User completed a task
    'note_created',          -- User created a note
    'session_start'          -- User opened the app
  )),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_user_recent
  ON olive_engagement_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_engagement_events_user_type_7d
  ON olive_engagement_events (user_id, event_type, created_at)
  WHERE created_at > (now() - INTERVAL '7 days');

-- ─── RLS Policies ──────────────────────────────────────────────
ALTER TABLE olive_trust_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_trust_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE olive_engagement_events ENABLE ROW LEVEL SECURITY;

-- Trust actions: users see their own
CREATE POLICY "Users see own trust actions"
  ON olive_trust_actions FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can update own trust actions"
  ON olive_trust_actions FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages trust actions"
  ON olive_trust_actions FOR ALL
  USING (true) WITH CHECK (true);

-- Trust notifications: users see their own
CREATE POLICY "Users see own trust notifications"
  ON olive_trust_notifications FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Users can update own trust notifications"
  ON olive_trust_notifications FOR UPDATE
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages trust notifications"
  ON olive_trust_notifications FOR ALL
  USING (true) WITH CHECK (true);

-- Engagement events: users see their own
CREATE POLICY "Users see own engagement events"
  ON olive_engagement_events FOR SELECT
  USING (user_id = (auth.jwt() ->> 'sub'));

CREATE POLICY "Service role manages engagement events"
  ON olive_engagement_events FOR ALL
  USING (true) WITH CHECK (true);

-- ─── RPC: Compute engagement score from events ─────────────────
CREATE OR REPLACE FUNCTION compute_engagement_score(p_user_id TEXT)
RETURNS INT AS $$
DECLARE
  v_accept_rate FLOAT;
  v_response_rate FLOAT;
  v_recency_score FLOAT;
  v_proactive_sent INT;
  v_proactive_accepted INT;
  v_messages_sent INT;
  v_messages_responded INT;
  v_last_interaction TIMESTAMPTZ;
  v_score INT;
BEGIN
  -- Count 7-day engagement events
  SELECT
    COUNT(*) FILTER (WHERE event_type IN ('proactive_accepted', 'proactive_ignored', 'proactive_rejected')),
    COUNT(*) FILTER (WHERE event_type = 'proactive_accepted'),
    COUNT(*) FILTER (WHERE event_type = 'message_sent'),
    COUNT(*) FILTER (WHERE event_type = 'message_responded'),
    MAX(created_at)
  INTO v_proactive_sent, v_proactive_accepted, v_messages_sent, v_messages_responded, v_last_interaction
  FROM olive_engagement_events
  WHERE user_id = p_user_id
    AND created_at > (now() - INTERVAL '7 days');

  -- Acceptance rate (40%)
  v_accept_rate := CASE WHEN v_proactive_sent > 0
    THEN (v_proactive_accepted::FLOAT / v_proactive_sent) * 40
    ELSE 20 END; -- neutral if no proactive yet

  -- Response rate (30%)
  v_response_rate := CASE WHEN v_messages_sent > 0
    THEN (v_messages_responded::FLOAT / v_messages_sent) * 30
    ELSE 15 END; -- neutral

  -- Recency (20%) — decays over 14 days
  v_recency_score := CASE
    WHEN v_last_interaction IS NULL THEN 5
    WHEN v_last_interaction > (now() - INTERVAL '1 day') THEN 20
    WHEN v_last_interaction > (now() - INTERVAL '3 days') THEN 15
    WHEN v_last_interaction > (now() - INTERVAL '7 days') THEN 10
    WHEN v_last_interaction > (now() - INTERVAL '14 days') THEN 5
    ELSE 0 END;

  -- Base score (10)
  v_score := LEAST(100, GREATEST(0,
    ROUND(v_accept_rate + v_response_rate + v_recency_score + 10)::INT
  ));

  -- Update the aggregate table
  INSERT INTO olive_engagement_metrics (user_id, score, messages_sent_7d, messages_responded_7d,
    proactive_accepted_7d, proactive_ignored_7d, proactive_rejected_7d, last_interaction, updated_at)
  VALUES (
    p_user_id, v_score, v_messages_sent, v_messages_responded,
    v_proactive_accepted,
    (SELECT COUNT(*) FROM olive_engagement_events WHERE user_id = p_user_id AND event_type = 'proactive_ignored' AND created_at > now() - INTERVAL '7 days'),
    (SELECT COUNT(*) FROM olive_engagement_events WHERE user_id = p_user_id AND event_type = 'proactive_rejected' AND created_at > now() - INTERVAL '7 days'),
    v_last_interaction,
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    score = EXCLUDED.score,
    messages_sent_7d = EXCLUDED.messages_sent_7d,
    messages_responded_7d = EXCLUDED.messages_responded_7d,
    proactive_accepted_7d = EXCLUDED.proactive_accepted_7d,
    proactive_ignored_7d = EXCLUDED.proactive_ignored_7d,
    proactive_rejected_7d = EXCLUDED.proactive_rejected_7d,
    last_interaction = EXCLUDED.last_interaction,
    updated_at = now();

  RETURN v_score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
