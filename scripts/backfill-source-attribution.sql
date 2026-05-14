-- ============================================================================
-- Source Attribution Backfill — historical clerk_notes rows
-- ============================================================================
-- Goal: attribute as many of the historical NULL-source rows as possible
-- using conservative heuristics. Anything ambiguous stays NULL.
--
-- Run order matters: more-specific heuristics first.
-- Run each block separately and report counts before/after.
--
-- Apply via Supabase MCP `execute_sql` (or paste into the dashboard SQL
-- editor — this file is NOT a schema migration). After running, the
-- distribution should improve from ~97% NULL to a mostly-attributed state.

-- ─── BEFORE snapshot ────────────────────────────────────────────────
SELECT
  COALESCE(source, '(null)') AS source,
  COUNT(*) AS rows
FROM clerk_notes
GROUP BY source
ORDER BY rows DESC;

-- ─── Block 1: correct the partner_relay:* rows that were mistagged ──
-- These rows have source='whatsapp' and source_ref='partner_relay:*'
-- but they're internal relay events, not real captures.
UPDATE clerk_notes
SET source = 'partner-relay'
WHERE source = 'whatsapp'
  AND source_ref LIKE 'partner_relay:%';

-- ─── Block 2: tight ±60s correlation with a whatsapp-webhook LLM call ─
-- A NULL-source note whose author had a whatsapp-* LLM call within ±60s
-- is almost certainly a WhatsApp-origin capture.
UPDATE clerk_notes n
SET source = 'whatsapp'
WHERE n.source IS NULL
  AND EXISTS (
    SELECT 1 FROM olive_llm_calls c
    WHERE c.function_name LIKE 'whatsapp%'
      AND c.user_id = n.author_id
      AND c.created_at BETWEEN n.created_at - INTERVAL '60 seconds'
                          AND n.created_at + INTERVAL '60 seconds'
  );

-- ─── Block 3: same-day correlation (weaker signal) ──────────────────
-- Same user, same calendar day, ≥1 whatsapp-webhook call. Weaker but
-- still high-precision in practice given how rare same-day cross-
-- channel use is for the current user base.
UPDATE clerk_notes n
SET source = 'whatsapp'
WHERE n.source IS NULL
  AND EXISTS (
    SELECT 1 FROM olive_llm_calls c
    WHERE c.function_name LIKE 'whatsapp%'
      AND c.user_id = n.author_id
      AND DATE(c.created_at) = DATE(n.created_at)
  );

-- ─── Block 4 (NOT applied): leave-as-NULL is the correct "unknown" ──
-- Any rows still NULL after blocks 1–3 are intentionally left NULL.
-- We do NOT set a sentinel like 'unknown' because that pollutes the
-- per-source analytics. NULL is the correct "we don't know" value.
-- The NOT NULL constraint (in the companion migration) is only applied
-- if the residual NULL count is ≤5% of total rows.

-- ─── AFTER snapshot ─────────────────────────────────────────────────
SELECT
  COALESCE(source, '(null)') AS source,
  COUNT(*) AS rows
FROM clerk_notes
GROUP BY source
ORDER BY rows DESC;
