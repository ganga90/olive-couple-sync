/**
 * Eval Harness — Reporter
 * ========================
 * Turns a list of EvalResults into an EvalReport + a human-readable
 * string summary. Pure functions — no IO.
 *
 * Two outputs:
 *   - `buildReport(results, meta)` → structured EvalReport (JSON).
 *     This is what CI persists + diffs across runs.
 *   - `formatHumanSummary(report)` → a multi-line string suitable for
 *     dumping to stdout in the CLI or as a GitHub Actions comment.
 *
 * Shape invariants:
 *   - Sorting: results preserve input order (caller's fixture order).
 *   - Aggregation: `summary.bySuite` is always populated for every
 *     SuiteId that appeared in the input, even if 0/0/0.
 *   - Percentiles: computed only when there are enough passing cases
 *     to be meaningful (>= 3); otherwise omitted (undefined).
 */

import type {
  EvalLayer,
  EvalReport,
  EvalResult,
  ReportSummary,
  SuiteId,
  SuiteSummary,
} from "./types.ts";

// ─── Math helpers ─────────────────────────────────────────────────

/** Percentile with linear interpolation. Returns NaN on empty input. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedAsc[lower];
  const weight = rank - lower;
  return sortedAsc[lower] * (1 - weight) + sortedAsc[upper] * weight;
}

function avg(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ─── Build report ─────────────────────────────────────────────────

interface BuildReportMeta {
  layer: EvalLayer;
  totalCasesSeen: number;
  ranAt?: string;
  provenance?: EvalReport["provenance"];
}

export function buildReport(
  results: EvalResult[],
  meta: BuildReportMeta
): EvalReport {
  const passed = results.filter((r) => r.passed && !r.skipReason).length;
  const failed = results.filter((r) => !r.passed).length;
  const skipped = results.filter((r) => r.skipReason).length;

  // Per-suite rollup.
  const bySuite: Record<string, SuiteSummary> = {};
  for (const r of results) {
    const s =
      bySuite[r.suite] ??
      ({ total: 0, passed: 0, failed: 0, skipped: 0 } as SuiteSummary);
    s.total++;
    if (r.skipReason) s.skipped++;
    else if (r.passed) s.passed++;
    else s.failed++;
    bySuite[r.suite] = s;
  }

  // Percentile aggregates per suite — skip `totalTokens` unknowns.
  const tokenPercentiles: Record<
    SuiteId,
    { p50: number; p95: number; max: number }
  > = {} as any;
  for (const [suiteId, _summary] of Object.entries(bySuite)) {
    const tokens = results
      .filter((r) => r.suite === suiteId && r.passed && !r.skipReason)
      .map((r) => r.metrics.totalTokens)
      .filter((t): t is number => typeof t === "number")
      .sort((a, b) => a - b);
    if (tokens.length >= 3) {
      tokenPercentiles[suiteId as SuiteId] = {
        p50: Math.round(percentile(tokens, 50)),
        p95: Math.round(percentile(tokens, 95)),
        max: tokens[tokens.length - 1],
      };
    }
  }

  // Per-intent token averages (from metrics.moduleVersion mapping).
  const tokensByIntent: Record<string, number[]> = {};
  for (const r of results) {
    if (!r.passed || r.skipReason) continue;
    // Extract intent from module version (e.g. "chat-intent-v1.0" → "chat").
    const mv = r.metrics.moduleVersion;
    if (!mv || typeof r.metrics.totalTokens !== "number") continue;
    const intentGuess = mv.replace(/-intent-v.*$/, "");
    (tokensByIntent[intentGuess] ??= []).push(r.metrics.totalTokens);
  }
  const avgTokensByIntent: Record<string, number> = {};
  for (const [intent, toks] of Object.entries(tokensByIntent)) {
    const a = avg(toks);
    if (a !== undefined) avgTokensByIntent[intent] = Math.round(a);
  }

  // Classifier accuracy: fraction of intent-classification cases whose
  // resolvedIntent assertion passed. We infer this as "cases in that
  // suite that passed overall", accepting that other assertions may
  // also have failed — the harness design puts one dominant assertion
  // per suite, so this is a reasonable proxy.
  const classifierCases = results.filter(
    (r) => r.suite === "intent-classification" && !r.skipReason
  );
  const classifierAccuracy =
    classifierCases.length > 0
      ? classifierCases.filter((r) => r.passed).length / classifierCases.length
      : undefined;

  // Memory recall: fraction of memory-recall cases where the seeded
  // content was found in the assembled prompt (assertion passed).
  const recallCases = results.filter(
    (r) => r.suite === "memory-recall" && !r.skipReason
  );
  const memoryRecallRate =
    recallCases.length > 0
      ? recallCases.filter((r) => r.passed).length / recallCases.length
      : undefined;

  const summary: ReportSummary = {
    bySuite: bySuite as Record<SuiteId, SuiteSummary>,
    avgTokensByIntent: Object.keys(avgTokensByIntent).length
      ? avgTokensByIntent
      : undefined,
    tokenPercentiles: Object.keys(tokenPercentiles).length
      ? tokenPercentiles
      : undefined,
    classifierAccuracy,
    memoryRecallRate,
  };

  return {
    ranAt: meta.ranAt ?? new Date().toISOString(),
    layer: meta.layer,
    totalCases: meta.totalCasesSeen,
    executedCases: results.length,
    passed,
    failed,
    skipped,
    results,
    summary,
    provenance: meta.provenance,
  };
}

// ─── Human-readable summary ──────────────────────────────────────

/**
 * Render a report as a multi-line string. Intended for stdout in CI,
 * PR comments, or local runs. Keeps the narrative ordered:
 *   1. Headline (pass/fail counts).
 *   2. Per-suite rollup.
 *   3. Aggregate metrics (tokens, classifier accuracy, memory recall).
 *   4. First N failures with their assertion details.
 */
export function formatHumanSummary(
  report: EvalReport,
  opts: { maxFailuresShown?: number } = {}
): string {
  const { maxFailuresShown = 15 } = opts;
  const lines: string[] = [];

  // Headline.
  const passPct =
    report.executedCases > 0
      ? Math.round((report.passed / report.executedCases) * 100)
      : 0;
  lines.push(
    `Olive Eval Harness — ${report.layer.toUpperCase()} layer`,
    `Ran at: ${report.ranAt}`,
    `${report.passed}/${report.executedCases} passed (${passPct}%)  ·  ${report.failed} failed  ·  ${report.skipped} skipped`,
    ""
  );

  // Per-suite.
  if (Object.keys(report.summary.bySuite).length > 0) {
    lines.push("Per-suite:");
    for (const [suite, s] of Object.entries(report.summary.bySuite)) {
      const status =
        s.failed === 0 ? "✓" : s.failed > 0 && s.passed > 0 ? "!" : "✗";
      lines.push(
        `  ${status} ${suite.padEnd(28)}  ${s.passed}/${s.total} pass${
          s.skipped > 0 ? ` (${s.skipped} skipped)` : ""
        }`
      );
    }
    lines.push("");
  }

  // Aggregate metrics.
  if (report.summary.classifierAccuracy !== undefined) {
    lines.push(
      `Classifier accuracy:  ${Math.round(
        report.summary.classifierAccuracy * 100
      )}%`
    );
  }
  if (report.summary.memoryRecallRate !== undefined) {
    lines.push(
      `Memory recall rate:   ${Math.round(
        report.summary.memoryRecallRate * 100
      )}%`
    );
  }
  if (report.summary.tokenPercentiles) {
    lines.push("Token budgets (total across all slots, passing cases):");
    for (const [suite, pct] of Object.entries(report.summary.tokenPercentiles)) {
      lines.push(
        `  ${suite.padEnd(28)}  p50=${pct.p50}  p95=${pct.p95}  max=${pct.max}`
      );
    }
  }
  if (report.summary.avgTokensByIntent) {
    lines.push("Avg tokens by intent:");
    for (const [intent, t] of Object.entries(report.summary.avgTokensByIntent)) {
      lines.push(`  ${intent.padEnd(20)}  ${t}`);
    }
  }
  if (
    report.summary.classifierAccuracy !== undefined ||
    report.summary.memoryRecallRate !== undefined ||
    report.summary.tokenPercentiles ||
    report.summary.avgTokensByIntent
  ) {
    lines.push("");
  }

  // Failures.
  const failures = report.results.filter((r) => !r.passed);
  if (failures.length > 0) {
    lines.push(`Failures (showing first ${Math.min(failures.length, maxFailuresShown)}):`);
    for (const r of failures.slice(0, maxFailuresShown)) {
      lines.push(`  ✗ ${r.caseId} [${r.suite}]`);
      for (const f of r.failures) {
        const reason = f.reason ? ` — ${f.reason}` : "";
        lines.push(
          `      ${f.field}${reason}`,
          `        expected: ${JSON.stringify(f.expected)}`,
          `        actual:   ${JSON.stringify(f.actual)}`
        );
      }
    }
    if (failures.length > maxFailuresShown) {
      lines.push(`  …and ${failures.length - maxFailuresShown} more`);
    }
    lines.push("");
  }

  // Provenance footer.
  if (report.provenance) {
    const p = report.provenance;
    const parts = [
      p.commitSha ? `sha=${p.commitSha.slice(0, 7)}` : null,
      p.branch ? `branch=${p.branch}` : null,
      p.runner ? `runner=${p.runner}` : null,
    ].filter(Boolean);
    if (parts.length) lines.push(parts.join("  ·  "));
  }

  return lines.join("\n");
}
