/**
 * Meta-tests for the eval harness itself.
 *
 * Covered:
 *   - Loader: accepts well-formed cases, rejects malformed.
 *   - Static runner: pass + fail paths.
 *   - Static runner: budget overflow fails cleanly.
 *   - Static runner: prompt-content assertions (must-contain / must-not-contain).
 *   - Static runner: memory-retrieval strategy inference.
 *   - Reporter: percentile math; per-suite rollup; human summary contains
 *     expected headline.
 *   - Batch: suite/tag filters.
 *
 * NOT covered here:
 *   - Real Gemini calls (that's the live layer).
 *   - Reading from the actual `fixtures/` directory (file IO is exercised
 *     by `loadFixturesFromDir` integration in the CLI; keeping these tests
 *     hermetic).
 *
 * Run: deno test supabase/functions/_shared/eval-harness/eval-harness.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { loadFixturesFromObjects, validateCase } from "./loader.ts";
import { runStaticBatch, runStaticCase } from "./static-runner.ts";
import { buildReport, formatHumanSummary } from "./reporter.ts";
import type { EvalCase, EvalConfig, EvalResult } from "./types.ts";

// ─── Fixtures for tests ───────────────────────────────────────────

function okChatCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "test-chat",
    description: "Basic chat case for tests.",
    suite: "intent-classification",
    persona: "solo",
    layer: "static",
    input: { message: "Hello Olive", userId: "user-test-1" },
    classifierFixture: {
      intent: {
        intent: "chat",
        confidence: 0.9,
        target_task_name: null,
        parameters: {},
      } as any,
    },
    expected: {
      resolvedIntent: "chat",
      promptSystem: "modular",
      moduleVersion: "chat-intent-v1.0",
    },
    ...overrides,
  };
}

// ─── Loader ───────────────────────────────────────────────────────

Deno.test("validateCase: accepts a well-formed case", () => {
  const errors: Array<{ file: string; reason: string }> = [];
  const c = validateCase(okChatCase(), "test.json", errors);
  assert(c !== null, "expected a valid case");
  assertEquals(errors.length, 0);
});

Deno.test("validateCase: rejects missing id", () => {
  const errors: Array<{ file: string; reason: string }> = [];
  const bad = { ...okChatCase(), id: "" };
  const c = validateCase(bad, "bad.json", errors);
  assertEquals(c, null);
  assert(errors[0].reason.includes("case.id"));
});

Deno.test("validateCase: rejects invalid suite", () => {
  const errors: Array<{ file: string; reason: string }> = [];
  const bad = { ...okChatCase(), suite: "not-a-suite" };
  const c = validateCase(bad, "bad.json", errors);
  assertEquals(c, null);
  assert(errors[0].reason.includes("invalid suite"));
});

Deno.test("validateCase: rejects invalid persona", () => {
  const errors: Array<{ file: string; reason: string }> = [];
  const bad = { ...okChatCase(), persona: "robot" };
  const c = validateCase(bad, "bad.json", errors);
  assertEquals(c, null);
});

Deno.test("validateCase: rejects missing input.message", () => {
  const errors: Array<{ file: string; reason: string }> = [];
  const bad = { ...okChatCase(), input: { userId: "u" } as any };
  const c = validateCase(bad, "bad.json", errors);
  assertEquals(c, null);
});

Deno.test("loadFixturesFromObjects: aggregates errors without throwing", () => {
  const { cases, errors } = loadFixturesFromObjects([
    { source: "good.json", data: okChatCase({ id: "a" }) },
    { source: "bad.json", data: { ...okChatCase(), id: "" } },
    { source: "good2.json", data: okChatCase({ id: "b" }) },
  ]);
  assertEquals(cases.length, 2);
  assertEquals(errors.length, 1);
});

// ─── Static runner: pass + fail ───────────────────────────────────

Deno.test("runStaticCase: intent-classification happy path passes", async () => {
  const result = await runStaticCase(okChatCase(), { layer: "static" });
  assertEquals(result.passed, true);
  assertEquals(result.failures.length, 0);
  assertEquals(result.metrics.promptSystem, "modular");
  assertEquals(result.metrics.moduleVersion, "chat-intent-v1.0");
});

Deno.test("runStaticCase: resolvedIntent mismatch records a failure", async () => {
  const c = okChatCase({
    expected: {
      resolvedIntent: "search", // deliberately wrong
      moduleVersion: "chat-intent-v1.0",
    },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, false);
  const intentFailure = result.failures.find(
    (f) => f.field === "expected.resolvedIntent"
  );
  assert(intentFailure, "expected resolvedIntent failure");
  assertEquals(intentFailure!.expected, "search");
  assertEquals(intentFailure!.actual, "chat");
});

Deno.test("runStaticCase: skipped when case layer != config layer", async () => {
  const c = okChatCase({ layer: "live" });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, true);
  assert(result.skipReason !== undefined);
});

// ─── Static runner: budget ────────────────────────────────────────

Deno.test("runStaticCase: budget overflow is flagged", async () => {
  const big = "a".repeat(20000); // ~5000 tokens in one slot
  const c = okChatCase({
    id: "budget-fail",
    suite: "prompt-budget",
    seededContext: {
      compiledArtifacts: [
        { file_type: "profile", content: big },
        { file_type: "patterns", content: big },
        { file_type: "relationship", content: big },
        { file_type: "household", content: big },
      ],
      memoryChunks: [
        {
          id: "x",
          content: big,
          chunk_type: "fact",
          importance: 5,
        },
      ],
    },
    input: {
      message: big, // push QUERY slot too
      userId: "user-budget",
    },
    expected: {
      slotBudgetUnder: 500, // far below the real budget — MUST fail
    },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, false);
  assert(result.failures.some((f) => f.field === "expected.slotBudgetUnder"));
});

Deno.test("runStaticCase: requiredSlotsPopulated asserts correctly", async () => {
  // IDENTITY + QUERY should always populate — assertion passes.
  const c = okChatCase({
    expected: { requiredSlotsPopulated: ["IDENTITY", "QUERY"] },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, true);
});

Deno.test("runStaticCase: requiredSlotsPopulated fails when slot is empty", async () => {
  const c = okChatCase({
    // DYNAMIC is expected populated but we seeded nothing.
    expected: { requiredSlotsPopulated: ["DYNAMIC"] },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, false);
  assert(
    result.failures.some((f) => f.field === "expected.requiredSlotsPopulated")
  );
});

// ─── Static runner: prompt-content ────────────────────────────────

Deno.test("runStaticCase: promptMustContain succeeds when seed reaches prompt", async () => {
  const c = okChatCase({
    id: "content-yes",
    suite: "memory-recall",
    seededContext: {
      memoryChunks: [
        {
          id: "mc",
          content: "Alex prefers Italian espresso.",
          chunk_type: "fact",
          importance: 5,
        },
      ],
    },
    expected: { promptMustContain: ["Italian espresso"] },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, true, JSON.stringify(result.failures));
});

Deno.test("runStaticCase: promptMustContain fails when seed is missing", async () => {
  const c = okChatCase({
    id: "content-no",
    expected: { promptMustContain: ["NotInPrompt"] },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, false);
  assert(
    result.failures.some((f) => f.field === "expected.promptMustContain")
  );
});

Deno.test("runStaticCase: promptMustNotContain catches leaked content", async () => {
  const c = okChatCase({
    id: "leak",
    seededContext: {
      memoryChunks: [
        {
          id: "leak",
          content: "SECRET_LEAK_MARKER",
          chunk_type: "fact",
          importance: 5,
        },
      ],
    },
    expected: { promptMustNotContain: ["SECRET_LEAK_MARKER"] },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, false);
  assert(
    result.failures.some((f) => f.field === "expected.promptMustNotContain")
  );
});

// ─── Static runner: memory strategy ───────────────────────────────

Deno.test("runStaticCase: empty memory → strategy=empty", async () => {
  const c = okChatCase({
    suite: "memory-recall",
    expected: { memoryRetrievalStrategy: "empty" },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, true);
  assertEquals(result.metrics.memoryRetrievalStrategy, "empty");
});

Deno.test("runStaticCase: seeded chunks → importance_only strategy", async () => {
  const c = okChatCase({
    suite: "memory-recall",
    seededContext: {
      memoryChunks: [
        {
          id: "mc",
          content: "Fact that matters.",
          chunk_type: "fact",
          importance: 5,
        },
      ],
    },
    expected: { memoryRetrievalStrategy: "importance_only" },
  });
  const result = await runStaticCase(c, { layer: "static" });
  assertEquals(result.passed, true);
});

// ─── Batch + filters ──────────────────────────────────────────────

Deno.test("runStaticBatch: suite filter drops non-matching cases", async () => {
  const cases: EvalCase[] = [
    okChatCase({ id: "a", suite: "intent-classification" }),
    okChatCase({ id: "b", suite: "memory-recall" }),
    okChatCase({ id: "c", suite: "prompt-budget" }),
  ];
  const results = await runStaticBatch(cases, {
    layer: "static",
    suites: ["memory-recall"],
  });
  assertEquals(results.length, 1);
  assertEquals(results[0].caseId, "b");
});

Deno.test("runStaticBatch: tag filter uses any-match semantics", async () => {
  const cases: EvalCase[] = [
    okChatCase({ id: "a", tags: ["smoke"] }),
    okChatCase({ id: "b", tags: ["regression"] }),
    okChatCase({ id: "c", tags: ["smoke", "regression"] }),
    okChatCase({ id: "d" }), // no tags
  ];
  const results = await runStaticBatch(cases, {
    layer: "static",
    tags: ["smoke"],
  });
  const ids = results.map((r) => r.caseId).sort();
  assertEquals(ids, ["a", "c"]);
});

Deno.test("runStaticBatch: failFast halts on first failure", async () => {
  const cases: EvalCase[] = [
    okChatCase({ id: "a" }), // passes
    okChatCase({
      id: "b",
      expected: { resolvedIntent: "wrong" },
    }), // fails
    okChatCase({ id: "c" }), // would pass but we stop earlier
  ];
  const results = await runStaticBatch(cases, {
    layer: "static",
    failFast: true,
  });
  assertEquals(results.length, 2);
  assertEquals(results[1].passed, false);
});

// ─── Reporter ─────────────────────────────────────────────────────

function mkResult(
  id: string,
  suite: EvalResult["suite"],
  passed: boolean,
  totalTokens?: number
): EvalResult {
  return {
    caseId: id,
    suite,
    passed,
    failures: passed ? [] : [{ field: "test", expected: 1, actual: 0 }],
    layer: "static",
    metrics: { totalTokens },
    runtimeMs: 1,
    timestamp: new Date().toISOString(),
  };
}

Deno.test("buildReport: pass/fail/skipped totals are correct", () => {
  const report = buildReport(
    [
      mkResult("a", "intent-classification", true, 500),
      mkResult("b", "intent-classification", false, 600),
      { ...mkResult("c", "memory-recall", true), skipReason: "skip" },
    ],
    { layer: "static", totalCasesSeen: 3 }
  );
  assertEquals(report.passed, 1);
  assertEquals(report.failed, 1);
  assertEquals(report.skipped, 1);
});

Deno.test("buildReport: tokenPercentiles computed when >=3 passing cases in suite", () => {
  const report = buildReport(
    [
      mkResult("a", "intent-classification", true, 100),
      mkResult("b", "intent-classification", true, 200),
      mkResult("c", "intent-classification", true, 300),
    ],
    { layer: "static", totalCasesSeen: 3 }
  );
  const pct = report.summary.tokenPercentiles?.["intent-classification"];
  assert(pct, "expected percentile entry");
  assertEquals(pct.max, 300);
  assert(pct.p50 >= 100 && pct.p50 <= 300);
});

Deno.test("buildReport: tokenPercentiles omitted when <3 passing cases", () => {
  const report = buildReport(
    [
      mkResult("a", "intent-classification", true, 100),
      mkResult("b", "intent-classification", true, 200),
    ],
    { layer: "static", totalCasesSeen: 2 }
  );
  assertEquals(report.summary.tokenPercentiles, undefined);
});

Deno.test("buildReport: classifierAccuracy reflects passing intent-classification cases", () => {
  const report = buildReport(
    [
      mkResult("a", "intent-classification", true),
      mkResult("b", "intent-classification", true),
      mkResult("c", "intent-classification", false),
      mkResult("d", "memory-recall", true),
    ],
    { layer: "static", totalCasesSeen: 4 }
  );
  // 2/3 intent-classification passed.
  assertEquals(report.summary.classifierAccuracy, 2 / 3);
});

Deno.test("buildReport: memoryRecallRate counts only memory-recall suite", () => {
  const report = buildReport(
    [
      mkResult("m1", "memory-recall", true),
      mkResult("m2", "memory-recall", false),
      mkResult("m3", "memory-recall", true),
      mkResult("m4", "memory-recall", true),
    ],
    { layer: "static", totalCasesSeen: 4 }
  );
  assertEquals(report.summary.memoryRecallRate, 3 / 4);
});

Deno.test("formatHumanSummary: headline includes pass ratio", () => {
  const report = buildReport(
    [mkResult("a", "intent-classification", true)],
    { layer: "static", totalCasesSeen: 1 }
  );
  const summary = formatHumanSummary(report);
  assert(summary.includes("1/1 passed"));
  assert(summary.includes("STATIC"));
});

Deno.test("formatHumanSummary: includes failure details when any case fails", () => {
  const report = buildReport(
    [
      mkResult("a", "intent-classification", true),
      mkResult("bad", "intent-classification", false),
    ],
    { layer: "static", totalCasesSeen: 2 }
  );
  const summary = formatHumanSummary(report);
  assert(summary.includes("Failures"));
  assert(summary.includes("bad"));
});
