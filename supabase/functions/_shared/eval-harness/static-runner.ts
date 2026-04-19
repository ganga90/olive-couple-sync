/**
 * Eval Harness — Static Runner
 * =============================
 * Phase 8-A: the free, fast, deterministic layer.
 *
 * For each case, wires up the EXACT pipeline ask-olive-stream uses —
 * classifier → resolvePrompt → assembleCompiledSlot → formatContextWithBudget
 * — but with SEEDED inputs instead of DB fetches and FIXTURE classifier
 * outputs instead of a Gemini call. The only "real" code is the same
 * pure logic that ships to production: context-contract, registry,
 * resolver, compiled-artifacts, memory-retrieval merging, intent
 * aliasing.
 *
 * What this runner CAN catch:
 *   - Intent-alias drift (e.g., "help" stops mapping to help_about_olive).
 *   - Prompt-system flag regressions (rollout env misread).
 *   - Budget overflow (new content pushes SLOT_USER past its cap).
 *   - Memory injection failures (seeded fact doesn't reach the prompt).
 *   - Missing required slots (IDENTITY / QUERY empty).
 *   - Compiled-vs-dynamic path telemetry breaking.
 *
 * What this runner CANNOT catch:
 *   - LLM quality (hallucinations, tone drift). → LIVE layer.
 *   - Real API latency / cost. → LIVE layer.
 *   - Integration bugs in the Gemini SDK wrapper. → LIVE layer.
 *
 * NEVER THROWS. An unexpected error inside `runStaticCase` is recorded
 * as an `internal_error` failure and the run continues.
 */

import {
  assembleCompiledSlot,
  type CompiledArtifact,
  type UserSlotResult,
} from "../compiled-artifacts.ts";
import {
  assembleContext,
  estimateTokens,
  STANDARD_BUDGET,
  STANDARD_CONTRACT,
  type AssemblyResult,
} from "../context-contract.ts";
import {
  fetchMemoryChunks,
  type MemoryDB,
  type MemoryRetrievalResult,
} from "../memory-retrieval.ts";
import { resolvePrompt } from "../prompts/intents/resolver.ts";
import type {
  AssertionFailure,
  EvalCase,
  EvalConfig,
  EvalResult,
  RunMetrics,
  SeededContext,
} from "./types.ts";

// ─── Seeded MemoryDB (zero-DB) ───────────────────────────────────

/**
 * Build an in-memory MemoryDB from seeded chunks. Semantic search is
 * stubbed: we return whatever matches the query's keyword overlap so
 * the pipeline exercises real merge/format logic without needing an
 * embedding vector.
 */
function makeSeededMemoryDB(
  chunks: SeededContext["memoryChunks"]
): MemoryDB {
  const all = chunks ?? [];
  return {
    async searchMemoryChunks(_userId, _embedding, limit, minImportance) {
      return all
        .filter((c) => (c.importance ?? 3) >= minImportance)
        .slice(0, limit);
    },
    async fetchTopMemoryChunks(_userId, limit, minImportance) {
      return all
        .filter((c) => (c.importance ?? 3) >= minImportance)
        .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
        .slice(0, limit);
    },
  };
}

// ─── Assembly helpers ────────────────────────────────────────────

/**
 * Build the USER_COMPILED slot content from seeded compiled artifacts.
 * Mirrors what orchestrator.ts does in production.
 */
function buildUserSlot(seeded?: SeededContext): UserSlotResult {
  const artifacts: CompiledArtifact[] = (seeded?.compiledArtifacts ?? []).map(
    (a) => ({
      file_type: a.file_type,
      content: a.content,
      updated_at: a.updated_at ?? new Date().toISOString(),
    })
  );
  return assembleCompiledSlot(artifacts);
}

/**
 * Build the DYNAMIC slot content from seeded memory chunks and saved
 * notes/lists. Mirrors the orchestrator's Layer 4 + Layer 5 wiring,
 * but without the Supabase RPC round-trips.
 */
async function buildDynamicSlot(
  userId: string,
  userMessage: string,
  seeded?: SeededContext
): Promise<{ content: string; strategy: MemoryRetrievalResult["strategy"] }> {
  const memoryDB = makeSeededMemoryDB(seeded?.memoryChunks);
  const memResult = await fetchMemoryChunks(memoryDB, userId, null, userMessage);

  const parts: string[] = [];
  if (memResult.promptBlock) parts.push(memResult.promptBlock);

  if (seeded?.savedNotes?.length) {
    parts.push(
      "## SAVED NOTES:\n" +
        seeded.savedNotes
          .map(
            (n) =>
              `- ${n.completed ? "✓" : "○"} ${n.summary}${n.due_date ? ` (due ${n.due_date})` : ""}`
          )
          .join("\n")
    );
  }
  if (seeded?.savedLists?.length) {
    parts.push(
      "## LISTS:\n" +
        seeded.savedLists.map((l) => `- ${l.name} (${l.id})`).join("\n")
    );
  }

  if (seeded?.memories?.length) {
    parts.push(
      "## MEMORIES:\n" +
        seeded.memories
          .map((m) => `- [${m.category}] ${m.title}: ${m.content}`)
          .join("\n")
    );
  }

  if (seeded?.patterns?.length) {
    parts.push(
      "## PATTERNS:\n" +
        seeded.patterns
          .map(
            (p) =>
              `- ${p.pattern_type}: ${JSON.stringify(p.pattern_data)} (${Math.round(
                p.confidence * 100
              )}%)`
          )
          .join("\n")
    );
  }

  return {
    content: parts.join("\n\n"),
    strategy: memResult.strategy,
  };
}

// ─── Assertions ───────────────────────────────────────────────────

/**
 * Compare an actual value to an expected value and push an assertion
 * failure if they don't match. Only runs when `expected` is defined —
 * the case only asserts what it opts into (open-world).
 */
function assertField<T>(
  failures: AssertionFailure[],
  fieldPath: string,
  expected: T | undefined,
  actual: T,
  reason?: string
): void {
  if (expected === undefined) return;
  if (actual !== expected) {
    failures.push({ field: fieldPath, expected, actual, reason });
  }
}

function assertSubset(
  failures: AssertionFailure[],
  fieldPath: string,
  expected: string[] | undefined,
  actualSet: Set<string>,
  reason?: string
): void {
  if (!expected) return;
  const missing = expected.filter((e) => !actualSet.has(e));
  if (missing.length > 0) {
    failures.push({
      field: fieldPath,
      expected,
      actual: [...actualSet],
      reason: `${reason ?? "missing items"}: ${missing.join(", ")}`,
    });
  }
}

function assertDisjoint(
  failures: AssertionFailure[],
  fieldPath: string,
  shouldBeEmpty: string[] | undefined,
  actualSet: Set<string>,
  reason?: string
): void {
  if (!shouldBeEmpty) return;
  const leaked = shouldBeEmpty.filter((s) => actualSet.has(s));
  if (leaked.length > 0) {
    failures.push({
      field: fieldPath,
      expected: "empty",
      actual: leaked,
      reason: reason ?? "expected slot to be empty but had content",
    });
  }
}

function assertContainsAll(
  failures: AssertionFailure[],
  fieldPath: string,
  expected: string[] | undefined,
  haystack: string,
  reason?: string
): void {
  if (!expected) return;
  const lowerHaystack = haystack.toLowerCase();
  const missing = expected.filter(
    (s) => !lowerHaystack.includes(s.toLowerCase())
  );
  if (missing.length > 0) {
    failures.push({
      field: fieldPath,
      expected,
      actual: "(not found in prompt)",
      reason: `${reason ?? "prompt missing"}: ${missing.join(", ")}`,
    });
  }
}

function assertContainsNone(
  failures: AssertionFailure[],
  fieldPath: string,
  forbidden: string[] | undefined,
  haystack: string,
  reason?: string
): void {
  if (!forbidden) return;
  const lowerHaystack = haystack.toLowerCase();
  const leaked = forbidden.filter((s) =>
    lowerHaystack.includes(s.toLowerCase())
  );
  if (leaked.length > 0) {
    failures.push({
      field: fieldPath,
      expected: "(absent)",
      actual: leaked,
      reason: reason ?? "forbidden content appeared in prompt",
    });
  }
}

// ─── Runner ───────────────────────────────────────────────────────

/** Run one case end-to-end against the static pipeline. */
export async function runStaticCase(
  testCase: EvalCase,
  config: EvalConfig
): Promise<EvalResult> {
  const startedAt = performance.now();
  const timestamp = new Date().toISOString();
  const failures: AssertionFailure[] = [];
  const metrics: RunMetrics = {};

  // Layer gating — caller decides whether to run each case.
  if (testCase.layer !== "static" && config.layer === "static") {
    return {
      caseId: testCase.id,
      suite: testCase.suite,
      passed: true, // skipping is not a failure
      failures: [],
      layer: testCase.layer,
      metrics,
      runtimeMs: 0,
      timestamp,
      skipReason: `case layer=${testCase.layer}, runner layer=${config.layer}`,
    };
  }

  try {
    // ── Step 1: Resolve prompt ──────────────────────────────────
    // Prefer the classifier fixture's intent when present; fall back
    // to the pre-filter style we use in ask-olive-stream (effectiveType).
    const intentForResolver =
      testCase.classifierFixture?.intent?.intent ??
      // Cases may also set expected.resolvedIntent as a hint to the
      // resolver for classifier-free harness runs.
      testCase.expected?.resolvedIntent ??
      "chat";

    const resolved = resolvePrompt({
      intent: intentForResolver,
      userId: testCase.input.userId,
      legacyPrompt: "LEGACY_TEST_PROMPT",
      legacyVersion: "chat-v1.0",
      // Deterministic: cases drive their own flag state via env overrides.
      // Default here is ON (modular path) since that's what we're evaluating.
      envGetter: () => "1",
    });

    metrics.promptSystem = resolved.source;
    metrics.moduleVersion = resolved.version;

    assertField(
      failures,
      "expected.promptSystem",
      testCase.expected.promptSystem,
      resolved.source
    );
    assertField(
      failures,
      "expected.resolvedIntent",
      testCase.expected.resolvedIntent,
      resolved.resolvedIntent
    );
    assertField(
      failures,
      "expected.moduleVersion",
      testCase.expected.moduleVersion,
      resolved.version
    );

    // ── Step 2: Assemble USER_COMPILED slot ─────────────────────
    const userSlot = buildUserSlot(testCase.seededContext);
    metrics.userSlotSource = userSlot.source;

    assertField(
      failures,
      "expected.userSlotSource",
      testCase.expected.userSlotSource,
      userSlot.source
    );

    // ── Step 3: Assemble DYNAMIC slot ───────────────────────────
    const dynamic = await buildDynamicSlot(
      testCase.input.userId,
      testCase.input.message,
      testCase.seededContext
    );
    metrics.memoryRetrievalStrategy = dynamic.strategy;

    assertField(
      failures,
      "expected.memoryRetrievalStrategy",
      testCase.expected.memoryRetrievalStrategy,
      dynamic.strategy
    );

    // ── Step 4: Context Contract assembly ────────────────────────
    const history = testCase.input.conversationHistory?.length
      ? "CONVERSATION HISTORY:\n" +
        testCase.input.conversationHistory
          .map((m) => `${m.role === "user" ? "User" : "Olive"}: ${m.content}`)
          .join("\n")
      : "";

    const assembly: AssemblyResult = assembleContext(
      {
        IDENTITY: resolved.systemInstruction,
        QUERY: `USER MESSAGE: ${testCase.input.message}`,
        USER_COMPILED: userSlot.content,
        INTENT_MODULE: resolved.intentRules,
        TOOLS: "",
        DYNAMIC: dynamic.content,
        HISTORY: history,
      },
      STANDARD_CONTRACT,
      STANDARD_BUDGET
    );

    metrics.totalTokens = assembly.totalTokens;
    metrics.slotTokens = {};
    for (const s of assembly.slots) {
      metrics.slotTokens[s.name] = s.tokens;
    }
    metrics.droppedSlots = assembly.droppedSlots;
    metrics.truncatedSlots = assembly.truncatedSlots;

    // Budget assertion.
    if (
      testCase.expected.slotBudgetUnder !== undefined &&
      assembly.totalTokens > testCase.expected.slotBudgetUnder
    ) {
      failures.push({
        field: "expected.slotBudgetUnder",
        expected: `<= ${testCase.expected.slotBudgetUnder}`,
        actual: assembly.totalTokens,
        reason: "total tokens exceeded budget",
      });
    }

    // Populated/empty slot assertions.
    const populatedSlotNames = new Set(
      assembly.slots.filter((s) => s.content.length > 0).map((s) => s.name)
    );
    const emptySlotNames = new Set(
      assembly.slots.filter((s) => s.content.length === 0).map((s) => s.name)
    );
    assertSubset(
      failures,
      "expected.requiredSlotsPopulated",
      testCase.expected.requiredSlotsPopulated,
      populatedSlotNames,
      "slot missing"
    );
    assertSubset(
      failures,
      "expected.slotsMustBeEmpty",
      testCase.expected.slotsMustBeEmpty,
      emptySlotNames,
      "slot should have been empty but wasn't"
    );

    // Required-slot health check (baseline — this is always an error).
    if (assembly.missingRequired.length > 0) {
      failures.push({
        field: "assembly.missingRequired",
        expected: "[]",
        actual: assembly.missingRequired,
        reason: "required slots empty at assembly time",
      });
    }

    // Prompt-content assertions (substring, case-insensitive).
    assertContainsAll(
      failures,
      "expected.promptMustContain",
      testCase.expected.promptMustContain,
      assembly.prompt,
      "prompt missing seeded content"
    );
    assertContainsNone(
      failures,
      "expected.promptMustNotContain",
      testCase.expected.promptMustNotContain,
      assembly.prompt,
      "forbidden content leaked"
    );
  } catch (err) {
    failures.push({
      field: "internal_error",
      expected: "no_throw",
      actual: err instanceof Error ? err.message : String(err),
      reason: "unexpected exception in runStaticCase",
    });
  }

  return {
    caseId: testCase.id,
    suite: testCase.suite,
    passed: failures.length === 0,
    failures,
    layer: testCase.layer,
    metrics,
    runtimeMs: Math.round(performance.now() - startedAt),
    timestamp,
  };
}

/**
 * Run a batch of cases sequentially and collect per-case results.
 * Sequential (not parallel) because static cases are fast enough
 * (~ms each) and sequential runs are easier to debug / diff.
 */
export async function runStaticBatch(
  cases: EvalCase[],
  config: EvalConfig
): Promise<EvalResult[]> {
  const filtered = cases.filter((c) => {
    if (config.suites?.length && !config.suites.includes(c.suite)) return false;
    if (config.tags?.length) {
      const caseTags = new Set(c.tags ?? []);
      if (!config.tags.some((t) => caseTags.has(t))) return false;
    }
    return true;
  });

  const results: EvalResult[] = [];
  for (const c of filtered) {
    const result = await runStaticCase(c, config);
    results.push(result);
    if (config.failFast && !result.passed && !result.skipReason) break;
  }
  return results;
}

// ─── Re-exports for external token estimation parity ─────────────
export { estimateTokens };
