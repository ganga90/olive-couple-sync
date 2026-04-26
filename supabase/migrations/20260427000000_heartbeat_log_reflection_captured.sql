-- Soul Phase C-1.c — flag column for ignored-reflection scan
-- ============================================================
-- The heartbeat now scans olive_heartbeat_log for proactive outbounds
-- that the user never reacted to (no follow-up activity after 48h) and
-- writes an `ignored` reflection. To avoid re-scanning the same row on
-- every 15-min tick, we mark each row with `reflection_captured = true`
-- once decided. The decision is irreversible per row — soul evolution
-- works off many data points, so a single misclassification doesn't
-- matter, but double-counting would skew the score.
--
-- The partial index narrows the heartbeat scan to JUST the rows that
-- need a decision. Keeps the per-tick work bounded as the table grows.

ALTER TABLE olive_heartbeat_log
  ADD COLUMN IF NOT EXISTS reflection_captured BOOLEAN NOT NULL DEFAULT false;

-- Partial index: only the rows the heartbeat needs to scan. Excludes
-- already-decided rows, drastically narrowing the working set.
CREATE INDEX IF NOT EXISTS idx_heartbeat_log_pending_reflection
  ON olive_heartbeat_log (created_at)
  WHERE status = 'sent' AND reflection_captured = false;

COMMENT ON COLUMN olive_heartbeat_log.reflection_captured IS
  'Phase C-1.c: true once the heartbeat has decided whether this outbound '
  'was ignored. Prevents re-scanning. The reflection itself (if any) is in '
  'olive_reflections; this flag is dedup-only.';
