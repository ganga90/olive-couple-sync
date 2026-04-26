-- Funnel view extension — slice by onboarding_version
-- =====================================================================
-- TASK-ONB-D added olive_user_preferences.onboarding_version. ONB-B's
-- v_onboarding_funnel didn't know about it (built before D existed),
-- so the dashboard currently rolls up all cohorts together.
--
-- This migration replaces v_onboarding_funnel with a version-aware
-- version. Behavior preserved for the version-agnostic case via a
-- separate v_onboarding_funnel_total view that callers can opt into
-- when they want totals across cohorts.
--
-- Why two views instead of grouping in queries:
--   The dashboard's most-used query right now is "show today's funnel"
--   — having a dedicated cohort-aware view keeps that query simple
--   and makes the A/B comparison trivial in any SQL client. Totals
--   are then a thin convenience for back-of-envelope checks.
--
-- This migration is purely additive at the schema level (CREATE OR
-- REPLACE VIEW + new view); no data is rewritten.

CREATE OR REPLACE VIEW public.v_onboarding_funnel AS
WITH user_first_events AS (
  SELECT
    e.user_id,
    -- Slice key. COALESCE so users without a preferences row (anomalous
    -- but possible) bucket as 'unknown' rather than dropping out of the
    -- funnel entirely — useful signal: "are we missing assignment writes?"
    COALESCE(p.onboarding_version, 'unknown') AS onboarding_version,
    MIN(e.created_at) FILTER (WHERE e.event = 'flow_started')      AS started_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'space_created')     AS space_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'capture_sent')      AS capture_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'wa_connected')      AS wa_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'flow_completed')    AS completed_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'beat_skipped' AND e.beat = 'whatsapp') AS wa_skipped_at,
    -- Two new columns since the prior version of this view: receipt
    -- visit + invite generation. Both are zero-impact for v1 cohorts
    -- but surface in v2 once those events start landing.
    MIN(e.created_at) FILTER (WHERE e.event = 'beat_started' AND e.beat = 'receipt') AS receipt_at,
    MIN(e.created_at) FILTER (WHERE e.event = 'invite_generated') AS invite_at,
    DATE_TRUNC('day', MIN(e.created_at) FILTER (WHERE e.event = 'flow_started'))::date AS cohort_day
  FROM public.olive_onboarding_events e
  LEFT JOIN public.olive_user_preferences p ON p.user_id = e.user_id
  GROUP BY e.user_id, COALESCE(p.onboarding_version, 'unknown')
)
SELECT
  cohort_day                                                        AS day,
  onboarding_version                                                AS version,
  COUNT(*) FILTER (WHERE started_at IS NOT NULL)                    AS started,
  COUNT(*) FILTER (WHERE space_at IS NOT NULL)                      AS space_created,
  COUNT(*) FILTER (WHERE capture_at IS NOT NULL)                    AS first_capture,
  COUNT(*) FILTER (WHERE wa_at IS NOT NULL)                         AS wa_connected,
  COUNT(*) FILTER (WHERE wa_skipped_at IS NOT NULL)                 AS wa_skipped,
  COUNT(*) FILTER (WHERE invite_at IS NOT NULL)                     AS invites_generated,
  COUNT(*) FILTER (WHERE receipt_at IS NOT NULL)                    AS receipt_seen,
  COUNT(*) FILTER (WHERE completed_at IS NOT NULL)                  AS completed,

  ROUND(
    COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_completed,

  ROUND(
    COUNT(*) FILTER (WHERE capture_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_first_capture,

  ROUND(
    COUNT(*) FILTER (WHERE wa_at IS NOT NULL)::numeric * 100
      / NULLIF(COUNT(*) FILTER (WHERE started_at IS NOT NULL), 0),
    1
  ) AS pct_wa_connected,

  ROUND(
    AVG(EXTRACT(EPOCH FROM (capture_at - started_at)))::numeric,
    1
  ) AS avg_seconds_to_first_capture,

  ROUND(
    AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))::numeric,
    1
  ) AS avg_seconds_total
FROM user_first_events
WHERE cohort_day IS NOT NULL
GROUP BY cohort_day, onboarding_version
ORDER BY cohort_day DESC, onboarding_version;

-- Convenience: roll-up across versions for back-of-envelope dashboards
-- that don't care about the cohort split. Same shape as the v1 view
-- TASK-ONB-B shipped, minus the version column.
CREATE OR REPLACE VIEW public.v_onboarding_funnel_total AS
SELECT
  day,
  SUM(started)               AS started,
  SUM(space_created)         AS space_created,
  SUM(first_capture)         AS first_capture,
  SUM(wa_connected)          AS wa_connected,
  SUM(wa_skipped)            AS wa_skipped,
  SUM(invites_generated)     AS invites_generated,
  SUM(receipt_seen)          AS receipt_seen,
  SUM(completed)             AS completed,
  -- Re-derive aggregate ratios so they're not just averages of
  -- averages (which would mislead when cohort sizes differ).
  ROUND(
    SUM(completed)::numeric * 100 / NULLIF(SUM(started), 0),
    1
  ) AS pct_completed,
  ROUND(
    SUM(first_capture)::numeric * 100 / NULLIF(SUM(started), 0),
    1
  ) AS pct_first_capture,
  ROUND(
    SUM(wa_connected)::numeric * 100 / NULLIF(SUM(started), 0),
    1
  ) AS pct_wa_connected,
  -- Weighted average across cohorts: weight by `started` count so a
  -- 1000-user cohort with 30s and a 2-user cohort with 200s aggregate
  -- to ~30s, not ~115s.
  ROUND(
    SUM(avg_seconds_to_first_capture * started)
      / NULLIF(SUM(started), 0)::numeric,
    1
  ) AS avg_seconds_to_first_capture,
  ROUND(
    SUM(avg_seconds_total * started)
      / NULLIF(SUM(started), 0)::numeric,
    1
  ) AS avg_seconds_total
FROM public.v_onboarding_funnel
GROUP BY day
ORDER BY day DESC;

COMMENT ON VIEW public.v_onboarding_funnel IS
  'Daily onboarding funnel sliced by onboarding_version. One row per (day, version). Use v_onboarding_funnel_total for cross-version rollups. Service role for cross-user analytics; user-scoped queries return only their own row.';

COMMENT ON VIEW public.v_onboarding_funnel_total IS
  'Cross-version daily rollup of v_onboarding_funnel. Aggregate ratios are re-derived from sums (not averaged) so they remain meaningful when cohort sizes differ.';
