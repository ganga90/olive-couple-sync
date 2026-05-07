-- Soul Phase D-1.a — prompt addendum schema
-- ===========================================================================
-- Backs the reflection-driven prompt-evolution loop (Phase D-1). Each row
-- represents a proposed addendum to a base prompt module — extracted by
-- olive-prompt-evolve from a cluster of high-signal reflections (modified
-- and rejected outcomes from olive_reflections).
--
-- Lifecycle (state machine):
--
--   [olive-prompt-evolve cron observes a high-signal cluster]
--               ↓
--      INSERT status='pending'
--               ↓                              ↓
--   admin approves                        admin rejects
--   status='testing', rollout_pct=10        status='rejected'
--               ↓
--   24h+ A/B observation → enough sample size
--               ↓                              ↓
--   ab_treatment_modified_rate            regression detected
--     <= ab_baseline_modified_rate        status='rejected'
--               ↓
--   admin rolls forward
--   status='approved', rollout_pct=100
--   UNIQUE (per module) constraint enforced
--
-- Plus terminal states:
--   - 'rolled_back' — was approved, now disabled
--   - 'expired'     — pending too long without admin action (cron sweep)
--
-- Concurrency: only ONE addendum per (prompt_module) can be in 'approved'
-- state at a time, enforced by partial unique index. This prevents
-- compounding addendums from stacking unintentionally — every new
-- addendum proposed against an approved one is implicitly an *update*,
-- which the cron handles by superseding (mark old as 'rolled_back',
-- propose new as 'pending').

CREATE TABLE IF NOT EXISTS olive_prompt_addendums (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IDENTITY
  -- The prompt module this addendum extends. Must match a key in
  -- _shared/prompts/intents/registry.ts (chat, contextual_ask, create,
  -- search, expense, task_action, partner_message, help_about_olive).
  prompt_module TEXT NOT NULL,
  -- The base version the addendum was generated against. Matches
  -- olive_llm_calls.prompt_version so analytics can join across.
  base_version TEXT NOT NULL,

  -- THE CHANGE
  -- The text appended to the base system prompt. Kept as additive-only
  -- (V1) so rollback is simply "stop appending" — no need to reverse a
  -- diff against a moving baseline.
  addendum_text TEXT NOT NULL,
  -- Pro's reasoning for proposing this. Stored verbatim for audit + future
  -- meta-analysis (which reasoning patterns produce successful addendums?).
  reasoning TEXT,

  -- EVIDENCE
  reflections_observed_count INT NOT NULL,
  reflections_window_start TIMESTAMPTZ NOT NULL,
  reflections_window_end TIMESTAMPTZ NOT NULL,
  -- Short signature of the underlying cluster pattern, e.g.
  -- "categorize_note: 8 reflections, 62% modified, top: groceries→shopping".
  -- Helps deduplicate near-identical proposals across cron runs.
  pattern_signature TEXT,

  -- LIFECYCLE / STATE MACHINE
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- proposed but not active
    'testing',     -- A/B at rollout_pct (typically 10–50%)
    'approved',    -- promoted to 100%
    'rejected',    -- A/B regressed, or admin denied at proposal time
    'rolled_back', -- was approved, now disabled
    'expired'      -- pending too long without admin action
  )),
  rollout_pct INT NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),

  -- A/B RESULTS (filled after enough traffic during 'testing')
  -- "modified_rate" = (modified + rejected) / total reflections during the
  -- A/B window. Lower is better — fewer corrections from users.
  ab_baseline_modified_rate FLOAT,
  ab_treatment_modified_rate FLOAT,
  ab_sample_size INT,

  -- SAFETY
  -- Per-row lock — admin can lock an approved addendum to prevent it being
  -- superseded by a new automatic proposal until the lock is lifted.
  is_locked BOOLEAN NOT NULL DEFAULT false,

  -- AUDIT
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decision_reason TEXT,
  rolled_out_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,

  -- The administrator who decided. Service-role-driven cron runs leave
  -- this NULL; manual decisions populate it for audit.
  decided_by TEXT
);

-- ─── Indexes ─────────────────────────────────────────────────────

-- Hot path: A/B resolver looks up active addendums by module
CREATE INDEX IF NOT EXISTS idx_prompt_addendums_active_lookup
  ON olive_prompt_addendums (prompt_module)
  WHERE status IN ('testing', 'approved');

-- Admin lists: pending proposals awaiting decision
CREATE INDEX IF NOT EXISTS idx_prompt_addendums_pending
  ON olive_prompt_addendums (created_at DESC)
  WHERE status = 'pending';

-- Analytics + dedup: finding similar past proposals for a module
CREATE INDEX IF NOT EXISTS idx_prompt_addendums_module_history
  ON olive_prompt_addendums (prompt_module, base_version, created_at DESC);

-- INVARIANT: at most ONE 'approved' addendum per module at any time.
-- Multiple 'testing' addendums are permitted (rare race; admin resolves).
-- Multiple 'pending' addendums are permitted (cron may produce duplicates;
-- admin reviews before activating).
CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_addendums_one_approved_per_module
  ON olive_prompt_addendums (prompt_module)
  WHERE status = 'approved';

-- ─── RLS ─────────────────────────────────────────────────────────

ALTER TABLE olive_prompt_addendums ENABLE ROW LEVEL SECURITY;

-- This is admin-only infrastructure. End users never see or interact
-- with these rows directly — they only experience the rolled-out
-- prompt changes implicitly via Olive's responses.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'olive_prompt_addendums'
      AND policyname = 'Service role manages prompt addendums'
  ) THEN
    CREATE POLICY "Service role manages prompt addendums"
      ON olive_prompt_addendums FOR ALL
      USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE olive_prompt_addendums IS
  'Phase D-1: reflection-driven prompt evolution proposals. The cron '
  '`olive-prompt-evolve` produces these; admin endpoints in '
  '`olive-soul-safety` approve/reject/rollback. Active addendums are '
  'looked up at request time by the A/B resolver and appended to the '
  'matching base prompt module.';
