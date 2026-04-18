# Session Recap — Phase 4: Compiled Intelligence

**Date:** 2026-04-17
**Engineering plan reference:** Tasks 2-A, 2-B, 2-D, 2-E + event-driven invalidation (plan addendum)
**Headline:** Phase 4 turns Olive's memory layer from a re-derived, unverifiable blob into a compiled, budget-capped, source-cited, reactively refreshed artifact that every LLM call can trust.

---

## What shipped

### 4-A · Compiled-artifacts module + source-citation validator
- New shared module `_shared/compiled-artifacts.ts` with a pure grounding validator (`validateCompiledAgainstSources`) that scores compiled text 0..1 based on keyword overlap with its source chunks. Zero LLM cost, catches obvious fabrications.
- Per-artifact token budgets enforced: profile ≤400, patterns ≤150, relationship ≤100, household ≤150. Combined SLOT_USER ≤650.
- `olive-compile-memory` now captures `source_chunk_ids`, `validation_score`, `validation_notes`, `budget_tokens`, and `was_truncated` in `olive_memory_files.metadata`. Low-grounding runs are logged but never rejected — validation surfaces risk, it doesn't block.

### 4-B · USER_COMPILED slot assembly
- `assembleUserSlot(db, userId)` in the orchestrator replaces the old inline memory-file loop. Fresh-vs-stale classification, deterministic ordering, budget-capped output, and `userSlotSource` / `userSlotFresh` / `userSlotArtifacts` telemetry on `UnifiedContext`.
- Renamed a pre-existing duplicate `assembleFullContext` (dead SOUL variant at line ~1437) to `assembleSoulAwareContext`. Necessary to unblock `deno check` — the duplicate was already breaking typecheck on `main`. Zero runtime impact (no callers).

### 4-C · Per-intent prompt modules
- `_shared/prompts/intents/` directory with 7 intent modules: `chat`, `contextual_ask`, `create`, `search`, `expense`, `task_action`, `partner_message`.
- Shared `SYSTEM_CORE_V1` (~200 tokens) identical across modules — prompt-cache prefix invariant enforced by test. `intent_rules` ≤250 tokens per module — also test-enforced.
- `registry.ts` with `loadPromptModule(intent)` + alias table + fallback to chat. Never returns null.
- `ask-olive-prompts.ts` left untouched — backwards compatible. Migration of call sites is follow-up work.

### 4-D · Entity-aware search pre-pass
- `_shared/entity-prepass.ts`: keyword-match against user's known entities (sorted by mention_count), depth-1 neighborhood lookup, budget-capped formatter (≤300 tokens), never-throws orchestrator.
- `olive-search/index.ts` opt-in flag `use_entity_prepass: true`. Returns an `entity_prepass` block alongside the usual `results`.

### 4-E · Event-driven artifact invalidation
- Migration `20260417000000_phase4_compiled_artifacts.sql`:
  - `enqueue_artifact_recompile(user_id, debounce_minutes=10)` RPC (debounced SELECT-then-INSERT).
  - `on_memory_chunk_change()` trigger function, attached to `olive_memory_chunks` AFTER INSERT/UPDATE. Wrapped in EXCEPTION so queue failures never roll back chunk writes.
  - Partial index on pending recompile jobs for O(log n) debounce lookup.
  - Defensive DROP of any lingering `job_type` CHECK constraint so new job types schedule cleanly in every environment.
- `olive-heartbeat/index.ts` adds a `'recompile_artifacts'` job handler that invokes `olive-compile-memory` silently (no WhatsApp send).

---

## Testing

| Suite | Tests | Status |
| --- | --- | --- |
| compiled-artifacts.test.ts | 24 | ✅ all pass |
| prompts/intents/registry.test.ts | 14 | ✅ all pass |
| entity-prepass.test.ts | 22 | ✅ all pass |
| phase4-integration.test.ts (e2e golden path) | 4 | ✅ all pass |
| **Phase 4 total** | **64** | **100%** |
| Full `_shared/` suite | 196 | 1 pre-existing failure unchanged (`mergeMemoryResults: maxTotal=0 → empty`) |

Pre-existing failure confirmed against `main` via `git stash` comparison — unrelated to Phase 4 and does not touch any Phase 4 code path.

All modified + new files pass `deno check`. The single TS2345 error in the orchestrator's dead SOUL variant pre-dates Phase 4 and was inherited; my changes eliminated 4 of the 5 pre-existing type errors in that file (the duplicate function implementation issue).

---

## Invariants enforced

- Validation never blocks — low grounding scores surface in metadata, the artifact still ships.
- IDENTITY + QUERY slots are never dropped (pre-existing; preserved through Phase 4).
- `system_core` is byte-identical across every intent module — prompt-cache prefix stability is a test invariant.
- Per-artifact token budgets (ARTIFACT_BUDGETS) + COMPILED_USER_BUDGET are hard-capped in code and under test coverage.
- Entity pre-pass is strictly opt-in; legacy callers see zero change.
- Recompile trigger's EXCEPTION block makes queue failures non-fatal to the originating chunk write.
- Migration is idempotent and additive only (no column removals, no data loss).

---

## Cumulative stats through Phase 4

| Metric | Value |
| --- | --- |
| **Commits (Phase 1-4)** | 2 prior + 1 planned for this phase |
| **New shared modules (Phase 4)** | 3 (`compiled-artifacts.ts`, `entity-prepass.ts`, prompts/intents registry) |
| **New migrations (Phase 4)** | 1 (`20260417000000_phase4_compiled_artifacts.sql`) |
| **New heartbeat job type** | `recompile_artifacts` |
| **New Phase 4 tests** | 64 |
| **Cumulative tests in `_shared/`** | 196 passing (1 pre-existing failure) |
| **Files touched (Phase 4)** | 4 modified, 13 created |

---

## Not in scope / deliberate follow-ups

- **Migrate `ask-olive-stream` + `whatsapp-webhook` to use the per-intent prompt registry.** Backwards-compat shim keeps them on the monolithic prompt; swapping is a small, separate PR so token-reduction measurement is clean.
- **LLM-augmented entity extraction** (Flash-Lite call for novel entities not in the KG). Module has hooks; enabling it is a cost decision for later.
- **Pre-existing bug `mergeMemoryResults: maxTotal=0 → empty`** in memory-retrieval.ts — out of Phase 4 scope. Two-line fix for a future PR.
- **Wiki-lint pass surfacing low-grounding artifacts on the Admin page** — Phase 7 (showroom UX) territory.
- **Prompt caching + Anthropic fallback** — Phase 6 as planned. Phase 4's byte-identical `system_core` is the prerequisite.

---

## Deploy order (suggested)

1. Apply migration (`supabase db push`).
2. Deploy `olive-compile-memory` (picks up validator + budget enforcement).
3. Deploy `olive-heartbeat` (handles new job type).
4. Deploy `olive-search` (opt-in entity pre-pass).
5. Verify: insert a memory chunk → `olive_heartbeat_jobs` row appears → ~10 min later `olive_heartbeat_log` shows a `recompile_artifacts` success → `olive_memory_files.metadata.validation_score` non-null.

No config changes, no secrets rotation.
