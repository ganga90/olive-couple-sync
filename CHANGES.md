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

## 2026-04-16 — Phase 3 (Memory Pipeline Repair)

Phase 2 audit of the production database revealed a critical gap: the
entire memory retrieval pipeline was non-functional. Memory chunks were
extracted from conversations (48 active chunks) but never reached the
LLM prompt because:

1. **`search_memory_chunks` RPC did not exist** — the orchestrator called
   it on every request but the circuit breaker silently caught the error.
2. **`hybrid_search_notes` RPC did not exist** — same failure mode.
3. **0 of 48 memory chunks had embeddings** — even with the RPC, semantic
   search would have returned nothing.
4. **0 of 615 clerk_notes had embeddings** — hybrid search was equally dead.
5. **No importance-only fallback** — when no query embedding was available
   (proactive messages, short inputs), the DYNAMIC slot stayed empty.

### Task 3-A · Missing RPCs + Importance-Only Fallback (migration)

Created 5 new RPCs and 3 indexes:

| RPC | Purpose |
| --- | ------- |
| `search_memory_chunks(user, embedding, limit, min_importance)` | Semantic vector search on `olive_memory_chunks` |
| `hybrid_search_notes(user, couple, query, embedding, weight, limit)` | Combined vector + full-text search on `clerk_notes` |
| `fetch_top_memory_chunks(user, limit, min_importance)` | **Importance-only** — no embedding required |
| `get_chunks_needing_embeddings(limit)` | Backfill queue for memory chunks |
| `get_notes_needing_embeddings(limit)` | Backfill queue for clerk_notes |

All RPCs use `SET search_path TO 'public', 'extensions'` to resolve
the pgvector `<=>` operator correctly.

`fetch_top_memory_chunks` is the key innovation: it guarantees memories
always reach the prompt by ranking on `importance * decay_factor` without
requiring an embedding vector.

### Task 3-B · Unified Memory Retrieval Module (`memory-retrieval.ts`)

**Strategy: semantic search + importance-only fallback, merged.**

```
fetchMemoryChunks(db, userId, queryEmbedding?, userMessage?)
  ├─ if embedding available → try searchMemoryChunks (semantic)
  ├─ ALWAYS → fetchTopMemoryChunks (importance-only baseline)
  └─ merge: semantic first (relevance-ranked), importance fills gaps
     → deduplicate by ID → cap at maxTotal → format for prompt
```

Pure functions: `shouldAttemptSemanticSearch`, `mergeMemoryResults`,
`formatMemoryChunksForPrompt`. DB interface via `MemoryDB` abstraction
for testability.

**Key guarantees:**
- If active memory chunks exist, at least some will appear in the prompt.
- Semantic search failure degrades gracefully to importance-only.
- Both failures degrade to empty string — no thrown errors escape.
- Strategy telemetry (`semantic` / `importance_only` / `merged` / `empty`)
  logged for observability.

### Task 3-C · Orchestrator Wiring

Replaced the broken `search_memory_chunks`-only path in Layer 4 of
`assembleFullContext()` with the unified `fetchMemoryChunks()` call.
The old code silently failed on every request; the new code:
- Always attempts importance-only retrieval as baseline
- Augments with semantic search when embedding is available
- Logs strategy + counts for observability
- Preserves the relationship graph section (moved to own `if (userMessage)` guard)

### Task 3-D · Embedding Backfill via Heartbeat

Added incremental embedding repair to the heartbeat tick:
- 10 memory chunks + 10 clerk_notes per tick (every 15 min)
- Uses Gemini `gemini-embedding-001` at 768 dimensions
- Non-blocking: wrapped in try/catch, failures don't affect other tick work
- Result included in tick response JSON for observability

At current rates (10+10 per 15min tick), the 48 chunks will be fully
backfilled within 1 hour, and the 615 notes within ~10 hours. Once
backfilled, semantic search becomes fully functional alongside the
importance-only baseline.

### Files

**New files (Phase 3):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/migrations/20260416000002_phase3_memory_pipeline_repair.sql` | 245 | 5 RPCs + 3 indexes |
| `supabase/functions/_shared/memory-retrieval.ts` | ~320 | Unified retrieval module with semantic + importance fallback |
| `supabase/functions/_shared/memory-retrieval.test.ts` | ~400 | 39 tests: gates, merge, format, orchestrator, backfill |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/_shared/orchestrator.ts` | Replaced broken Layer 4 memory search with unified `fetchMemoryChunks()` + added `memoryRetrievalStrategy` to `UnifiedContext` |
| `supabase/functions/olive-heartbeat/index.ts` | Added embedding backfill step (10 chunks + 10 notes per tick) |

### Testing

39 tests in `memory-retrieval.test.ts`:

- **shouldAttemptSemanticSearch** (7 tests): null/empty embedding, null/short/whitespace message
- **mergeMemoryResults** (6 tests): semantic priority, dedup, maxTotal, empty inputs
- **formatMemoryChunksForPrompt** (5 tests): empty, header, importance display, source, multi-chunk
- **fetchMemoryChunks orchestrator** (8 tests): merged strategy, importance-only, semantic error fallback, both fail, pure semantic, empty DB, maxTotal, param forwarding
- **backfillChunkEmbeddings** (5 tests): success, embedding failure, DB update failure, empty queue, RPC error
- **backfillNoteEmbeddings** (3 tests): success, empty, mixed success/failure
- **Integration scenarios** (5 tests): full pipeline with no embedding, with embedding, broken semantic search

### Deployment checklist

1. **Migration already applied** to production (`phase3_memory_pipeline_repair_v2`).
   All 5 RPCs verified present. `fetch_top_memory_chunks` tested with real
   data — returns correct results.

2. **Deploy edge functions:**
   ```
   supabase functions deploy olive-heartbeat
   supabase functions deploy whatsapp-webhook
   ```

3. **Verify** after deploy:
   - Heartbeat tick response includes `embedding_backfill: {...}`.
   - After ~1 hour, `olive_memory_chunks` should have non-null embeddings.
   - WhatsApp messages show `[Orchestrator] Memory retrieval: strategy=...`
     in edge function logs.
   - Even without embeddings, importance-only fallback populates the
     DYNAMIC slot with learned facts immediately.

4. No config changes, no secrets rotation required.

---

## 2026-04-17 — Phase 4 (Compiled Intelligence)

Phases 1–3 built the *instruments* (context contract, model routing,
slot telemetry, contradiction detector, thread compactor, memory
retrieval fallback). Phase 4 turns on the *intelligence*: pre-compiled
user artifacts replace ad-hoc memory reads, prompts split per intent,
search gains a knowledge-graph pre-pass, and the artifact layer
recompiles reactively when facts change.

Alignment with the engineering plan:

| Task              | Plan §             | Status |
| ----------------- | ------------------ | ------ |
| 4-A / Task 2-A    | Compiled artifacts | ✅ w/ source-citation validator |
| 4-B / Task 2-B    | Wire into SLOT_USER | ✅ with `userSlotSource` telemetry |
| 4-C / Task 2-D    | Per-intent modules  | ✅ 7 modules + registry |
| 4-D / Task 2-E    | Entity pre-pass     | ✅ olive-search opt-in |
| 4-E (plan add-on) | Event-driven recompile | ✅ DB trigger + heartbeat handler |

### Task 4-A · Compiled Memory Artifacts + Grounding Validator

**Intent.** Make the compiled-artifact layer both budgeted and
verifiable. Before Phase 4, `olive-compile-memory` produced markdown
blindly — if Gemini fabricated a name or date, it quietly flowed into
the USER_COMPILED slot on every call.

- **`_shared/compiled-artifacts.ts`** (~350 lines) — Pure core:
  - `validateCompiledAgainstSources(compiledText, sourceChunks)` —
    keyword-overlap grounding heuristic. Scores 0..1 based on how many
    compiled sentences have ≥2 unique content-word matches against
    any source chunk. Zero LLM cost. Not a perfect hallucination
    detector, but catches obvious fabrications (invented names,
    dates, locations) with no source backing.
  - `ARTIFACT_BUDGETS`: profile=400, patterns=150, relationship=100,
    household=150 tokens. `COMPILED_USER_BUDGET = 650` (fits SLOT_USER).
  - `truncateArtifact()` — sentence/newline boundary truncation.
  - `assembleCompiledSlot(artifacts)` — ordered, header-labeled
    USER_COMPILED block with per-artifact status (used/stale/missing).
  - `assembleUserSlot(db, userId)` — full orchestrator with injected
    `ArtifactDB`. Never throws — DB errors degrade to empty.

- **`olive-compile-memory/index.ts`** (modified) — After each Gemini
  generation:
  1. Truncate to `ARTIFACT_BUDGETS[fileType]` at sentence boundary.
  2. Build `ValidationSource[]` from notes + memories + entities.
  3. Run `validateCompiledAgainstSources()` → log `LOW GROUNDING`
     warning if score < 0.5, always persist score.
  4. Store `source_chunk_ids` (mix of `note:<id>` / `memory:<id>` /
     `entity:<name>` tokens), `validation_score`, `validation_notes`,
     `validation_ungrounded_count`, `budget_tokens`, `was_truncated`
     into `olive_memory_files.metadata`.

  **Invariant: validation never blocks.** A low score is surfaced in
  metadata for downstream reviewers (wiki-lint, "Why this answer?"
  UI, admin dashboards) — it does NOT reject the artifact. This
  matches Phase 1-C's treatment of memory contradictions: detect
  explicitly, resolve deliberately, never silently.

- **`_shared/compiled-artifacts.test.ts`** — **24 tests** covering:
  token estimation, boundary-aware truncation (under-budget / over-
  budget / no-boundaries), keyword tokenizer (stopword/short-word
  filters, punctuation stripping), sentence splitter, validator
  (empty / no-sources / fully grounded / partial / fully ungrounded),
  `assembleCompiledSlot` staleness handling + budget enforcement +
  missing-type tolerance, `assembleUserSlot` empty-userId safety +
  DB-error degradation + happy path.

### Task 4-B · Unified USER_COMPILED Slot Assembly

**Intent.** The orchestrator used to fetch `olive_memory_files` as a
loose list and build the "COMPILED KNOWLEDGE" block inline with per-
file-type character caps that didn't match the Context Contract's
token budget. Phase 4-B routes it through the new compiled-artifacts
module for consistency + telemetry.

- **`_shared/orchestrator.ts`** (modified):
  - Imports `assembleUserSlot` + `createSupabaseArtifactDB`.
  - Layer-4 deep-profile fetch now calls `assembleUserSlot(db, userId)`
    instead of an inline `.select()`.
  - New fields on `UnifiedContext`:
    - `userSlotSource`: `"compiled" | "dynamic" | "mixed" | "empty"`
    - `userSlotFresh`: boolean (all artifacts ≤24h)
    - `userSlotArtifacts`: per-artifact status for analytics
  - Legacy `deepProfile` still exposed as a pre-formatted string, now
    sourced from the budget-enforced `assembleUserSlot` output.

- **Side effect (cleanup).** Renamed the pre-existing duplicate
  declaration `assembleFullContext` (the SOUL-aware variant at
  line ~1437) to `assembleSoulAwareContext`. The conflict was already
  breaking `deno check` on `main` (confirmed via `git stash`); fixing
  it was necessary to verify Phase 4 compiled. That function has no
  external callers, so the rename is zero-risk at runtime.

### Task 4-C · Per-Intent Prompt Modules

**Intent.** The monolithic `OLIVE_CHAT_PROMPT` in
`ask-olive-prompts.ts` (~1,000 tokens) tries to cover every intent in
one blob. Most of it is irrelevant to any given call. Per-intent
modules split the prompt into a shared `system_core` (~200 tokens —
persona only) and swappable `intent_rules` (~150-250 tokens —
intent-specific behavior). Smaller context, better focus, and (Phase
6 setup) a stable prefix for prompt caching.

- **`_shared/prompts/intents/`** directory:
  - `types.ts` — `PromptModule` interface (version, intent,
    system_core, intent_rules, optional few_shot_examples).
  - `system-core.ts` — `SYSTEM_CORE_V1` + version. IDENTICAL across
    all modules (prompt-cache invariant, verified by test).
  - `chat.ts` — general assistant (open conversation, drafting).
  - `contextual-ask.ts` — questions about user's saved data.
  - `create.ts` — task extraction (brain-dump splitting, dates).
  - `search.ts` — retrieval from user's saved items.
  - `expense.ts` — amount/category/vendor extraction.
  - `task-action.ts` — complete/delete/reschedule gates.
  - `partner-message.ts` — partner-relay composition.
  - `registry.ts` — `resolveIntentKey(intent)` + `loadPromptModule(intent)`;
    aliases (`web_search`→search, `merge`→task_action, etc.); falls
    back to chat on unknown intents (never null).

- **`_shared/prompts/intents/registry.test.ts`** — **14 tests**:
  canonical intents + case normalization + whitespace tolerance +
  alias mapping + unknown fallback + null safety + budget invariants
  (system_core ≤200 tok, intent_rules ≤250 tok, examples ≤250 tok) +
  `system_core` byte-equality across modules + unique version strings.

- **Backwards-compatible.** `ask-olive-prompts.ts` is unchanged;
  existing callers continue to work. Migrating callers to the new
  registry is a follow-up (one-line swap per caller).

### Task 4-D · Entity-Aware Search Pre-pass

**Intent.** The hybrid vector+BM25 search returns chunks by similarity;
it doesn't leverage the knowledge graph. When a user asks "what does
Sarah prefer for dinner?", the orchestrator should surface Sarah's
entity record + her depth-1 relationships before running vector search.

- **`_shared/entity-prepass.ts`** (~320 lines) — Pure core:
  - `matchEntitiesByKeyword(query, entities, maxMatches)` — case-
    insensitive substring match against entity canonical_name +
    aliases. Sorts by `mention_count` DESC. Min-length filter skips
    2-char candidates that would match anywhere.
  - `mergeEntityMatches(keyword, llm, max)` — keyword wins on dedup.
    (LLM path is stubbed in the types but disabled by default —
    keyword is zero-cost and catches 90% of cases.)
  - `formatEntityContext(neighborhood, maxTokens)` — stable output
    shape with `## ENTITIES IN QUERY` and `## RELATIONSHIPS (depth-1)`
    sections. Bounded by `MAX_ENTITY_CONTEXT_TOKENS = 300`. Shrink
    path: drop relationships first, then tail entities, always
    preserving at least the top 2 matches.
  - `runEntityPrepass(db, userId, query, options)` — orchestrator.
    NEVER throws: DB failure → empty block; relationship fetch
    failure → matches without relationships (partial result).

- **`olive-search/index.ts`** (modified) — Added `use_entity_prepass`
  boolean to `SearchRequest`. When true:
  - Runs `runEntityPrepass` before hybrid search.
  - Returns `entity_prepass: { context_block, match_count,
    relationship_count, estimated_tokens }` alongside existing
    `results`. Legacy callers that don't pass the flag are unchanged.

- **`_shared/entity-prepass.test.ts`** — **22 tests**: keyword
  matcher (case insensitivity, alias lookup via `metadata.aliases`,
  min-length filter, mention-count sort, maxMatches cap, no-hit
  fallback), merge semantics (keyword priority, ID dedup, cap),
  formatter (empty / standard shape / budget shrink / top-2
  preservation under tiny budget), orchestrator (happy path, empty
  query, empty user, DB failure, relationship-fetch partial failure,
  `entityPool` bypass, `DEFAULT_MAX_MATCHES` respect).

### Task 4-E · Event-Driven Artifact Recompile

**Intent.** Nightly compile alone leaves up to 24h of staleness —
"I hate cilantro" at 9am, prompt still says "enjoys cilantro" until
3am tomorrow. This is the highest-impact correctness risk in Phases
2/3. Event-driven recompile cuts staleness to ~10 min (debounce
window) at a cost of ~3 extra Flash calls/day/active user.

- **`20260417000000_phase4_compiled_artifacts.sql`** — idempotent,
  additive migration:
  1. Defensively drops any remaining CHECK constraint on
     `olive_heartbeat_jobs.job_type` so new job types (`recompile_artifacts`,
     earlier `contradiction_resolve`) can be scheduled everywhere.
     Production appears to already be constraint-free; dev/local envs
     converge after this.
  2. `enqueue_artifact_recompile(user_id, debounce_minutes)` RPC:
     looks up any pending recompile job for the user with
     `scheduled_for >= now()`. If found, returns its id (debounced).
     If not, inserts a new job `scheduled_for now() + debounce` and
     returns the new id.
  3. `on_memory_chunk_change()` trigger function: AFTER INSERT/UPDATE
     on `olive_memory_chunks`. Fires on content/active/importance
     changes. Wrapped in `BEGIN..EXCEPTION` so a queue failure never
     rolls back the chunk write. Inactive chunks don't trigger.
  4. `trg_memory_chunk_enqueue_recompile` trigger attached to
     `olive_memory_chunks`.
  5. Partial index on `olive_heartbeat_jobs(user_id, scheduled_for)`
     WHERE `job_type = 'recompile_artifacts' AND status = 'pending'`
     — keeps debounce lookup O(log n).

- **`olive-heartbeat/index.ts`** (modified):
  - Added `'recompile_artifacts'` to the `JobType` union.
  - New `case 'recompile_artifacts'` handler in the job dispatch
    switch. Invokes `olive-compile-memory` via
    `supabase.functions.invoke('olive-compile-memory', { action:
    'compile_user', user_id, force: false })`. Logs success with a
    preview of which file types changed. Skips the WhatsApp send
    branch — this is a silent background refresh, not a user message.

- **Concurrency note (in-code).** Under simultaneous brain-dump
  inserts (10 workers × 5 chunks each), the RPC's SELECT-then-INSERT
  pattern may occasionally duplicate. That's harmless: `compile_user`'s
  existing hash check short-circuits to "unchanged" when nothing
  actually moved.

### Testing

- **64 new tests** across 4 files:
  - `compiled-artifacts.test.ts` — 24 tests (Phase 4-A/B).
  - `prompts/intents/registry.test.ts` — 14 tests (Phase 4-C).
  - `entity-prepass.test.ts` — 22 tests (Phase 4-D).
  - `phase4-integration.test.ts` — 4 tests (golden-path e2e).
- **Full suite: 196 passed, 1 pre-existing failure** (unrelated to
  Phase 4; `mergeMemoryResults: maxTotal=0 → empty` in
  memory-retrieval.test.ts — confirmed failing on `main` before any
  Phase 4 changes via `git stash` comparison).
- All modified files pass `deno check` with no NEW type errors.
  The single pre-existing TS2345 in `orchestrator.ts`'s dead SOUL
  path is unrelated and unchanged by Phase 4.

### Files

**New files (Phase 4):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/functions/_shared/compiled-artifacts.ts` | ~350 | Pure validator + slot assembler (4-A/B) |
| `supabase/functions/_shared/compiled-artifacts.test.ts` | ~260 | 24 tests |
| `supabase/functions/_shared/prompts/intents/types.ts` | ~55 | `PromptModule` interface |
| `supabase/functions/_shared/prompts/intents/system-core.ts` | ~25 | Shared persona block |
| `supabase/functions/_shared/prompts/intents/{chat,contextual-ask,create,search,expense,task-action,partner-message}.ts` | ~20 each | Per-intent `PromptModule`s |
| `supabase/functions/_shared/prompts/intents/registry.ts` | ~100 | Loader + aliases + fallback |
| `supabase/functions/_shared/prompts/intents/registry.test.ts` | ~135 | 14 tests |
| `supabase/functions/_shared/entity-prepass.ts` | ~320 | KG pre-pass for olive-search (4-D) |
| `supabase/functions/_shared/entity-prepass.test.ts` | ~260 | 22 tests |
| `supabase/functions/_shared/phase4-integration.test.ts` | ~175 | E2E golden-path, 4 tests |
| `supabase/migrations/20260417000000_phase4_compiled_artifacts.sql` | ~130 | Trigger + RPC + index (4-E) |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/olive-compile-memory/index.ts` | +validator step per file, +source_chunk_ids + validation_score + budget_tokens in metadata, +per-artifact token cap enforcement, +`id` selected from notes/memories |
| `supabase/functions/_shared/orchestrator.ts` | Layer-4 deep-profile now routes through `assembleUserSlot`. +`userSlotSource/Fresh/Artifacts` telemetry on `UnifiedContext`. +import of compiled-artifacts module. Renamed dead duplicate `assembleFullContext` → `assembleSoulAwareContext` (was blocking `deno check`). |
| `supabase/functions/olive-search/index.ts` | +`use_entity_prepass` opt-in flag. +entity-prepass wiring in `search_notes` and `search_all` responses. |
| `supabase/functions/olive-heartbeat/index.ts` | +`'recompile_artifacts'` job type. +handler that invokes olive-compile-memory. |

### Deployment checklist

1. **Apply migration** (idempotent):
   ```
   supabase db push
   ```
   Or apply `20260417000000_phase4_compiled_artifacts.sql` manually.
   Creates the debounce RPC, trigger, and partial index. Relaxes the
   job_type CHECK if one still exists.

2. **Deploy edge functions** (order doesn't matter):
   ```
   supabase functions deploy olive-compile-memory
   supabase functions deploy olive-heartbeat
   supabase functions deploy olive-search
   # ask-olive-stream, whatsapp-webhook: redeploy only when migrating
   # their call sites to the new per-intent prompt registry.
   ```

3. **Verify** after deploy:
   - `olive_memory_files.metadata` shows `validation_score` and
     `source_chunk_ids` on the next compile run.
   - `olive_llm_analytics.slot_tokens` metadata starts showing
     `user_slot_source` values after ask-olive-stream + whatsapp-webhook
     migrate to pass `ctx.userSlotSource` into their tracker calls
     (follow-up, non-blocking).
   - After inserting a memory chunk, an `olive_heartbeat_jobs` row
     with `job_type='recompile_artifacts'` appears within a second.
     ~10 min later, `olive_heartbeat_log` shows a `recompile_artifacts`
     success entry for that user.
   - Calling `olive-search` with `use_entity_prepass: true` returns an
     `entity_prepass` block alongside results.

4. No config changes, no secrets rotation required.

---

## Invariants preserved (cumulative Phase 1 + 2 + 3 + 4)

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
- **Phase 3:** Memory retrieval ALWAYS produces results when active chunks
  exist. Importance-only fallback guarantees the LLM sees learned facts
  even when semantic search is unavailable or broken. Circuit breaker
  isolates failures per subsystem — one broken RPC never blanks the
  entire DYNAMIC slot.
- **Phase 3:** Embedding backfill is incremental and non-blocking.
  Missing embeddings are repaired 20 per heartbeat tick. Backfill
  failures don't affect other tick work or user-facing responses.
- Schema changes are additive; all existing rows remain valid (defaults
  backfill the new columns).
- **Phase 4:** Compiled artifacts are both BUDGET-CAPPED (profile≤400,
  patterns≤150, relationship≤100, household≤150 tokens; combined
  SLOT_USER≤650) and VALIDATED against their source chunks. A low
  grounding score is logged + stored in metadata but NEVER rejects the
  artifact — validation surfaces risk, downstream reviewers (wiki-lint,
  UI) decide what to do with it.
- **Phase 4:** USER_COMPILED slot assembly is deterministic and
  observable: `userSlotSource` telemetry records whether SLOT_USER
  came from fresh compiled artifacts, stale ones, or nothing. Week-
  over-week analytics can see compiled-path adoption directly.
- **Phase 4:** Per-intent prompt modules preserve a byte-identical
  `system_core` across every intent — prompt-cache prefix stability
  is a TEST INVARIANT, not a convention. Breaking it fails CI.
- **Phase 4:** Every per-intent module's `intent_rules` block fits
  ≤250 tokens (SLOT_INTENT_MODULE budget); `system_core` fits
  ≤200 tokens (SLOT_IDENTITY budget). Test-enforced, no drift.
- **Phase 4:** Entity pre-pass is OPT-IN (`use_entity_prepass: true`)
  and never blocks. A DB failure in the pre-pass leaves search output
  unchanged — callers that didn't ask for entity context are never
  affected.
- **Phase 4:** Event-driven artifact recompile is DEBOUNCED at the DB
  level (10-min window) and SWALLOWS ITS OWN ERRORS (trigger function
  catches all exceptions) — a queue failure never rolls back the
  underlying chunk write.

---

## 2026-04-18 — Phase 4 Follow-up Option A (resolver + stream migration + bug fix)

Phase 4 shipped the modular prompt system but the highest-volume callers
still ran on the legacy monolithic `OLIVE_CHAT_PROMPT` — so the actual
token savings were zero. Option A closes that loop for `ask-olive-stream`
behind a reversible feature flag, adds the missing `help_about_olive`
intent module (the FAQ content that used to live inline in the legacy
prompt), and fixes a latent off-by-one in memory retrieval.

### Task A-1 · `help_about_olive` intent module

**Intent.** The legacy `OLIVE_CHAT_PROMPT` had a 300-token "HELP &
HOW-TO — OLIVE FEATURE GUIDE" block. On modular calls that FAQ has
nowhere to land unless a dedicated intent module carries it.

- **`_shared/prompts/intents/help-about-olive.ts`** — condensed FAQ
  (≤250 tok per SLOT_INTENT_MODULE budget), covering: create note/task,
  due/reminder, complete/delete, lists, partner, privacy, WhatsApp,
  Google Calendar, expenses, agents, memories. Instructions tell the
  model to answer only what was asked.
- **Registry**: `help_about_olive` added as the 8th canonical intent.
  Alias `help` → `help_about_olive` so `ask-olive-stream`'s
  pre-filter (which emits `type='help'`) lands on the right module.
- **Tests updated**: 14 registry tests pass; canonical-intent list +
  allModules count bumped from 7 → 8; `help` alias verified.

### Task A-2 · `resolvePrompt` — feature-flagged resolver

**Intent.** Give every migration call site ONE reversible policy surface
so flipping off a regression is a single env-var change, not a deploy.

- **`_shared/prompts/intents/resolver.ts`** (~165 lines, pure):
  - `hashUserToBucket(userId)` — FNV-1a → `[0, 100)` bucket, stable
    across requests for the same user.
  - `decidePromptSource(userId, flag, rolloutPct)` — policy function
    with documented precedence: `USE_INTENT_MODULES=1` beats
    `INTENT_MODULES_ROLLOUT_PCT=N` beats default-legacy.
  - `resolvePrompt({ intent, userId, legacyPrompt, legacyVersion })` —
    returns `{ systemInstruction, intentRules, version, source,
    resolvedIntent }`. Caller uses it to drive Gemini + analytics in
    one object.

- **Feature flags** (Supabase edge runtime env vars):
  - `USE_INTENT_MODULES=1` — force-on, overrides everything.
  - `USE_INTENT_MODULES=0` — force-off, overrides rollout.
  - `INTENT_MODULES_ROLLOUT_PCT=N` — apply to first N% of users
    (hash-bucketed on userId). Defaults to 0 (legacy-only).

- **Rollout invariant.** Same user → same bucket → same path across
  all their requests (stability is tested). Makes A/B clean at
  user-granularity, not per-request noise.

- **`_shared/prompts/intents/resolver.test.ts`** — **20 tests**:
  hash determinism + distribution sanity; full flag-precedence matrix
  (ON/OFF/unset × rollout 0/50/100/negative/garbage × userId
  present/absent); resolver happy paths (legacy, modular, `help`
  alias, unknown intent fallback, flag=0 beats rollout=100, empty
  userId stays conservative, null/undefined intent safe).

### Task A-3 · `ask-olive-stream` CHAT path migration

**Intent.** Highest-volume LLM path on Olive's web surface. Migrating
it enables direct measurement of Phase 4's token savings against a
live traffic slice.

- **`ask-olive-stream/index.ts`** (modified — CHAT path only, other
  paths unchanged):
  - Imports `resolvePrompt` from the resolver.
  - Builds `intentForResolver` from `effectiveType='help'` (pre-filter)
    OR `classifiedIntent.intent` OR `effectiveType`, in that order.
  - Calls `resolvePrompt({...})` once per request — no DB, no LLM, no
    network.
  - On modular path: `system_core` becomes `SLOT_IDENTITY`,
    `intent_rules` becomes `SLOT_INTENT_MODULE`, both flow through
    the existing `formatContextWithBudget` so budgets apply uniformly.
  - On legacy path: behavior is BIT-IDENTICAL to pre-PR.
  - Analytics: `promptVersion` now carries the module version when
    modular; `metadata.prompt_system` = `"modular"|"legacy"` and
    `metadata.resolved_intent` = which module was loaded — this is the
    A/B key for the query below.

- **WEB_SEARCH path, CONTEXTUAL_ASK path, ACTION path** deliberately
  NOT migrated. They have their own prompt shapes (search-result
  formatting, data-question answering, action confirmation) that
  deserve their own modules — follow-up PR.

- **`whatsapp-webhook`** deliberately NOT migrated. It has 10
  chatType-specialized inline prompts (briefing, weekly_summary,
  daily_focus, productivity_tips, progress_check, motivation,
  planning, greeting, help_about_olive, assistant). Those need
  dedicated modules, not the generic `chat` module — separate PR.
  The resolver is ready for them when the modules are built.

### Task A-4 · Bug fix: `mergeMemoryResults: maxTotal=0`

**Intent.** A pre-existing off-by-one in `memory-retrieval.ts` where
the cap check happened AFTER `push()`. When `maxTotal=0` the function
returned 1 chunk instead of 0 — the single failing test in the Phase 4
suite.

- **`_shared/memory-retrieval.ts`** — moved cap check to run BEFORE
  `push()` in both the semantic-chunks loop and the importance-only
  loop. Comment added explaining the fix.
- **Impact:** the test `mergeMemoryResults: maxTotal=0 → empty` that
  was pre-existing-failing on main is now green. Full `_shared/` suite:
  **217 passed / 0 failed** (was 196/1 at Phase 4 landing).

### Task A-5 · A/B analytics query (ready to run once deployed)

Once the flag is enabled for even a small rollout pct, run this to
compare legacy vs modular on identical traffic:

```sql
-- Legacy vs modular: tokens + latency per CHAT call, last 7 days.
-- Assumes ask-olive-stream only (function_name filter).
SELECT
  COALESCE(metadata->>'prompt_system', 'legacy') AS prompt_system,
  metadata->>'resolved_intent' AS resolved_intent,
  COUNT(*) AS calls,
  ROUND(AVG(tokens_in))  AS avg_tokens_in,
  ROUND(AVG(tokens_out)) AS avg_tokens_out,
  ROUND(AVG((metadata->>'context_total_tokens')::int))
                         AS avg_context_tokens,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(SUM(cost_usd)::numeric, 4) AS total_cost_usd
FROM olive_llm_calls
WHERE function_name = 'ask-olive-stream'
  AND created_at > NOW() - INTERVAL '7 days'
  AND status <> 'stream_started'  -- exclude the stream-start sentinel
GROUP BY 1, 2
ORDER BY 1, 2;
```

Expected outcome after flag enabled for a representative user slice:

- `avg_tokens_in` for `prompt_system='modular'` should be ~40-60%
  lower than `prompt_system='legacy'` on CHAT calls (the main bet).
- `avg_latency_ms` should be comparable or slightly lower (smaller
  prompt → smaller TTFB).
- `avg_tokens_out` should be within ~10% between groups (otherwise
  quality may have drifted — investigate).

If modular is clearly worse on quality (subjective review of samples
grouped by `prompt_system`), `USE_INTENT_MODULES=0` rolls back
instantly — no code change, no redeploy.

### Testing

| Suite | Tests | Status |
| ---- | :---: | ------ |
| registry.test.ts (added `help`, 8-module assertions) | 14 | ✅ |
| resolver.test.ts (new) | 20 | ✅ |
| memory-retrieval.test.ts (fix restores the failing test) | 39 | ✅ |
| Full `_shared/` suite | **217** | **0 failures** (was 196/1) |

`deno check` on `ask-olive-stream` shows 8 errors — ALL pre-existing
(confirmed by stashing my changes and rechecking). Zero new type
errors introduced.

### Files

**New files:**
| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/functions/_shared/prompts/intents/help-about-olive.ts` | ~40 | 8th intent module |
| `supabase/functions/_shared/prompts/intents/resolver.ts` | ~165 | Feature-flagged resolver |
| `supabase/functions/_shared/prompts/intents/resolver.test.ts` | ~200 | 20 tests |

**Modified files:**
| File | Changes |
| ---- | ------- |
| `supabase/functions/_shared/prompts/intents/types.ts` | +`help_about_olive` in `IntentModuleKey`. |
| `supabase/functions/_shared/prompts/intents/registry.ts` | Registered help module + `help` alias. |
| `supabase/functions/_shared/prompts/intents/registry.test.ts` | 7→8 canonical intents; help alias test. |
| `supabase/functions/_shared/memory-retrieval.ts` | Fixed off-by-one in `mergeMemoryResults` (cap check moved before push). |
| `supabase/functions/ask-olive-stream/index.ts` | CHAT path now routes through `resolvePrompt`. Telemetry carries `prompt_system` + `resolved_intent`. |

### Deployment

1. **No migration** — this PR is edge-functions + shared modules only.

2. **Deploy**:
   ```
   supabase functions deploy ask-olive-stream
   ```
   (memory-retrieval is a shared module; it rides along with any edge
   function redeploy, but the change is no-op unless `maxTotal=0` is
   passed — safe.)

3. **Default behavior on deploy**: `USE_INTENT_MODULES` unset +
   `INTENT_MODULES_ROLLOUT_PCT` unset → **legacy path for every
   user**. Zero user-visible change, zero risk.

4. **Enable the A/B** (recommended, on dev first):
   ```
   supabase secrets set INTENT_MODULES_ROLLOUT_PCT=10
   ```
   → 10% of users (hash-bucketed) move to modular. Monitor the query
   above for 48h.

5. **Scale up** when green: set to 50, then 100. Any time, flip to
   `USE_INTENT_MODULES=0` to force-off during investigation.

### Invariants preserved (Option A delta)

- Legacy CHAT path is BIT-IDENTICAL to pre-PR when flags are off.
  Verified by: same `OLIVE_CHAT_PROMPT` input to `streamGeminiResponse`,
  same `CHAT_PROMPT_VERSION` logged, same metadata shape, no
  systemInstruction mutation.
- Rollout bucket is STABLE per user across requests — no mid-session
  flipping between legacy and modular.
- `USE_INTENT_MODULES=0` is a HARD OFF that overrides rollout pct —
  easy kill-switch.
- `resolvePrompt` never throws; unknown intents degrade to the chat
  module; empty userId stays conservative (legacy) when rollout is
  partial.
- Memory retrieval returns EXACTLY `min(available, maxTotal)` chunks
  for any `maxTotal >= 0`. No more off-by-one.

---

## 2026-04-19 — Phase 4 Option A follow-up · iOS parity hardening

Three HIGH-severity iOS issues surfaced by the parity audit + one
pre-existing Capacitor version mismatch that was blocking the Xcode
build. All four fixed. `** BUILD SUCCEEDED **` verified.

### Fix 1 · Hover-hidden interactive elements (HIGH, 6 files)

Multiple surfaces hid buttons behind `opacity-0 group-hover:opacity-100`.
On touch devices there IS no hover — the buttons were invisible and
unreachable. Pattern applied across the codebase:

  `opacity-0 group-hover:opacity-100`
→ `opacity-100 md:opacity-0 md:group-hover:opacity-100`

Mobile (< 768px): always visible. Desktop (≥ 768px): legacy hover
behavior preserved. Files touched:

- `src/components/NoteMediaSection.tsx` — external-link button on media rows
- `src/components/NoteInput.tsx` — media chip delete buttons (×2)
- `src/components/NoteReactions.tsx` — reaction add button
- `src/components/NoteThreads.tsx` — thread actions menu trigger
- `src/components/PartnerActivityWidget.tsx` — activity row arrow
- `src/pages/Lists.tsx` — delete-list button

NOT touched: `src/components/layout/ContextRail.tsx` (desktop-only
sidebar — hover is fine there) and `src/components/ui/toast.tsx`
(shadcn primitive; auto-dismiss makes the X optional).

### Fix 2 · Fixed `h-[500px]` ScrollArea (HIGH)

`src/pages/Knowledge.tsx` had two ScrollAreas hard-coded to 500px —
on iPhone SE (568px tall) this filled the entire viewport, making
content unreachable.

Replaced with `h-[60vh] max-h-[500px] min-h-[320px]`:
- iPhone SE: 60vh × ~568 = ~341px, clamped by min-h to 320px.
- iPhone 15 Pro: 60vh × ~852 = ~511px, clamped by max-h to 500px.
- Desktop: 60vh > 500px, max-h clamps back to 500px (legacy behavior).

### Fix 3 · Deep-link OAuth return listener (HIGH)

`src/pages/AuthRedirectNative.tsx` fires `window.location.href =
'olive://auth-complete'` to re-open the native app after web sign-in.
The scheme was registered in `Info.plist` but NO `appUrlOpen` listener
was wired on the native side — any URL the OS routed back to the app
was silently dropped.

- Installed `@capacitor/app@^7.1.2`.
- Extended `src/lib/capacitor-init.ts` with an `App.addListener(
  'appUrlOpen', ...)` handler using the existing dynamic-import +
  try/catch pattern (so web builds that don't have the plugin don't
  break).
- `handleDeepLink(url)` parses the scheme, routes `auth-complete`
  back into the React app with a full location reload (forces Clerk
  SDK re-hydrate from storage), and is extensible for future paths
  (`olive://note/<id>`, etc.).
- Pure URL logic exported as `__test__.handleDeepLink` for future
  unit coverage.
- Documented limitation in-code: this listener routes the URL, but
  cross-context auth session restoration (Safari sign-in → native
  WebView session) still depends on Clerk's mechanisms. Full native
  auth flow is a follow-up.

### Fix 4 · Pre-existing Capacitor v7/v8 plugin mismatch (infra)

The Xcode build was broken on `origin/dev` BEFORE this PR: `@capacitor/
core` + `ios` were at 7.4.3 but `status-bar`, `keyboard`, `haptics`
had been upgraded to v8.x. `CapacitorStatusBar/StatusBar.swift`
referenced `NSNotification.Name.capacitorViewDidAppear` which only
exists in Capacitor 8 core. Build failed with:

  `error: type 'NSNotification.Name?' has no member 'capacitorViewDidAppear'`

Downgraded three plugins to v7 to match core:
  - `@capacitor/status-bar`: 8.0.2 → 7.0.6
  - `@capacitor/keyboard`:   8.0.3 → 7.0.6
  - `@capacitor/haptics`:    8.0.2 → 7.0.5

Also bumped `ios/App/Podfile` and `ios/App/App.xcodeproj` deployment
target from iOS 14.0 → 15.0 (needed transiently while v8 plugins were
installed; kept at 15.0 since it's a safer baseline — iPhone 6s+ all
support it).

`xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug
-sdk iphonesimulator build` now produces `** BUILD SUCCEEDED **`.

### Test + build verification

- ✅ `deno test supabase/functions/_shared/` — 217 passed / 0 failed.
- ✅ `npx tsc --noEmit` — clean (React side compiles).
- ✅ `npm run build` — Vite production bundle builds (~4.3s).
- ✅ `npx cap sync ios` — 5 Capacitor plugins installed for iOS.
- ✅ `xcodebuild ... build` — `** BUILD SUCCEEDED **` on iphonesimulator.

### Invariants preserved

- Desktop hover behavior unchanged on all touched files.
- Knowledge ScrollArea height is IDENTICAL to pre-PR on desktop
  (≥ 833px viewport: `60vh > 500px → max-h caps to 500px`).
- Deep-link listener never throws (guarded by try/catch around the
  dynamic import AND the URL handler).
- `@capacitor/app` is loaded lazily — web builds don't pull it in.
- Plugin version alignment is strictly a downgrade in minor/major
  numbers; no API usage in Capacitor 7 was lost from the Capacitor 8
  versions (both series keep `setStyle`, `setOverlaysWebView`,
  `setResizeMode`, `setAccessoryBarVisible`, `setScroll`, `impact`,
  etc. — already-used methods).

---

## 2026-04-19 — iOS Passkey authentication fix

User report: "on iOS app, when I try to use passkey to login, it doesn't
work and it fails, while on web app, it works."

### Root cause (multi-layer)

Passkeys in a Capacitor iOS WebView require FOUR things to line up; three
were missing:

1. **WebView origin must match (or be a registrable suffix of) the
   WebAuthn RP ID.** Default Capacitor iOS origin is
   `capacitor://localhost`. Clerk's production instance uses
   `clerk.witholive.app` as the RP ID (decoded from
   `pk_live_Y2xlcmsud2l0aG9saXZlLmFwcCQ`). WebKit throws `SecurityError`
   when the two don't match, which Clerk surfaces as a generic
   "passkey failed" — hiding the real cause.

2. **`com.apple.developer.associated-domains` entitlement** with
   `webcredentials:<domain>` entries is required for iOS to let the
   WebView present platform passkeys for that domain. The iOS project
   had no `.entitlements` file at all.

3. **AASA (`apple-app-site-association`) JSON file** must be reachable
   at `https://<domain>/.well-known/apple-app-site-association`,
   served with `Content-Type: application/json` and no redirects.
   iOS fetches this on install to verify the app is authorized to use
   that domain's credentials. Missing entirely.

4. **Silent secondary bug**: because Capacitor iOS reported hostname
   `localhost`, `main.tsx`'s `isProductionOrigin()` was false → iOS
   users fell back to the DEV Clerk instance (`pk_test_*`). Different
   tenant from web users — silent data isolation.

### Fix

- **`capacitor.config.ts`** — added `server.hostname: 'witholive.app'` +
  `server.iosScheme: 'https'`. Keeps `webDir` local (no `server.url`
  override), so bundled assets still load from disk but under the
  origin `https://witholive.app`. This single change unblocks items
  (1) and (4): WebAuthn origin now matches and `isProductionOrigin()`
  returns true on iOS. Migration note in the config file warns about
  existing pk_test_* sessions being cleared on upgrade.

- **`ios/App/App/App.entitlements`** — new file with:

  ```xml
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>webcredentials:witholive.app</string>
    <string>webcredentials:www.witholive.app</string>
    <string>webcredentials:clerk.witholive.app</string>
    <string>applinks:witholive.app</string>
    <string>applinks:www.witholive.app</string>
  </array>
  ```

  Three `webcredentials:` entries cover the apex, `www`, and Clerk's
  subdomain (so whichever RP ID Clerk uses is covered). `applinks:`
  entries are additive — they don't break the existing `olive://`
  custom scheme but pre-wire Universal Links for when we migrate the
  deep-link flow off the custom scheme.

- **`ios/App/App.xcodeproj/project.pbxproj`** — added
  `CODE_SIGN_ENTITLEMENTS = App/App.entitlements;` to both Debug and
  Release configs of the App target so Xcode picks up the entitlements
  during codesign. Verified with `xcodebuild ... build` →
  `** BUILD SUCCEEDED **`.

- **`public/.well-known/apple-app-site-association`** — new AASA file.
  Contains `webcredentials` (passkeys), `applinks` (Universal Links
  pre-wired), and `appclips` (empty placeholder). Vite copies the
  `public/.well-known/` tree into `dist/` verbatim, so deploys serve
  it at `https://witholive.app/.well-known/apple-app-site-association`.

- **`vercel.json`** — two changes required so Vercel actually serves
  the AASA correctly:
  1. Added a `/.well-known/:path*` → `/.well-known/:path*` rewrite
     BEFORE the SPA catch-all. Without this, the existing
     `/(.*) → /index.html` would rewrite the AASA to the HTML bundle,
     and Apple would see HTML + reject.
  2. Added a `headers` rule that sets `Content-Type: application/json`
     + `Cache-Control: public, max-age=7200` for
     `/.well-known/apple-app-site-association`. Apple rejects
     `application/octet-stream` (Vercel's default for extension-less
     files).

- **`src/pages/SignIn.tsx`** — expanded `handlePasskeySignIn` error
  logging. Before: `console.error('[SignIn] Passkey error:', err)` +
  generic toast. After: structured log of
  `{origin, hasCredentialsAPI, hasPublicKeyCredential, isNative}`
  before the call, plus `{errorName, errorMessage, errorCause,
  clerkCode, clerkLongMessage, clerkMeta, isNative}` on failure. Added
  a dedicated `SecurityError` branch that tells the user "app origin
  doesn't match" (what iOS without AASA actually reports) instead of
  the misleading "not supported" message that used to run first.

### Build verification

- ✅ `npx tsc --noEmit` — clean.
- ✅ `npm run build` — Vite bundle OK; AASA present at
  `dist/.well-known/apple-app-site-association`.
- ✅ `npx cap sync ios` — 5 plugins synced.
- ✅ `xcodebuild -workspace App.xcworkspace -scheme App -sdk
  iphonesimulator build` → `** BUILD SUCCEEDED **`.
- ✅ `deno test supabase/functions/_shared/` — 217 / 0 failed.

### REQUIRED Clerk dashboard config (manual, one-time)

The Clerk production instance's allowed origins must include
`https://witholive.app` (likely already there, since the web app
works). If not, passkeys will still fail with a Clerk-side origin
error, not an iOS one. Verify at:

  Clerk Dashboard → Configure → Domains → Application origins

No new origin is required — the iOS app now presents itself as
`https://witholive.app`, which matches the existing web production
origin. No code deploy can add Clerk origins; the user does this in
the dashboard.

### Post-deploy verification steps

1. Deploy the web app to Vercel (dev branch → preview URL, or merge to
   prod). Confirm `https://witholive.app/.well-known/apple-app-site-association`
   returns `200 OK` with `Content-Type: application/json` and the
   exact JSON body from `public/.well-known/apple-app-site-association`.

2. Apple caches AASA aggressively. To force a re-fetch on a test
   device: delete + reinstall the app (simulator: `xcrun simctl
   uninstall booted app.olive.couple` then re-run). Alternative:
   toggle "Developer → Reset Pass Kit / Associated Domains" in iOS
   Settings (simulator has this under Developer menu).

3. In Xcode: add the entitlements file to the project if not already
   visible in the File Navigator (right-click App folder → Add Files →
   select `App.entitlements`). The `project.pbxproj` already points to
   it via `CODE_SIGN_ENTITLEMENTS`; this step just makes it visible in
   the GUI.

4. Run the app on simulator. Tap "Sign in with passkey". Expected
   behavior:
   - If user has NO passkey yet → Clerk prompts "Use an existing
     passkey or set up a new one" via iOS system sheet.
   - If user has a passkey registered on web → iOS offers it
     immediately.
   - Console logs `[SignIn/Passkey] Attempting authenticateWithPasskey`
     with `origin: "https://witholive.app"`. If that origin is still
     `capacitor://localhost`, the Capacitor config change didn't take
     effect — run `npx cap sync ios` again.

### Invariants preserved / trade-offs

- Web passkey flow UNCHANGED. All changes are iOS-scoped.
- API calls from iOS now originate from `https://witholive.app` —
  Supabase CORS is permissive; no edge-function changes needed.
- `olive://` custom scheme still works (the earlier deep-link fix is
  independent of this one).
- Deno tests + TypeScript compile still green.
- One-time migration: iOS users currently signed in against
  `pk_test_*` will be signed out on first launch after this change.
  They sign in again with their real (web) credentials and land on the
  correct Supabase data. Documented in `capacitor.config.ts` comment.

---

## 2026-04-19 — UX fixes: list privacy toggle + FAB dedupe

Two user-reported bugs visible on both iOS and web.

### Bug 1 · List-level Private / Shared toggle did nothing

The "Private" (or "Shared") pill next to the list title on the
list-detail page (`src/pages/ListCategory.tsx`) was a **display-only
`<Badge>`** — no `onClick`, no handler, no Popover. Tapping it looked
interactive but did nothing. The only way to toggle list privacy was to
open the Edit Dialog via the pencil icon → select Private/Shared → Save.
Meanwhile, the per-task privacy pill (`NotePrivacyToggle.tsx`) DID work,
which made the disparity confusing.

Fix:

- **`src/components/ListPrivacyToggle.tsx`** (new, ~170 lines) —
  Popover-backed Button that mirrors `NotePrivacyToggle`'s UX pattern
  exactly. Writes through `useSupabaseLists.updateList({ couple_id })`
  — the same hook + field the Edit Dialog was already using
  successfully (`handleEditList` at line 74-93). Toasts success/failure
  using existing translation keys (`listDetail.listShared` /
  `listMadePrivate`). When the user has no couple, falls back to a
  read-only `<Badge>` so the header still renders the state but the
  click is a no-op (matches pre-fix behavior for solo users).

- **`src/pages/ListCategory.tsx`** — replaced the two static `<Badge>`
  renders (lines 213-223) with a single `<ListPrivacyToggle
  listId={currentList.id} isShared={!!currentList.couple_id} />`. The
  Edit Dialog's Private/Shared buttons are untouched — users who prefer
  that route still have it.

Why a separate component from `NotePrivacyToggle` rather than a shared
one: different data source (`clerk_lists` vs `clerk_notes`), different
hook (`useSupabaseLists` vs `useSupabaseNotesContext`), different field
shape (`couple_id` vs `isShared` + `coupleId`). A shared abstraction
would be forced and cost more than it saves.

### Bug 2 · Three floating action buttons overlapping

The list-detail screen (and Home, Calendar, Reminders) rendered THREE
bottom-right FABs stacked on top of each other:

1. `FloatingSpeedDial` — global, mounted in `AppLayout.tsx`. Expandable
   menu with "Ask Olive" (chat) + "Brain-dump" (quick note). **KEEP.**
2. `FloatingActionButton` — per-page, mounted in 4 pages. Just a "+"
   that opened a Quick Add Note dialog. Duplicates the speed-dial's
   brain-dump path. **REMOVE.**
3. `FeedbackDialog` (variant="fab" by default) — global, mounted in
   `App.tsx`. Separate pill on the bottom-right. **REMOVE FROM FAB;
   keep the dialog, move the trigger into Settings.**

User's ask: "keep only one (the one that asks to chat with olive or
brain dump)." The speed-dial already provides both actions, so it's the
keeper.

Fixes:

- **`src/pages/Index.tsx`, `CalendarPage.tsx`, `ListCategory.tsx`,
  `Reminders.tsx`** — removed `FloatingActionButton` import + render
  from all four pages. Replaced with an explanatory comment so the
  next contributor understands why the FAB isn't there. The component
  file (`src/components/FloatingActionButton.tsx`) is kept in the tree
  (zero callers, but deleting it is a separate cleanup PR — doesn't
  block the UX fix and avoids noise in this diff).

- **`src/App.tsx`** — removed `<FeedbackDialog />` render + import.
  Comment in place explaining why.

- **`src/components/FeedbackDialog.tsx`** — the `variant="inline"`
  branch previously returned `null` as its trigger, making the Dialog
  unreachable. Changed it to render a small outlined `Button` with the
  MessageSquarePlus icon + "Send Feedback" label. The "fab" variant
  is preserved for any caller that still opts in, but it's no longer
  mounted anywhere by default.

- **`src/components/settings/AppPreferencesModals.tsx`** — the "Send
  Feedback" card in Help & Support was purely descriptive text (no
  action). Added `<FeedbackDialog variant="inline" />` inside the card
  so the card now has a working trigger button. Users discover
  feedback through Settings → Help & Support, which matches the user
  mental model ("tell me how to do X" lives in Settings).

### Testing

- ✅ `npx tsc --noEmit` — clean.
- ✅ `npm run build` — Vite bundle OK (4.1s).
- ✅ `deno test supabase/functions/_shared/` — 217 / 0 failed
  (no regression).
- ✅ `npx cap sync ios` — 5 plugins synced.
- ✅ `xcodebuild ... iphonesimulator build` → `** BUILD SUCCEEDED **`.

### Invariants preserved

- Web + iOS share identical behavior (single codebase change).
- The Edit Dialog (pencil icon) on the list detail still toggles
  privacy the same way it always did — ListPrivacyToggle is additive.
- `FloatingSpeedDial` (global) is untouched — Ask Olive + Brain-dump
  still available on every page.
- Feedback submission is unchanged at the send-feedback edge function
  level — only the trigger moved.
- Users without a couple see a read-only "Private" badge on list
  headers exactly as before (can't share when there's no one to share
  with).
- Existing i18n keys reused; new fallbacks provided for any new labels
  (`listDetail.visibilityLabel`, `listDetail.privateOption`,
  `listDetail.sharedOption`, `listDetail.privacyToggle`) using the
  shadcn i18n default-value pattern.

### Not in this PR (deliberately)

- Deleting `src/components/FloatingActionButton.tsx`. The component
  is no longer imported anywhere; removing the file is trivial but
  adds noise to this diff. One-line follow-up cleanup.
- Migrating `NotePrivacyToggle` + `ListPrivacyToggle` to a shared
  abstraction. The shapes of `Note` vs `List` privacy differ enough
  (isShared vs couple_id null-check) that a shared component would
  need a discriminated-union config object — more complexity than the
  ~170 lines of duplication it would save.

---

## 2026-04-19 — Phase 8-A · Eval Harness (static layer) + seed fixtures

Ships the foundation of Olive's test-and-measurement layer — the thing
the engineering plan called out as a prerequisite for Phase 5 (learning
agents) and Phase 6 (Anthropic fallback): **how do we know a change to
the prompt pipeline didn't regress quality?**

Two-layer design:

1. **STATIC** (this PR): pure-function pipeline invocation. No Gemini,
   no DB. Runs in 2 ms for 12 fixtures. Free, deterministic, safe for
   every CI run.
2. **LIVE** (stubbed in types, not implemented): same cases against
   real Gemini. Expensive, flaky, run nightly.

The first cut focuses 100% on static so we can ship the CI gate without
a billing conversation.

### What the static layer catches

- Intent alias drift (`help` stops mapping to `help_about_olive`).
- Prompt-system flag regressions (rollout env misread).
- `SLOT_USER` / `SLOT_DYNAMIC` overflow past 3,200-token budget.
- Memory injection failures (seeded fact never reaches the prompt).
- Missing required slots (`IDENTITY` / `QUERY` empty).
- Compiled-vs-dynamic `userSlotSource` telemetry breaking.

### Architecture

```
tools/eval-harness/
  run.ts                               # Deno CLI entry
  README.md                            # authoring + running docs
  fixtures/*.json                      # one case per file (12 seeded)
  reports/*.json                       # gitignored — timestamped runs

supabase/functions/_shared/eval-harness/
  types.ts                             # EvalCase, EvalResult, EvalReport
  static-runner.ts                     # pure pipeline runner
  loader.ts                            # JSON fixture loader + validator
  reporter.ts                          # percentile math + human summary
  eval-harness.test.ts                 # 27 meta-tests
```

### Case shape (JSON)

```json
{
  "id": "chat-basic-solo",
  "description": "Solo user asks for help drafting an email.",
  "suite": "intent-classification",
  "persona": "solo",
  "layer": "static",
  "tags": ["phase4-option-a", "regression"],
  "input": { "message": "...", "userId": "..." },
  "seededContext": { "compiledArtifacts": [...], "memoryChunks": [...] },
  "classifierFixture": { "intent": { "intent": "chat", ... } },
  "expected": {
    "resolvedIntent": "chat",
    "promptSystem": "modular",
    "slotBudgetUnder": 3200,
    "requiredSlotsPopulated": ["IDENTITY", "QUERY"],
    "promptMustContain": ["espresso"]
  }
}
```

Every `expected` field is optional — the runner asserts only what the
case opts into (open-world). This lets a case in the `memory-recall`
suite focus its assertions on recall without having to over-specify
other fields.

### CLI

```sh
# Full static suite (default)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run \
  tools/eval-harness/run.ts

# Filter by suite
deno run ... --suites memory-recall,prompt-budget

# Filter by tag (any-match)
deno run ... --tags phase4-option-a

# CI-friendly
deno run ... --fail-fast
```

Exit: `0` all-pass · `1` any failure · `2` CLI arg error. JSON report
lands in `tools/eval-harness/reports/<iso-timestamp>.json` (gitignored).

### First-cut fixture set (12 cases)

| Suite | Cases |
|---|---|
| `intent-classification` | chat, contextual_ask, create, search, expense, help_about_olive (via `help` alias) — all modular path |
| `user-slot-source` | couple persona with compiled artifacts → asserts `userSlotSource=compiled` |
| `prompt-budget` | 5-artifact + 4-chunk overflow case → must stay under 3,200 tokens |
| `memory-recall` | preference, safety (allergy), partner-name-via-compiled-artifact, empty-baseline |

### First-run result (this PR, clean)

```
Olive Eval Harness — STATIC layer
12/12 passed (100%)  ·  0 failed  ·  0 skipped

Per-suite:
  ✓ intent-classification         6/6 pass
  ✓ user-slot-source              1/1 pass
  ✓ prompt-budget                 1/1 pass
  ✓ memory-recall                 4/4 pass

Classifier accuracy:  100%
Memory recall rate:   100%
Token budgets (total across all slots, passing cases):
  intent-classification         p50=404  p95=420  max=425
  memory-recall                 p50=417  p95=430  max=431
Avg tokens by intent:
  chat=411  contextual-ask=523  create=404  search=362
  expense=403  help-about-olive=405

Completed in 2ms.
```

That 2 ms number is the most important line in this report: it means
the harness can run on EVERY PR without anyone caring about CI cost.

### Testing the tester

`eval-harness.test.ts` — **27 meta-tests** covering:

- Loader: accepts well-formed cases, rejects each required-field
  omission, aggregates errors across a batch.
- Static runner pass/fail paths: happy path, intent mismatch, budget
  overflow, required-slot missing, must-contain/must-not-contain,
  memory strategy inference, skip-reason when layer mismatches.
- Batch: suite filter, tag any-match filter, failFast halts early.
- Reporter: pass/fail/skip totals, percentile omission under small N,
  classifier accuracy + memory recall rates restricted to matching
  suites, human-summary headline + failure block.

Full `_shared/` regression: **244 passed / 0 failed** (was 217 pre-PR;
net +27 meta-tests, zero pre-existing failures).

### Design invariants preserved

- **Never throws from the runner.** An unexpected exception in
  `runStaticCase` is recorded as an `internal_error` failure, not a
  thrown error — one bad case doesn't blow up the batch.
- **Fixtures are pure data.** No TS imports needed to author one.
  PMs can open `fixtures/*.json`, copy the nearest case, and edit.
- **Assertions are structured, not textual.** A failure tells you
  exactly which field differed and what the expected/actual was.
  Reporter groups by failure type to surface systemic bugs.
- **Runner uses the SAME code production uses.** `resolvePrompt`,
  `assembleContext`, `assembleCompiledSlot`, `fetchMemoryChunks`,
  registry aliases — all imported from `_shared/` without stubs. The
  only stubs are `MemoryDB` (seeded chunks) and the classifier
  (fixture). If the harness passes, production routing works.
- **No Supabase, no Gemini, no network.** Static layer is hermetic —
  runs on a laptop in airplane mode.

### What's next (not in this PR)

1. **GitHub Actions CI gate** — run the static suite on every PR;
   fail the PR if `classifierAccuracy < 1.0` or `memoryRecallRate <
   1.0` or p95 tokens regress >20% vs `main`'s baseline report.
2. **Live layer** — real Gemini calls behind an env flag + a
   nightly-only workflow. Records response patterns, token usage,
   latency. Cases can opt in via `expected.responseShape`.
3. **Gold baseline diffing** — snapshot prompts in a baseline report
   committed to git; diff per PR so unintended prompt drift shows up
   in review.
4. **Grow the fixture set** — engineering plan target: 60 cases
   across 3 personas × 8 intents. Seeded at 12; grow as real bugs
   and edge cases surface.

### Invariants preserved across Phase 1 → 4 → Option A → iOS → 8-A

All prior invariants still hold. The harness is strictly additive:
zero changes to edge-function handlers, shared modules, or React UI.
Build + test chain:

- `npx tsc --noEmit` — clean.
- `npm run build` — Vite bundle unchanged.
- `deno test supabase/functions/_shared/` — **244 / 0 failed**.
- `deno run tools/eval-harness/run.ts` — **12 / 12 passed, 2 ms**.

---

## 2026-04-21 — Option B Phase 8-A (CI gate)

Builds on the static eval harness shipped earlier today. The harness
writes a rich `EvalReport`; the gate turns that report into a pass/fail
decision and wires it into every PR.

### Scope (intentionally tight)

- **Static layer only.** No live Gemini calls in CI — those would be
  paid + flaky per PR. Nightly live-layer workflow is a follow-up.
- **Absolute thresholds only** for first cut. Baseline-diffing vs
  `main` is a follow-up.
- **Deterministic rules only** (pass/fail). Soft-warning / trend
  rules are deferred until we have a baseline to compare against.

### Deliverables

**`tools/eval-harness/thresholds.json`** — declarative config. Six
rules, each tunable without a code change. A top-level `relaxations[]`
array serves as an audit log: whenever we lower a threshold, the
entry is required (date + PR + reason).

**`supabase/functions/_shared/eval-harness/gate.ts`** — pure decision
logic:

```ts
applyGate(report, thresholds) → { passed, violations, rulesChecked, suitesChecked }
renderGateMarkdown(decision, report) → string  // PR-comment-ready
```

Rule set:

| Rule | Default | What it catches |
| ---- | ------- | --------------- |
| `max-failures-allowed` | 0 | Any case failure. |
| `max-skipped-allowed` | 0 | Silent skipping is the #1 way regressions hide. |
| `classifier-accuracy` | ≥ 1.0 | Intent routing regression on any known intent. |
| `memory-recall-rate` | ≥ 1.0 | Seeded facts stopped reaching the LLM prompt. |
| `max-runtime-ms` | 30000 | Pathological cases before the suite outgrows per-PR CI. |
| `max-tokens-per-case` | 3200 per suite | STANDARD_BUDGET overrun on any SINGLE case (not p95 — one bad case fails the gate). |

Design choices:

- Rules are independent: a single failing case often trips multiple
  rules, and that redundancy helps triage.
- Missing metrics skip their rule (not applicable). Unknown suites in
  `maxTokensPerCase` are tolerated (forward-compat: adding a suite
  shouldn't break old configs).
- Same-suite overruns collapse to one violation with multiple case
  IDs — keeps PR comments readable when a whole suite regresses.
- Markdown renderer caps failing-case detail at 10 entries.

**`gate.test.ts`** — 19 meta-tests. Covers each rule's pass/fail path,
multiple simultaneous violations, missing-metric tolerance,
forward-compat for unknown suites, markdown headline + body shape +
10-case cap.

**`tools/eval-harness/gate.ts`** — CLI wrapper. Single command for CI:

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run \
  tools/eval-harness/gate.ts
# exit 0 pass · 1 fail · 2 CLI/IO error
```

- Loads thresholds, fixtures, runs the static batch, applies the gate.
- Writes `reports/latest.json` (full report) and `reports/latest.md`
  (PR comment body) — CI uploads them as artifacts.
- Captures git provenance (sha, branch, ci/local) for the markdown
  footer so reviewers can trace a comment back to a commit.
- `--thresholds` override for future staging/prod gate differentiation.

**`.github/workflows/eval-harness.yml`** — CI wiring:

- Triggers on PRs to `main`/`dev` + pushes to `main`. Manual
  `workflow_dispatch` for ad-hoc runs.
- Path-filtered to `supabase/functions/**`, `tools/eval-harness/**`,
  `src/**`, and the workflow file. Docs-only / CHANGES-only PRs skip.
- Deno caching keyed on lockfile + harness source hash — re-runs are
  seconds.
- `concurrency` group cancels in-flight runs on new commits so the
  Actions UI stays tidy.
- `permissions: pull-requests: write` (minimum) so the comment step
  works; everything else is read-only.
- Deliberately `set +e` around the gate call so the "Post PR
  comment" step ALWAYS runs, even on gate failure. Final step
  re-raises the exit code to fail the job.
- PR comment uses a marker (`<!-- olive-eval-harness-comment -->`) so
  subsequent runs **update** the existing comment instead of spamming.

**`tools/eval-harness/README.md`** — expanded with: running locally,
threshold semantics, when to add a relaxation, workflow anatomy, and
how to extend the rule set safely.

**`.gitignore`** — added `tools/eval-harness/reports/` (run
artifacts, regenerated every run, uploaded by CI) + `.claude/`.

### Verification

- ✅ Gate meta-tests: 19/19 pass.
- ✅ Full `_shared/` Deno suite: **263 passed / 0 failed** (was 244
  before this work).
- ✅ Gate CLI end-to-end on real fixtures: exit 0 (12/12 cases pass,
  all thresholds met).
- ✅ Gate CLI with deliberately-strict thresholds: exit 1, structured
  violations printed with case IDs. Confirms the fail path.
- ✅ `npx tsc --noEmit` clean.

### Post-deploy verification (after merge)

1. Open a draft PR touching any file under the workflow's path filter.
   Expect: "Eval Harness / Static eval + gate" check appears on the
   PR within ~1 minute.
2. That check runs ~10-20s (first run ~40s while Deno deps warm the
   cache). It posts a PR comment with the report summary.
3. Push a no-op commit to confirm the comment UPDATES (one bot
   comment per PR, not a thread).
4. Deliberately break a case in a branch — e.g. change an
   intent-classification fixture's `expected.classifier.intent` to
   `foo`. Expect: the check fails, the PR comment lists the
   violation with the exact case id.
