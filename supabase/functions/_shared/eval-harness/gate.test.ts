/**
 * Meta-tests for the CI gate decision logic.
 *
 * Exhaustively covers each rule in `gate.ts`:
 *   - max-failures-allowed
 *   - max-skipped-allowed
 *   - classifier-accuracy
 *   - memory-recall-rate
 *   - max-runtime-ms
 *   - max-tokens-per-case (incl. forward-compat + missing-metric tolerance)
 *
 * Also covers rendering:
 *   - Headline reflects pass/fail.
 *   - Violations block is present iff there are violations.
 *   - Failing-cases detail is capped at 10 entries.
 *
 * Run: deno test supabase/functions/_shared/eval-harness/gate.test.ts
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";

import { applyGate, renderGateMarkdown, type ThresholdConfig } from "./gate.ts";
import type { EvalReport, EvalResult, SuiteSummary } from "./types.ts";

// ─── Fixture builders ─────────────────────────────────────────────

function mkDefaultThresholds(overrides: Partial<ThresholdConfig["static"]> = {}): ThresholdConfig {
  return {
    version: "test-1.0",
    static: {
      minClassifierAccuracy: 1.0,
      minMemoryRecallRate: 1.0,
      maxFailuresAllowed: 0,
      maxSkippedAllowed: 0,
      maxRuntimeMs: 30000,
      maxTokensPerCase: {
        "intent-classification": 3200,
        "memory-recall": 3200,
        "prompt-budget": 3200,
        "user-slot-source": 3200,
        "modular-prompt-parity": 3200,
      },
      ...overrides,
    },
  };
}

function mkResult(opts: Partial<EvalResult> & { id: string; suite: EvalResult["suite"] }): EvalResult {
  return {
    caseId: opts.id,
    suite: opts.suite,
    passed: opts.passed ?? true,
    failures: opts.failures ?? [],
    layer: "static",
    metrics: opts.metrics ?? {},
    runtimeMs: opts.runtimeMs ?? 1,
    timestamp: "2026-04-19T00:00:00Z",
    skipReason: opts.skipReason,
  };
}

function mkReport(results: EvalResult[], summaryOverrides: Partial<EvalReport["summary"]> = {}): EvalReport {
  const bySuite: Record<string, SuiteSummary> = {};
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    const s = bySuite[r.suite] ?? { total: 0, passed: 0, failed: 0, skipped: 0 };
    s.total++;
    if (r.skipReason) {
      s.skipped++;
      skipped++;
    } else if (r.passed) {
      s.passed++;
      passed++;
    } else {
      s.failed++;
      failed++;
    }
    bySuite[r.suite] = s;
  }
  return {
    ranAt: "2026-04-19T00:00:00Z",
    layer: "static",
    totalCases: results.length,
    executedCases: results.length,
    passed,
    failed,
    skipped,
    results,
    summary: {
      bySuite: bySuite as any,
      ...summaryOverrides,
    },
  };
}

// ─── Happy path ───────────────────────────────────────────────────

Deno.test("applyGate: all passing cases + all metrics at target → gate passes", () => {
  const report = mkReport(
    [
      mkResult({ id: "c1", suite: "intent-classification", metrics: { totalTokens: 500 } }),
      mkResult({ id: "c2", suite: "memory-recall", metrics: { totalTokens: 600 } }),
    ],
    { classifierAccuracy: 1.0, memoryRecallRate: 1.0 }
  );
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, true);
  assertEquals(decision.violations.length, 0);
  assert(decision.rulesChecked >= 4, "expected several rules evaluated");
});

// ─── Rule: max-failures-allowed ───────────────────────────────────

Deno.test("applyGate: ANY failure fails the gate by default", () => {
  const report = mkReport([
    mkResult({ id: "ok", suite: "intent-classification" }),
    mkResult({
      id: "bad",
      suite: "intent-classification",
      passed: false,
      failures: [{ field: "x", expected: "a", actual: "b" }],
    }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  const v = decision.violations.find((x) => x.rule === "max-failures-allowed");
  assert(v, "expected max-failures-allowed violation");
  assertEquals(v!.caseIds, ["bad"]);
});

Deno.test("applyGate: relaxing maxFailuresAllowed accepts known failures", () => {
  const report = mkReport([
    mkResult({ id: "bad", suite: "intent-classification", passed: false, failures: [{ field: "x", expected: 1, actual: 0 }] }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds({ maxFailuresAllowed: 1 }));
  // Failure still present but not gate-failing.
  assertEquals(decision.passed, true);
});

// ─── Rule: max-skipped-allowed ────────────────────────────────────

Deno.test("applyGate: skipped case triggers max-skipped-allowed", () => {
  const report = mkReport([
    mkResult({ id: "skipped", suite: "intent-classification", skipReason: "layer mismatch" }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  assert(decision.violations.some((v) => v.rule === "max-skipped-allowed"));
});

// ─── Rule: classifier-accuracy ────────────────────────────────────

Deno.test("applyGate: classifier accuracy below threshold fails", () => {
  const report = mkReport([mkResult({ id: "c1", suite: "intent-classification" })], {
    classifierAccuracy: 0.8,
  });
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  assert(decision.violations.some((v) => v.rule === "classifier-accuracy"));
});

Deno.test("applyGate: classifier accuracy undefined → rule skipped (not applicable)", () => {
  const report = mkReport([mkResult({ id: "c1", suite: "memory-recall" })], {});
  const decision = applyGate(report, mkDefaultThresholds());
  // No intent-classification cases ⇒ summary.classifierAccuracy undefined ⇒ rule not evaluated.
  assertEquals(decision.passed, true);
});

// ─── Rule: memory-recall-rate ─────────────────────────────────────

Deno.test("applyGate: memory recall rate below threshold fails", () => {
  const report = mkReport([mkResult({ id: "m1", suite: "memory-recall" })], {
    memoryRecallRate: 0.5,
  });
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  const v = decision.violations.find((x) => x.rule === "memory-recall-rate");
  assert(v);
  assertStringIncludes(v!.message, "silently dropping");
});

// ─── Rule: max-runtime-ms ────────────────────────────────────────

Deno.test("applyGate: total runtime over ceiling fails", () => {
  const report = mkReport([
    mkResult({ id: "slow", suite: "intent-classification", runtimeMs: 40000 }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  assert(decision.violations.some((v) => v.rule === "max-runtime-ms"));
});

Deno.test("applyGate: runtime within ceiling passes", () => {
  const report = mkReport([
    mkResult({ id: "fast", suite: "intent-classification", runtimeMs: 100 }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds({ maxRuntimeMs: 1000 }));
  assertEquals(decision.passed, true);
});

// ─── Rule: max-tokens-per-case ───────────────────────────────────

Deno.test("applyGate: a single case over its suite cap fails the gate", () => {
  const report = mkReport([
    mkResult({ id: "ok", suite: "intent-classification", metrics: { totalTokens: 400 } }),
    mkResult({ id: "big", suite: "intent-classification", metrics: { totalTokens: 3500 } }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  const v = decision.violations.find((x) => x.rule === "max-tokens-per-case");
  assert(v, "expected tokens-per-case violation");
  assert(v!.caseIds?.includes("big"));
});

Deno.test("applyGate: multiple overruns in SAME suite collapse to one violation with multiple caseIds", () => {
  const report = mkReport([
    mkResult({ id: "big1", suite: "intent-classification", metrics: { totalTokens: 4000 } }),
    mkResult({ id: "big2", suite: "intent-classification", metrics: { totalTokens: 4500 } }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  const tokenViolations = decision.violations.filter(
    (v) => v.rule === "max-tokens-per-case"
  );
  assertEquals(tokenViolations.length, 1);
  assertEquals(tokenViolations[0].caseIds?.length, 2);
});

Deno.test("applyGate: overruns in DIFFERENT suites produce separate violations", () => {
  const report = mkReport([
    mkResult({ id: "big1", suite: "intent-classification", metrics: { totalTokens: 4000 } }),
    mkResult({ id: "big2", suite: "memory-recall", metrics: { totalTokens: 4000 } }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  const tokenViolations = decision.violations.filter(
    (v) => v.rule === "max-tokens-per-case"
  );
  assertEquals(tokenViolations.length, 2);
});

Deno.test("applyGate: metrics.totalTokens undefined → case tolerated (no fault)", () => {
  const report = mkReport([
    mkResult({ id: "no-metrics", suite: "intent-classification", metrics: {} }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, true);
});

Deno.test("applyGate: unknown suite in report (not in thresholds) → tolerated", () => {
  const report = mkReport([
    mkResult({
      id: "future-suite",
      suite: "modular-prompt-parity" as any,
      metrics: { totalTokens: 10000 },
    }),
  ]);
  // Use thresholds WITHOUT modular-prompt-parity entry.
  const config = mkDefaultThresholds();
  delete config.static.maxTokensPerCase["modular-prompt-parity"];
  const decision = applyGate(report, config);
  assertEquals(decision.passed, true);
});

Deno.test("applyGate: skipped cases do not count toward tokens-per-case", () => {
  const report = mkReport([
    mkResult({
      id: "skipped-big",
      suite: "intent-classification",
      metrics: { totalTokens: 99999 },
      skipReason: "layer mismatch",
    }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds({ maxSkippedAllowed: 5 }));
  // Skip doesn't trigger the skipped-rule (we raised it) AND doesn't
  // trigger tokens-per-case because skipped cases are excluded.
  assertEquals(decision.passed, true);
});

// ─── Cumulative: multiple rules fire together ─────────────────────

Deno.test("applyGate: multiple simultaneous violations all surface", () => {
  const report = mkReport(
    [
      mkResult({
        id: "bad1",
        suite: "intent-classification",
        passed: false,
        failures: [{ field: "x", expected: 1, actual: 0 }],
        metrics: { totalTokens: 5000 },
      }),
    ],
    { classifierAccuracy: 0, memoryRecallRate: 0 }
  );
  const decision = applyGate(report, mkDefaultThresholds());
  assertEquals(decision.passed, false);
  // Expect: max-failures + classifier-accuracy + max-tokens-per-case at minimum.
  const ruleIds = decision.violations.map((v) => v.rule);
  assert(ruleIds.includes("max-failures-allowed"));
  assert(ruleIds.includes("classifier-accuracy"));
  assert(ruleIds.includes("max-tokens-per-case"));
});

// ─── Rendering ────────────────────────────────────────────────────

Deno.test("renderGateMarkdown: headline reflects pass", () => {
  const report = mkReport([mkResult({ id: "ok", suite: "intent-classification" })], {
    classifierAccuracy: 1.0,
  });
  const decision = applyGate(report, mkDefaultThresholds());
  const md = renderGateMarkdown(decision, report);
  assertStringIncludes(md, "✅");
  assertStringIncludes(md, "PASS");
});

Deno.test("renderGateMarkdown: headline reflects fail + includes violations block", () => {
  const report = mkReport([
    mkResult({
      id: "bad",
      suite: "intent-classification",
      passed: false,
      failures: [{ field: "x", expected: 1, actual: 0 }],
    }),
  ]);
  const decision = applyGate(report, mkDefaultThresholds());
  const md = renderGateMarkdown(decision, report);
  assertStringIncludes(md, "❌");
  assertStringIncludes(md, "FAIL");
  assertStringIncludes(md, "### Violations");
  assertStringIncludes(md, "max-failures-allowed");
});

Deno.test("renderGateMarkdown: caps failing-cases detail at 10", () => {
  const results: EvalResult[] = [];
  for (let i = 0; i < 20; i++) {
    results.push(
      mkResult({
        id: `f${i}`,
        suite: "intent-classification",
        passed: false,
        failures: [{ field: "x", expected: 1, actual: 0 }],
      })
    );
  }
  const report = mkReport(results);
  const decision = applyGate(report, mkDefaultThresholds({ maxFailuresAllowed: 999 }));
  const md = renderGateMarkdown(decision, report);
  // First 10 included; 11th should NOT appear in the "Failing cases" block.
  assertStringIncludes(md, "f0");
  assertStringIncludes(md, "f9");
  assert(!md.includes("f11"), "expected failing-cases detail capped at 10");
});
