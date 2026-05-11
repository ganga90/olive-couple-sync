-- revoke_calendar_rpcs_from_public
-- ─────────────────────────────────────────────────────────────────────
-- Security fix flagged by Supabase advisor immediately after the
-- Phase 2.1 and 3.5 migrations applied.
--
-- The two new SECURITY DEFINER RPCs (olive_claim_calendar_sync_jobs,
-- olive_record_user_pattern) inherit the default EXECUTE grant for
-- PUBLIC, which means anon + authenticated roles can call them via
-- the auto-generated REST API at /rest/v1/rpc/<name>. That's a
-- problem for both:
--
--   - olive_claim_calendar_sync_jobs: an attacker with the anon key
--     could claim pending retry jobs, marking them in_flight and
--     reading the payload (which contains user_id + Google event
--     metadata).
--   - olive_record_user_pattern: takes user_id as a plain text arg,
--     so any caller could inject fake patterns into any user's
--     pattern store, poisoning the Phase 3.5 hint surfacing.
--
-- Service-role calls bypass these grants entirely, so revoking from
-- PUBLIC, anon, and authenticated keeps the edge-function path
-- working while closing the REST exposure.
--
-- ROLLBACK (manual):
--   GRANT EXECUTE ON FUNCTION public.olive_claim_calendar_sync_jobs(integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.olive_record_user_pattern(text, text, jsonb, text) TO PUBLIC;

REVOKE EXECUTE ON FUNCTION public.olive_claim_calendar_sync_jobs(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.olive_claim_calendar_sync_jobs(integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.olive_claim_calendar_sync_jobs(integer) FROM authenticated;

REVOKE EXECUTE ON FUNCTION public.olive_record_user_pattern(text, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.olive_record_user_pattern(text, text, jsonb, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.olive_record_user_pattern(text, text, jsonb, text) FROM authenticated;
