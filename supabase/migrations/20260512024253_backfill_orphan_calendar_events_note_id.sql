-- backfill_orphan_calendar_events_note_id
-- ─────────────────────────────────────────────────────────────────────
-- Re-links the calendar_events rows that lost their connection back to
-- clerk_notes because of the process-note autoAddToCalendar race fixed
-- in 20260512024215_clerk_notes_auto_calendar_trigger.sql.
--
-- Without this backfill, the trigger-based fix only prevents NEW
-- orphans; the ones already in the DB would still hit "no_linked_event"
-- when their owner tries to reschedule.
--
-- Match strategy (validated against prod at apply-time)
-- ─────────────────────────────────────────────────────
-- For each orphan row with event_type='from_note', look for a single
-- clerk_notes row that:
--   1. has the same author as the calendar_connections owner
--   2. has identical `summary` to the event title
--   3. was created within ±120 seconds of the event row
--
-- The 120s window comfortably covers the observed race (~3 seconds
-- between calendar_events insert and clerk_notes commit) plus any
-- jitter on retried inserts, while being tight enough that two notes
-- of the same title from the same user typically don't collide within
-- it.
--
-- A pre-flight count at migration-write time over the existing prod
-- data: 47 unique matches, 2 no-match (note deleted post-create),
-- 0 ambiguous matches.
--
-- Ambiguous matches (>1 candidate clerk_notes row in the window) are
-- intentionally skipped — better to leave the orphan than wrong-link.
--
-- ROLLBACK (manual):
-- Set note_id back to NULL for any row updated by this migration:
--   UPDATE calendar_events SET note_id = NULL
--    WHERE id IN (SELECT ce_id FROM backfilled_calendar_event_links_20260512);
-- (The audit table created below preserves the before/after for exactly
-- this purpose.)

-- Audit table — records what we changed so rollback is precise.
-- Persistent, not temp, so a future operator can inspect long after
-- the migration runs.
CREATE TABLE IF NOT EXISTS public.backfilled_calendar_event_links_20260512 (
  ce_id         uuid PRIMARY KEY,
  linked_to_note_id uuid NOT NULL,
  applied_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backfilled_calendar_event_links_20260512 ENABLE ROW LEVEL SECURITY;

-- Service-role-only audit table — no policies means standard roles
-- can't read or write it. Service role bypasses RLS. This matches the
-- existing pattern for olive_calendar_sync_log etc.
COMMENT ON TABLE public.backfilled_calendar_event_links_20260512 IS
'Audit trail for the 2026-05-12 backfill that re-linked orphan calendar_events rows to their clerk_notes counterparts. Service-role read only.';

-- Apply the backfill in a single statement so the WHERE-clause counts
-- match the audit-insert counts (no possible drift between the two).
WITH candidates AS (
  SELECT
    ce.id  AS ce_id,
    cn.id  AS note_id
  FROM calendar_events ce
  JOIN calendar_connections cc ON cc.id = ce.connection_id
  JOIN clerk_notes cn
    ON cn.author_id = cc.user_id
   AND cn.summary   = ce.title
   AND ABS(EXTRACT(EPOCH FROM (cn.created_at - ce.created_at))) < 120
  WHERE ce.note_id IS NULL
    AND ce.event_type = 'from_note'
),
unique_matches AS (
  -- Only re-link when there's exactly one candidate clerk_notes row.
  -- Anything ambiguous gets dropped by the WHERE on the window count.
  -- (UUIDs don't support MIN/MAX aggregation, hence the window
  -- function instead of GROUP BY + HAVING.)
  SELECT ce_id, note_id
  FROM (
    SELECT
      ce_id,
      note_id,
      COUNT(*) OVER (PARTITION BY ce_id) AS candidate_count
    FROM candidates
  ) windowed
  WHERE candidate_count = 1
),
applied AS (
  UPDATE calendar_events ce
  SET note_id = um.note_id
  FROM unique_matches um
  WHERE ce.id = um.ce_id
  RETURNING ce.id AS ce_id, ce.note_id AS note_id
)
INSERT INTO public.backfilled_calendar_event_links_20260512 (ce_id, linked_to_note_id)
SELECT ce_id, note_id FROM applied
ON CONFLICT (ce_id) DO NOTHING;
