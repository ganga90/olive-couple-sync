-- Soul Phase D-1 — schedule olive-prompt-evolve weekly via pg_cron
-- ============================================================================
-- Companion to PR #68 (the D-1.b function). Schedules the weekly observation
-- run on Sundays at 05:00 UTC — one hour after `olive-soul-evolve-weekly`
-- (04:00 UTC) so the two heavy weekly jobs don't overlap on the same
-- service-role rate-limit window.
--
-- Idempotent (DO/IF NOT EXISTS guard mirrors the soul-evolve cron).
--
-- Important safety property: this cron WILL fire every Sunday after merge,
-- but the deployed function is gated by the `PROMPT_EVOLVE_ENABLED` env
-- flag (default off). The first thing the handler does is check the flag
-- and return `{feature_enabled: false, skipped: ['feature_disabled']}` if
-- it isn't set. Result: scheduled but inert until the flag is flipped.
--
-- Rollout discipline:
--   1. This migration applies → cron starts firing weekly (no effect)
--   2. We observe the cron run a couple of times to confirm logs are clean
--   3. Only then do we set PROMPT_EVOLVE_ENABLED=true to activate
--   4. At today's corpus (35/36 reflections are 'ignored', none mapped to
--      prompt modules), even active runs produce zero proposals — the
--      threshold gates from D-1.a guarantee that. See the pinned-safety
--      test in `run-prompt-evolution.test.ts` line ~285.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'olive-prompt-evolve-weekly'
  ) THEN
    PERFORM cron.schedule(
      'olive-prompt-evolve-weekly',
      '0 5 * * 0',  -- Sundays 05:00 UTC, 1h after soul-evolve
      $cron$
      SELECT net.http_post(
        url := current_setting('supabase_functions_endpoint') || '/olive-prompt-evolve',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('supabase.service_role_key')
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;
