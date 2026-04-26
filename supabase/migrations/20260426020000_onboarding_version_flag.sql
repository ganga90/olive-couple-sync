-- Onboarding version flag — A/B-safe rollout for the v2 flow shape
-- =====================================================================
-- TASK-ONB-A wired quiz answers into Spaces + Soul. ONB-B added the
-- funnel events that let us measure flow performance. ONB-D introduces
-- a per-user version flag so we can run v1 (the legacy 7-step flow)
-- and v2 (a leaner 4–5-step flow that drops mental-load substep,
-- regional confirm, and Calendar OAuth) side-by-side and compare.
--
-- Why a column instead of localStorage:
--   The funnel view (v_onboarding_funnel from ONB-B) needs to slice by
--   version cohort. Server-side persistence is the only way to do that
--   reliably — a localStorage flag is per-device, gets wiped, and isn't
--   visible to the dashboard.
--
-- Default rollout policy:
--   - This migration sets the column DEFAULT to 'v1'. Existing users
--     who already have a row in olive_user_preferences (or who have
--     none at all and get a default-row insert later) stay on v1.
--   - The frontend (useOnboardingVersion.ts) is responsible for
--     UPSERTING 'v2' on first onboarding render for users who do NOT
--     already have a non-null preference. This keeps the rollout
--     reversible at the application layer (we can change the assignment
--     rule without a migration).
--   - Once value distribution is read by the funnel, we can decide
--     whether to default new rows to 'v2' in a follow-up migration.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS guards re-runs.

ALTER TABLE public.olive_user_preferences
  ADD COLUMN IF NOT EXISTS onboarding_version TEXT NOT NULL DEFAULT 'v1';

-- Index supports the funnel view's eventual GROUP BY version slice.
-- Partial because we only ever filter on non-default cohorts when
-- analyzing — saves index bytes for the (still majority) v1 users.
CREATE INDEX IF NOT EXISTS idx_user_prefs_onboarding_version
  ON public.olive_user_preferences (onboarding_version)
  WHERE onboarding_version <> 'v1';

COMMENT ON COLUMN public.olive_user_preferences.onboarding_version IS
  'Which onboarding flow shape this user saw. Set by useOnboardingVersion on first onboarding render. v1 = legacy 7-step; v2 = lean 4–5-step. Used by v_onboarding_funnel for A/B slicing.';
