-- Soul Phase C-3.a — major-change proposal table
-- ===================================================================
-- Until now, when olive-soul-evolve detected a "major" change (one that
-- significantly alters Olive's personality, e.g. detected a shift from
-- personal → business usage), the change was silently dropped — see the
-- TODO at olive-soul-evolve/index.ts:243. The user never saw the
-- proposal; soul evolution effectively stopped at the boundary of
-- "small adjustments only".
--
-- This migration creates the proposal table that backs Phase C-3:
-- major changes get stored as pending proposals; the user sees an
-- approval card; on approve, the change applies via upsertSoulLayer;
-- on reject (or 7-day expiry), the proposal closes without effect.
--
-- Idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS olive_soul_change_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,                    -- Clerk user ID (matches owner_id pattern)

  -- Which soul layer the proposal targets. 'space' lives behind
  -- the same constraint set so a future space-level evolution can
  -- reuse this table without schema churn.
  layer_type TEXT NOT NULL CHECK (layer_type IN ('user', 'space', 'trust')),

  -- The full proposed JSONB content for the layer. We don't store a
  -- diff for V1: layers are small (300-500 tokens), full-content
  -- replacement on apply is correct, simple, and matches the existing
  -- upsertSoulLayer contract.
  proposed_content JSONB NOT NULL,

  -- Human-readable summary surfaced to the user in the approval card.
  -- Comes from the Gemini reflection step's `description` field.
  summary TEXT NOT NULL,

  -- What caused this proposal. Same enum the evolution_log uses, so
  -- analytics can join across both tables for a "why did Olive want
  -- to change?" view.
  trigger TEXT NOT NULL CHECK (trigger IN (
    'pattern_detection', 'engagement_decay', 'feedback', 'reflection',
    'trust_escalation', 'industry_shift', 'manual', 'system'
  )),

  -- The version of the existing layer at proposal time. Approval
  -- checks this — if current_version > base_version when the user
  -- decides, another change landed in the meantime and this proposal
  -- is stale (must be re-evaluated, not silently overwritten).
  base_version INT NOT NULL,

  -- State machine. 'expired' is the heartbeat-sweep terminal state for
  -- proposals the user never decided. 'stale' is the version-conflict
  -- state described above.
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'rejected', 'expired', 'stale'
  )),

  -- Decision metadata
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,

  -- The new layer version that resulted from approval. Null for
  -- non-approved terminal states.
  applied_version INT,

  -- Lifecycle
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days')
);

-- Indexes
-- 1. Pending lookups for the user's approval UI (most common read)
CREATE INDEX IF NOT EXISTS idx_soul_proposals_user_pending
  ON olive_soul_change_proposals (user_id, created_at DESC)
  WHERE status = 'pending';

-- 2. Expired-cleanup sweep (heartbeat or future cron)
CREATE INDEX IF NOT EXISTS idx_soul_proposals_pending_expiry
  ON olive_soul_change_proposals (expires_at)
  WHERE status = 'pending';

-- 3. Audit / analytics — proposals by trigger over time
CREATE INDEX IF NOT EXISTS idx_soul_proposals_trigger_status
  ON olive_soul_change_proposals (trigger, status, created_at DESC);

-- ─── RLS ───────────────────────────────────────────────────────────
ALTER TABLE olive_soul_change_proposals ENABLE ROW LEVEL SECURITY;

-- Users can read their own proposals (powers the approval UI).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'olive_soul_change_proposals'
      AND policyname = 'Users see own proposals'
  ) THEN
    CREATE POLICY "Users see own proposals"
      ON olive_soul_change_proposals FOR SELECT
      USING (user_id = (SELECT auth.uid()::text));
  END IF;
END $$;

-- Service role does everything (the propose/approve/reject endpoints
-- use the service role client; user-driven approve/reject still goes
-- through those endpoints, which authenticate the user separately).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'olive_soul_change_proposals'
      AND policyname = 'Service role manages proposals'
  ) THEN
    CREATE POLICY "Service role manages proposals"
      ON olive_soul_change_proposals FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE olive_soul_change_proposals IS
  'Phase C-3.a: pending major soul evolutions awaiting user approval. '
  'Replaces the silent-defer behavior at olive-soul-evolve/index.ts:243.';
