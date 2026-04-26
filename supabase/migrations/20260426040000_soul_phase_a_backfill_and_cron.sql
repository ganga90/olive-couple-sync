-- Soul Phase A — backfill existing users + schedule olive-soul-evolve
-- ====================================================================
-- This migration completes Phase A of the Soul rollout:
--
--   A2) Backfill: every existing user with activity gets a minimal User
--       Soul + Trust Soul + engagement metrics row, and soul_enabled is
--       flipped to true. Without this, only users who run through the
--       NEW onboarding (post PR #6 + the onboarding-finalize patch in
--       this branch) ever get a soul — every existing user keeps
--       running on the legacy unpersonalized path.
--
--   A3) pg_cron: schedule olive-soul-evolve weekly so the User Soul
--       layer actually evolves. Until this is in place, layers stay
--       frozen at their seeded value forever.
--
-- Both sections are idempotent. The backfill uses INSERT ... ON CONFLICT
-- DO NOTHING so re-running is safe; the cron block guards on cron.job.
-- All writes target Clerk user IDs (TEXT), matching the rest of the
-- soul system's owner_id contract.

-- ─── A2. Backfill: activity-having users get a soul ─────────────────
--
-- Universe of "existing user" = anyone with a clerk_profile row. Profiles
-- are created by clerk-sync on first auth, so this is the closest thing
-- to "has ever logged in."
--
-- For each, write three rows (each gated by a unique constraint to skip
-- users who already have a soul from PR #6 onboarding):
--   1. olive_soul_layers (layer_type='user') — minimal default content
--   2. olive_soul_layers (layer_type='trust') — default trust matrix
--   3. olive_engagement_metrics — score=50, fresh row
--
-- Then flip olive_user_preferences.soul_enabled = true for each backfilled
-- user. The flag flip is also idempotent (UPDATE, no INSERT).

-- 1. User Soul layer (minimal — evolution will fill in domain knowledge
-- as the user actually uses Olive). Confidence-zero seed; the renderer
-- threshold of 0.5 means this contributes nothing to prompts until the
-- weekly evolve adds real signal — which is the right behavior for
-- backfilled users who never answered the onboarding quiz.
INSERT INTO olive_soul_layers (
  layer_type, owner_type, owner_id, version, content, content_rendered, token_count, is_locked
)
SELECT
  'user',
  'user',
  cp.id,  -- Clerk user ID (TEXT)
  1,
  jsonb_build_object(
    'identity', jsonb_build_object(
      'tone', 'warm',
      'verbosity', 'balanced',
      'humor', true,
      'emoji_level', 'minimal'
    ),
    'user_context', jsonb_build_object('type', 'individual'),
    'domain_knowledge', '[]'::jsonb,
    'relationships', '[]'::jsonb,
    'communication', jsonb_build_object(
      'response_style', 'concise',
      'preferred_channel', 'whatsapp'
    ),
    'proactive_rules', '[]'::jsonb,
    'source', 'backfill',
    'seeded_at', now()
  ),
  -- content_rendered NULL forces renderUserSoul to compute on first read.
  -- Avoids hardcoding the rendered shape here (it would drift from
  -- _shared/soul.ts:renderUserSoul without a way to catch it).
  NULL,
  0,
  false
FROM clerk_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM olive_soul_layers existing
  WHERE existing.layer_type = 'user'
    AND existing.owner_type = 'user'
    AND existing.owner_id = cp.id
)
ON CONFLICT DO NOTHING;

-- 2. Trust Soul layer with the canonical default matrix. This must match
-- DEFAULT_TRUST_MATRIX in onboarding-finalize/index.ts and olive-soul-seed.
INSERT INTO olive_soul_layers (
  layer_type, owner_type, owner_id, version, content, content_rendered, token_count, is_locked
)
SELECT
  'trust',
  'user',
  cp.id,
  1,
  jsonb_build_object(
    'trust_matrix', jsonb_build_object(
      'categorize_note', 3,
      'create_reminder', 3,
      'create_task', 3,
      'process_receipt', 3,
      'save_memory', 3,
      'send_whatsapp_to_self', 2,
      'assign_task', 1,
      'send_whatsapp_to_partner', 1,
      'send_whatsapp_to_client', 0,
      'modify_budget', 1,
      'delete_note', 1,
      'send_invoice', 0,
      'book_appointment', 0
    )
  ),
  NULL,
  0,
  false
FROM clerk_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM olive_soul_layers existing
  WHERE existing.layer_type = 'trust'
    AND existing.owner_type = 'user'
    AND existing.owner_id = cp.id
)
ON CONFLICT DO NOTHING;

-- 3. Engagement metrics: a baseline 50 score so olive-soul-evolve has
-- something to read on the first cycle.
INSERT INTO olive_engagement_metrics (user_id, score, updated_at)
SELECT cp.id, 50, now()
FROM clerk_profiles cp
ON CONFLICT (user_id) DO NOTHING;

-- 4. Flip soul_enabled = true for every user that now has both layers.
-- We do NOT enable soul for users who somehow lack a profile but have a
-- preferences row — preferences without a profile would mean an orphan
-- and we should not personalize for them.
INSERT INTO olive_user_preferences (user_id, soul_enabled, created_at, updated_at)
SELECT cp.id, true, now(), now()
FROM clerk_profiles cp
ON CONFLICT (user_id)
DO UPDATE SET soul_enabled = true, updated_at = now()
WHERE olive_user_preferences.soul_enabled IS DISTINCT FROM true;

-- ─── A3. pg_cron: schedule olive-soul-evolve weekly ─────────────────
--
-- Mirrors the pattern used by olive-memory-maintenance-weekly in
-- 20260411020000_phase3_memory_quality.sql — same time slot family
-- (early-Sunday UTC), service_role auth via current_setting().
--
-- Runs Sundays at 04:00 UTC (one hour after memory maintenance, so the
-- two heavy weekly jobs don't overlap). Empty body means
-- olive-soul-evolve picks up all eligible users (soul_enabled=true,
-- not evolved in 24h, not locked, ≥3 notes in 7 days).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'olive-soul-evolve-weekly'
  ) THEN
    PERFORM cron.schedule(
      'olive-soul-evolve-weekly',
      '0 4 * * 0',
      $$
      SELECT net.http_post(
        url := current_setting('supabase_functions_endpoint') || '/olive-soul-evolve',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        ),
        body := '{}'::jsonb
      );
      $$
    );
  END IF;
END $$;
