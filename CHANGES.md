# CHANGES — Phase 1: Foundation of Robustness & Observability

This log tracks structural changes made while delivering Phase 1 of the
engineering hardening plan. Each task is additive and backwards-compatible;
there are no behavioral rollbacks.

- **Scope:** memory quality, context assembly, model routing, thread
  instrumentation, destructive-action safety.
- **Non-goals:** visible product changes, UI work, new user-facing features.
- **Deployment shape:** one migration + edge-function updates. The migration
  is idempotent (`IF NOT EXISTS` + `DO` blocks) and safe to re-run.

---

## 2026-04-16 — Phase 1

### Task 1-A · Formal Context Contract (context-contract.ts)

**Intent.** Stop scattering ad-hoc prompt assembly across edge functions.
Replace with a single named-slot contract so every LLM call has predictable
token usage, deterministic truncation, and an explicit degradation order.

**Slots (priority → maxTokens).**

| Slot          | Priority | Max tokens | Required |
| ------------- | :------: | :--------: | :------: |
| IDENTITY      |    1     |    200     |   yes    |
| QUERY         |    1     |    400     |   yes    |
| USER_COMPILED |    2     |    650     |    no    |
| INTENT_MODULE |    2     |    250     |    no    |
| TOOLS         |    2     |    300     |    no    |
| DYNAMIC       |    3     |    800     |    no    |
| HISTORY       |    4     |    600     |    no    |

- `STANDARD_BUDGET = 3200` (sum), `EMERGENCY_BUDGET = 2050` (DYNAMIC dropped).
- Truncation prefers sentence/newline boundaries; falls back to a hard cut
  plus an explicit `...(truncated)` marker for downstream visibility.
- Drop order: lowest priority first (HISTORY → DYNAMIC → TOOLS →
  INTENT_MODULE → USER_COMPILED). Required slots are never dropped.

**Robustness polish.**

- `AssemblyResult` gained two fields:
  - `missingRequired: string[]` — required slots whose content was empty at
    assembly time. Does not throw; callers log and degrade.
  - `degraded: boolean` — any non-required slot was dropped. Broader than
    `emergency`, which still means specifically "DYNAMIC was dropped".
- Empty-required detection warns to console so it shows up in edge-function
  logs without crashing a user-facing response.

**Files.**

- `supabase/functions/_shared/context-contract.ts` (modified)
- `supabase/functions/_shared/context-contract.test.ts` (new — 12 tests)

### Task 1-B · Slot-level token logging (llm-tracker.ts)

**Intent.** Make context-assembly analytics observable per-call, including
on the streaming path that bypasses the normal tracker.

**Additions.**

- Extended the `LLMTracker` row schema to include `slotTokens`,
  `contextTotalTokens`, `slotsOverBudget`, and arbitrary
  `metadata` (carrying `dropped_slots`, `missing_required`, `degraded`,
  `emergency`, classifier intent/confidence, route tier/reason).
- Added `logStreamingCall(model, promptCharLength, latencyToFirstByteMs, opts)`
  to log context analytics for streaming responses where the token-by-token
  body goes to the client directly (no buffered response to post-process).
  Fires a `status: "stream_started"` row to `olive_llm_calls`.
- Wired `ask-olive-stream` to emit a `logStreamingCall` after kicking off
  the Gemini stream. Slot telemetry now reaches the same analytics surface
  the non-streaming callers already use.

**Files.**

- `supabase/functions/_shared/llm-tracker.ts` (modified)
- `supabase/functions/ask-olive-stream/index.ts` (modified — CHAT path)

### Task 1-C · Contradiction resolution strategy

**Intent.** Resolve the "AI keeps flip-flopping memory" class of bugs by
making resolution deterministic for safe cases and explicit-ask for
ambiguous ones.

**Decision tree (olive-memory-maintenance).**

```
if contradiction_type ∈ {factual, temporal} AND confidence ≥ 0.80:
    → AUTO_RECENCY: newer chunk wins, older chunk deactivated,
                    winning_chunk_id set, resolved_at = now().
elif confidence ≥ 0.50:
    → ASK_USER: insert olive_heartbeat_jobs row (job_type=contradiction_resolve).
                Contradiction row stays 'unresolved' until user answers.
else:
    → low-confidence 'unresolved', no action.
```

**Schema additions (olive_memory_contradictions).**

- `resolution_strategy TEXT CHECK IN ('AUTO_RECENCY', 'AUTO_FREQUENCY',
  'ASK_USER', 'MANUAL', 'AI_SUGGESTED')`
- `winning_chunk_id UUID REFERENCES olive_memory_chunks ON DELETE SET NULL`
- `resolution_notes TEXT`
- Partial index `idx_contradictions_ask_user_pending (user_id,
  created_at DESC) WHERE resolution_strategy = 'ASK_USER' AND resolution =
  'unresolved'` — fast queue scans for the heartbeat worker.
- Partial index `idx_contradictions_winning_chunk (winning_chunk_id) WHERE
  winning_chunk_id IS NOT NULL` — provenance lookups.

**Files.**

- `supabase/migrations/20260416000000_phase1_memory_quality_instrumentation.sql` (new)
- `supabase/functions/olive-memory-maintenance/index.ts` (modified —
  `runContradictionDetection` rewrite; return shape now
  `{ detected, auto_resolved, ask_user_queued }`)

### Task 1-D · WhatsApp thread instrumentation

**Intent.** Track message volume per thread so Phase 2 can trigger
LLM-based compaction deterministically instead of guessing at history.

**Schema additions (olive_gateway_sessions).**

- `message_count INTEGER NOT NULL DEFAULT 0` — inbound count in current
  thread; reset to 0 after compaction.
- `compact_summary TEXT` — LLM summary of pre-compaction turns.
- `last_compacted_at TIMESTAMPTZ` — audit trail.
- `total_messages_ever INTEGER NOT NULL DEFAULT 0` — lifetime counter,
  never reset (user-level analytics input).
- Partial index `idx_gateway_sessions_compact_ready (user_id,
  message_count) WHERE is_active = true AND message_count > 0`.

**Atomic counter RPC.**

```sql
increment_gateway_session_message(p_session_id UUID) RETURNS TABLE(
  message_count INTEGER, total_messages_ever INTEGER
)
```

Avoids read-modify-write races when a single user sends several messages
in flight. Called from a fire-and-forget `touchGatewaySession` helper at
the WhatsApp webhook entry point so tracking never blocks message
processing.

**Files.**

- `supabase/migrations/20260416000000_phase1_memory_quality_instrumentation.sql` (new)
- `supabase/functions/whatsapp-webhook/index.ts` (modified —
  `touchGatewaySession` helper + call site)

### Task 1-E · Per-intent confidence floors

**Intent.** Never silently execute destructive DB actions on low classifier
confidence. Route through a clarification turn instead.

**Calibration (model-router.ts).**

```ts
INTENT_CONFIDENCE_FLOORS = {
  delete:       0.95,  // destructive, hardest to undo
  complete:     0.92,  // reversible but annoying
  set_due:      0.90,  // wrong date breaks reminders
  archive:      0.90,
  move:         0.90,  // wrong list ≈ lost item
  assign:       0.90,  // awkward cross-user
  set_priority: 0.85,  // easy to fix
}
```

Intents not in the map return `passes: true, reason: "no_floor:<intent>"`.

**Call sites.**

- `supabase/functions/ask-olive-stream/index.ts` — ACTION path checks
  the floor before `handleAction`; on failure, routes to a Flash-Lite
  clarification stream naming the target entity.
- `supabase/functions/whatsapp-webhook/index.ts` — after
  `mapAIResultToIntentResult`, below-floor intents are rerouted to
  `CHAT/assistant` with context fields (`_belowFloorIntent`,
  `_belowFloorTarget`, `_belowFloorConfidence`, `_belowFloorRequired`)
  so the assistant can ask a precise clarifying question.

**Files.**

- `supabase/functions/_shared/model-router.ts` (modified)
- `supabase/functions/_shared/model-router.test.ts` (new — 14 tests)
- `supabase/functions/ask-olive-stream/index.ts` (modified)
- `supabase/functions/whatsapp-webhook/index.ts` (modified)

---

## Testing

Co-located Deno unit tests, runnable individually:

```bash
deno test supabase/functions/_shared/context-contract.test.ts
deno test supabase/functions/_shared/model-router.test.ts
```

Coverage highlights:

- **Context contract:** slot ordering, sentence-boundary truncation,
  priority-based drops (HISTORY before DYNAMIC, required never dropped),
  `emergency`/`degraded`/`missingRequired` correctness, custom contracts.
- **Model router:** floor boundaries (below/at/above) for every gated
  intent, ungated intents pass-through, unknown intents, floor-map
  integrity (`delete` is strictest, all values in (0, 1]), tier routing
  for media/chat/expense cases.

Production runtime is Deno; these tests run against the same imports
used in edge functions.

---

## Deployment checklist

1. Apply the migration: `supabase db push`
   (`20260416000000_phase1_memory_quality_instrumentation.sql`) — idempotent.
2. Deploy edge functions (order does not matter, but bundle together):
   - `ask-olive-stream`
   - `whatsapp-webhook`
   - `olive-memory-maintenance`
   - Shared modules redeploy automatically with each dependent function.
3. Spot-check analytics:
   - `olive_llm_calls` should start showing `slot_tokens`,
     `context_total_tokens`, and `metadata.dropped_slots` for streaming
     calls from `ask-olive-stream`.
   - `olive_memory_contradictions` should show
     `resolution_strategy IN ('AUTO_RECENCY','ASK_USER')` after the next
     Sunday maintenance run.
   - `olive_gateway_sessions.message_count` should increment on WhatsApp
     inbound messages.
4. No config changes, no secrets rotation required.

---

## Invariants preserved

- Required slots (IDENTITY, QUERY) are never dropped, even under
  EMERGENCY_BUDGET. Empty content is surfaced via `missingRequired` and
  logged; the call proceeds on best effort.
- Destructive DB actions are gated on confidence ≥ floor at every entry
  point (web stream, WhatsApp). Below-floor requests are converted to
  clarification prompts — no silent execution.
- Contradiction resolution is deterministic for safe cases and explicit
  (ASK_USER + heartbeat job) for ambiguous cases. The AI no longer
  decides resolution strategy autonomously.
- Atomic counters via RPC. No TOCTOU race on `message_count` bumps.
- Schema changes are additive; all existing rows remain valid (defaults
  backfill the new columns).

---

## 2026-04-16 — Phase 2 (Closing Phase 1 Loops)

Phase 1 created the contradiction detection pipeline and gateway-session
instrumentation, but two loops were left open: ASK_USER contradictions
had no consumer, and long threads had no summarization. Phase 2 closes
both loops end-to-end.

### Task 2-A · Contradiction Resolution Worker (ASK_USER → WhatsApp → apply)

**Intent.** Close the loop from Phase 1 Task 1-C: when the memory
contradiction detector marks a conflict as `resolution_strategy='ASK_USER'`
and enqueues a `contradiction_resolve` heartbeat job, actually deliver the
question to the user via WhatsApp, capture their reply, resolve the
contradiction, and confirm the outcome.

**Flow.**

```
[heartbeat tick]
  └─ handleContradictionResolveJob()
       ├─ formatContradictionQuestion()  ← pure, type-specific intros
       ├─ INSERT olive_pending_questions ← so webhook knows we're waiting
       └─ INSERT olive_outbound_queue    ← WhatsApp delivery

[user replies on WhatsApp]
  └─ whatsapp-webhook (early-path check)
       ├─ findActivePendingQuestion()
       ├─ tryResolvePendingQuestion()
       │    ├─ shortcutResolve()         ← instant for "A"/"B"/"option a"
       │    └─ parseUserResolution()     ← Flash-Lite JSON classification
       └─ applyResolution()              ← deactivate loser, update winner
```

**Key design decisions.**

- **Shortcut resolver**: bare "A"/"B"/"option a"/"option b" replies skip
  the LLM entirely — instant resolution, no API cost.
- **3-layer JSON parse**: direct → fenced ```json → embedded `{...}` —
  handles all Gemini output quirks.
- **Fail-open**: if the LLM can't classify the reply, the pending
  question stays active and the message falls through to normal intent
  classification. No silent auto-resolve.
- **Idempotent**: `applyResolution` checks `resolved_at` before any mutation.
  Safe to retry on transient errors.
- **Send-failure rollback**: if `sendWhatsAppMessage` fails, the pending
  question is cancelled (not left dangling) so the next heartbeat tick
  can retry cleanly with a fresh row.
- **Deduplicate pending questions**: if a pending row already exists for
  (user, question_type, reference_id) with status='pending', reuse it.

**New table: `olive_pending_questions`.**

| Column         | Type        | Note                                    |
| -------------- | ----------- | --------------------------------------- |
| id             | UUID PK     | gen_random_uuid()                       |
| user_id        | TEXT        |                                         |
| question_type  | TEXT        | CHECK: 'contradiction_resolve'          |
| reference_id   | UUID        | Soft FK (points to contradictions table) |
| channel        | TEXT        | 'whatsapp' / 'web'                     |
| question_text  | TEXT        |                                         |
| payload        | JSONB       | Both chunks for resolver context        |
| asked_at       | TIMESTAMPTZ | default now()                           |
| expires_at     | TIMESTAMPTZ | default now() + 24h (WhatsApp window)   |
| answered_at    | TIMESTAMPTZ |                                         |
| answer_text    | TEXT        |                                         |
| resolution     | JSONB       | { winner, merge_text?, reasoning? }     |
| status         | TEXT        | pending / answered / expired / cancelled |

Partial indexes: active-user lookup, expiry sweep.

### Task 2-B · Thread Compaction Worker (cursor-based summarization)

**Intent.** Prevent long WhatsApp threads from degrading LLM quality.
After 15 messages, older turns are rolled into a compact summary via
Gemini Flash-Lite and injected into the HISTORY slot of the Context
Contract. Recent 6 turns stay verbatim.

**Flow.**

```
[heartbeat tick]
  └─ compactActiveThreads()
       ├─ scan olive_gateway_sessions where message_count >= 15
       └─ per session:
            ├─ shouldCompact()                  ← gate check
            ├─ selectMessagesToCompact()         ← cursor + keep-recent
            ├─ generateCombinedSummary()         ← Flash-Lite
            └─ apply_gateway_session_compaction() ← atomic RPC

[webhook assembles prompt]
  └─ Fetch compact_summary from olive_gateway_sessions
     └─ Inject "Earlier in this thread (compacted summary):" before
        recent conversation history in baseContext template
```

**Key design decisions.**

- **Cursor-based, not destructive**: compactor NEVER mutates
  `user_sessions.context_data.conversation_history`. The webhook keeps its
  own FIFO trim. Race with webhook just means the next tick picks up new
  turns.
- **Append-only summary**: each run folds `prior_summary + new_turns`
  into a combined summary. When combined length exceeds 75% of
  `maxSummaryChars` (2000), the model is asked to re-condense.
- **Atomic commit via RPC**: `apply_gateway_session_compaction()` writes
  summary + cursor + decrements `message_count` in a single UPDATE.
  Messages that race compaction stay on the counter.
- **Fail-safe**: summarizer failure leaves cursor + summary untouched;
  the next tick retries. Non-blocking in heartbeat (wrapped in try/catch).
- **Dep-injected LLM caller**: `GeminiCaller` type allows full test
  coverage without real API calls.

**New RPC: `apply_gateway_session_compaction(p_session_id, p_compact_summary, p_cursor_ts, p_compacted_count)`.**

Atomic UPDATE of `compact_summary`, `last_compacted_at`, and
`message_count = GREATEST(0, message_count - p_compacted_count)`.

### Files

**New files (Phase 2):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/migrations/20260416000001_phase2_pending_questions_and_compaction.sql` | 130 | `olive_pending_questions` table + `apply_gateway_session_compaction` RPC |
| `supabase/functions/_shared/contradiction-resolver.ts` | 624 | Pure core + DB orchestrator for ASK_USER resolution |
| `supabase/functions/_shared/thread-compactor.ts` | 454 | Pure core + DB orchestrator for cursor-based compaction |
| `supabase/functions/_shared/contradiction-resolver.test.ts` | 718 | 40 tests: pure functions, JSON parsing, shortcut resolver, orchestrator |
| `supabase/functions/_shared/thread-compactor.test.ts` | 454 | 27 tests: gates, cursor logic, prompt building, orchestrator |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/olive-heartbeat/index.ts` | Added `contradiction_resolve` job case (lines ~1012–1079) + `compactActiveThreads()` call in tick handler + compaction result in response |
| `supabase/functions/whatsapp-webhook/index.ts` | Added early-path pending-question check before classifier (line ~2723) + `compact_summary` fetch & injection into HISTORY block (line ~5550) |

### Testing

67 tests total across two test files, exercising:

- **Contradiction resolver (40 tests):** type-specific question intros,
  prompt shape, JSON parsing (3 fallback strategies), shortcut detection
  for bare A/B replies, chronology→resolution mapping, LLM integration
  with mocked caller, confirmation formatting for all 4 winner branches
  (a/b/merge/neither), idempotency on already-resolved contradictions,
  chunk deactivation per winner, malformed payload handling.

- **Thread compactor (27 tests):** `shouldCompact` gate conditions,
  `selectMessagesToCompact` cursor×keep-recent matrix (first compaction,
  incremental, all filtered), `renderTurns` truncation at 800 chars,
  `buildSummarizationPrompt` with/without recondense hint,
  `formatHistoryWithSummary` all summary×turns combinations,
  `generateCombinedSummary` dep injection + hard clamp + too-short
  rejection, `performCompaction` full orchestrator with chainable mock
  supabase.

All tests use dependency injection for `GeminiCaller` and chainable mock
supabase — no real API keys or network required.

### Deployment checklist

1. **Apply migration** (idempotent, safe to re-run):
   ```
   supabase db push
   ```
   Or apply `20260416000001_phase2_pending_questions_and_compaction.sql`
   manually. Creates `olive_pending_questions` + RPC. No existing data
   affected.

2. **Deploy edge functions** (order doesn't matter — both are
   backwards-compatible):
   ```
   supabase functions deploy olive-heartbeat
   supabase functions deploy whatsapp-webhook
   ```

3. **Verify** after deploy:
   - `olive_pending_questions` table should exist with RLS policies.
   - `apply_gateway_session_compaction` function should be callable.
   - Heartbeat tick response should include `compaction: {...}` field.
   - After 15+ messages in a WhatsApp thread, `olive_gateway_sessions`
     should show a non-null `compact_summary` and `last_compacted_at`.
   - Triggering an ASK_USER contradiction should deliver a WhatsApp
     question; replying "A" or "B" should resolve it instantly.

4. No config changes, no secrets rotation required. Uses the existing
   `GEMINI_KEY` for Flash-Lite summarization and resolution.

---

## Invariants preserved (cumulative Phase 1 + 2)

- Required slots (IDENTITY, QUERY) are never dropped, even under
  EMERGENCY_BUDGET. Empty content is surfaced via `missingRequired` and
  logged; the call proceeds on best effort.
- Destructive DB actions are gated on confidence >= floor at every entry
  point (web stream, WhatsApp). Below-floor requests are converted to
  clarification prompts — no silent execution.
- Contradiction resolution is deterministic for safe cases and explicit
  (ASK_USER + heartbeat job) for ambiguous cases. The AI no longer
  decides resolution strategy autonomously.
- **Phase 2:** ASK_USER contradictions are now fully resolved via
  WhatsApp round-trip. Fail-open: unclassifiable replies fall through
  to normal processing. Idempotent: safe to retry.
- Atomic counters via RPC. No TOCTOU race on `message_count` bumps.
  Compaction counter decrement is also atomic (single UPDATE).
- **Phase 2:** Thread compaction is cursor-based and never destructive.
  The compactor never mutates `conversation_history`; only the webhook
  manages FIFO trimming. Race conditions are harmless by design.
- Schema changes are additive; all existing rows remain valid (defaults
  backfill the new columns).
