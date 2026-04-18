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
