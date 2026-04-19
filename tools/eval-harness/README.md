# Olive Eval Harness

A test-and-measurement layer for Olive's prompt + context pipeline.
Answers questions like:

- Did the latest change break intent classification → module dispatch?
- Does the seeded memory fact actually reach the LLM prompt?
- Did SLOT_USER overflow the budget after a new compiled artifact landed?
- Did `isProductionOrigin()` go false again on iOS (dev Clerk leak)?

## Layers

### Static (free, fast, deterministic) — runs today

Pure-function pipeline invocation. No Gemini calls. No DB round-trips.
For each case the runner:

1. Feeds a `classifierFixture` into `resolvePrompt()` (same function
   `ask-olive-stream` uses).
2. Builds the `USER_COMPILED` slot from seeded `compiledArtifacts`.
3. Builds the `DYNAMIC` slot from seeded `memoryChunks`, `savedNotes`,
   `savedLists`, `memories`, `patterns` (stubs `MemoryDB` against the
   seeded chunks).
4. Runs the Context Contract assembler with the standard contract
   and budget.
5. Compares structural outputs (resolved intent, module version,
   slot token totals, which slots populated, prompt-text substring
   checks) against the case's `expected` block.

Typical run: ~200ms for 10–50 cases. Zero network traffic.

### Live (paid, flaky, manual) — scaffolded, not wired

Same cases, but `config.layer = "live"` routes them through real
Gemini. Records token usage, latency, output patterns. Compares to a
stored baseline. **Not implemented in the first cut** — the case shape
already supports `expected.responseShape.{mustContain,mustNotContain,
mustMatchRegex}` so a future PR can add the live runner without
touching fixture format.

## Running

```sh
# Full static suite (default)
deno run --allow-read --allow-write --allow-net --allow-env \
  tools/eval-harness/run.ts

# Filter by suite
deno run ... tools/eval-harness/run.ts --suites memory-recall,prompt-budget

# Filter by tag (any match includes the case)
deno run ... tools/eval-harness/run.ts --tags phase4-option-a

# Fail-fast (CI mode — exit on first failure)
deno run ... tools/eval-harness/run.ts --fail-fast

# Skip the JSON report write
deno run ... tools/eval-harness/run.ts --no-report
```

Exit codes: `0` all pass · `1` at least one failure · `2` CLI arg error.

## Authoring fixtures

One JSON file per case in `fixtures/`. Minimum required fields:

```json
{
  "id": "my-case-id",
  "description": "What this case proves.",
  "suite": "intent-classification",
  "persona": "solo",
  "layer": "static",
  "input": {
    "message": "What the user types",
    "userId": "user-123"
  },
  "expected": {
    "resolvedIntent": "chat"
  }
}
```

Every field in `expected` is **optional** — the runner only asserts on
what you opt in to. Full shape in
`supabase/functions/_shared/eval-harness/types.ts`.

### Suite cheat-sheet

| Suite | What to assert |
|---|---|
| `intent-classification` | `resolvedIntent`, `promptSystem`, `moduleVersion` |
| `prompt-budget` | `slotBudgetUnder`, `requiredSlotsPopulated`, `slotsMustBeEmpty` |
| `memory-recall` | `promptMustContain`, `memoryRetrievalStrategy` |
| `user-slot-source` | `userSlotSource` (compiled vs dynamic vs empty) |
| `modular-prompt-parity` | cross-checks on modular vs legacy outputs |

### Persona cheat-sheet

| Persona | Seeded state expectation |
|---|---|
| `solo` | No couple, no partner context. Tests personal data flows. |
| `couple` | Has `coupleId`. Tests partner-scoped artifacts + cross-user context. |
| `team` | 3–10 members (reserved for future B2B spaces). |

### Tips

- **Scope assertions tightly.** A `chat-basic-solo` case shouldn't
  assert on memory retrieval strategy unless that's what it's testing.
  Every extra assertion is a brittleness multiplier.
- **Prefer structural to textual.** Assert `resolvedIntent=chat` over
  `promptMustContain=["You are Olive"]` when either would work — the
  structural check survives prompt rewording.
- **Use tags for cross-cutting regression sets.** Add
  `"tags": ["phase4-option-a", "regression"]` to any case that should
  run as a regression gate on future PRs.

## Reports

JSON reports land in `reports/<iso-timestamp>.json` (gitignored by
default; add to git if you want diff-able baselines). Shape:

```ts
{
  ranAt: "2026-04-19T...",
  layer: "static",
  passed: 10,
  failed: 0,
  skipped: 0,
  results: [ /* per-case */ ],
  summary: {
    bySuite: { "memory-recall": { passed: 4, failed: 0, ... }, ... },
    classifierAccuracy: 1.0,
    memoryRecallRate: 1.0,
    tokenPercentiles: { ... },
    avgTokensByIntent: { chat: 890, contextual_ask: 1204, ... }
  }
}
```

## Next steps (not in this first cut)

1. **GitHub Actions gate** — run the static suite on every PR, fail
   the PR if `classifierAccuracy < 1.0` or `memoryRecallRate < 1.0`
   or tokens p95 regresses >20% vs `main`.
2. **Live layer** — wire real Gemini calls behind an env flag and a
   separate CI workflow that runs nightly (not per-PR).
3. **Gold baseline diffing** — snapshot expected prompts in
   `reports/baseline/*.json`; diff per PR so unintended prompt drift
   shows up in review.
4. **Grow the fixture set** — engineering plan target: 60 cases across
   3 personas × 8 intents. Currently at 10 (seed).
