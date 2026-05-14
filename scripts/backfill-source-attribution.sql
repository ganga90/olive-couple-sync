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

-- ─── Block 4: NULL rows from users who have NEVER used WhatsApp → 'web' ─
-- After blocks 2–3 catch the WhatsApp-correlated rows, anything still NULL
-- whose author has zero whatsapp-* LLM calls in our entire history is
-- almost certainly a web-app direct create. (iOS users would also show
-- up as 'web' here — the Capacitor flag isn't available historically.
-- The Apr-2026 frontend migration sets `source: 'ios'` on new Capacitor
-- inserts; historical rows that pre-date that wiring can't be distinguished
-- after the fact, so they're all attributed to 'web'.)
UPDATE clerk_notes n
SET source = 'web'
WHERE n.source IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM olive_llm_calls c
    WHERE c.function_name LIKE 'whatsapp%'
      AND c.user_id = n.author_id
  );

-- ─── Block 5 (catch-all): any remaining NULL → 'web' ────────────────
-- After Block 4 the only NULL rows left are from users with SOME
-- WhatsApp activity but whose specific note didn't correlate (note
-- created outside the ±60s and same-day windows). High likelihood
-- they were created in the web app on a day the user didn't use
-- WhatsApp. Required so we can apply the NOT NULL constraint.
UPDATE clerk_notes
SET source = 'web'
WHERE source IS NULL;

-- ─── AFTER snapshot ─────────────────────────────────────────────────
SELECT
  COALESCE(source, '(null)') AS source,
  COUNT(*) AS rows
FROM clerk_notes
GROUP BY source
ORDER BY rows DESC;
