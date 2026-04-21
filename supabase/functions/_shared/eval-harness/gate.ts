/**
 * Eval Harness — CI Gate (pure decision logic)
 * =============================================
 * Takes an `EvalReport` + a `ThresholdConfig` and returns a structured
 * `GateDecision` saying whether CI should pass or fail, with per-rule
 * detail for the PR comment.
 *
 * Pure function: no IO, no environment reads, no exits. The CLI
 * wrapper (`tools/eval-harness/gate.ts`) handles the process exit and
 * stdout. This module is small enough that meta-tests exhaustively
 * cover every rule.
 *
 * Design:
 *   - Each threshold rule produces at most ONE violation. If a rule
 *     fires, its violation carries the expected vs. actual so PR
 *     comments are self-contained (no "go look at the report").
 *   - Unknown suites in `maxTokensPerCase` are tolerated (forward-
 *     compat: adding a new suite shouldn't break old threshold configs).
 *   - Missing metrics (e.g. undefined `classifierAccuracy`) skip the
 *     corresponding rule rather than faulting — the harness decides
 *     whether a rule is applicable by populating the metric.
 *
 * Decision invariants (tested in gate.test.ts):
 *   1. Empty violations list ↔ `passed: true`.
 *   2. Any hard failure in the report → gate fails (`maxFailuresAllowed=0`).
 *   3. Tokens-per-case is a PER-CASE check: one overflow fails the gate,
 *      even if p95 across cases is fine.
 *   4. Skipped cases count against `maxSkippedAllowed` — default 0 so
 *      accidentally disabling a case requires an explicit relaxation.
 *   5. Unknown suites pass silently — future suites don't break old
 *      threshold configs.
 */

import type { EvalReport, SuiteId } from "./types.ts";

// ─── Config shape ─────────────────────────────────────────────────

export interface StaticThresholds {
  minClassifierAccuracy: number;
  minMemoryRecallRate: number;
  maxFailuresAllowed: number;
  maxSkippedAllowed: number;
  maxRuntimeMs: number;
  /**
   * Per-suite max tokens for ANY single case's `metrics.totalTokens`.
   * Missing suites tolerate any value (forward-compat).
   */
  maxTokensPerCase: Partial<Record<SuiteId, number>>;
}

export interface ThresholdConfig {
  version: string;
  static: StaticThresholds;
  /** Hand-maintained audit log of accepted relaxations. */
  relaxations?: Array<{ date: string; pr: string; reason: string }>;
}

// ─── Decision shape ───────────────────────────────────────────────

/**
 * One violation. Intended to be rendered 1:1 into a PR comment — the
 * `rule` is the human-readable name, `message` is the one-liner that
 * explains the delta.
 */
export interface GateViolation {
  rule: string;
  expected: string;
  actual: string;
  message: string;
  /** Optional case ids that contributed (so PR reviewer can jump to them). */
  caseIds?: string[];
}

export interface GateDecision {
  passed: boolean;
  violations: GateViolation[];
  /** Rules that were evaluated (even if they passed). Useful for "X of Y
   * checks passed" in the PR comment. */
  rulesChecked: number;
  /** Convenience: which suite-level checks ran. */
  suitesChecked: string[];
}

// ─── Rule runners ─────────────────────────────────────────────────

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * Evaluate every rule against the report and accumulate violations.
 * Rules are intentionally independent so a single failing case can
 * surface MULTIPLE violations if applicable (e.g. both "accuracy <
 * 1.0" and "failures > 0"). That redundancy helps triage — the same
 * failure is easier to find when it shows up in two different buckets.
 */
export function applyGate(
  report: EvalReport,
  config: ThresholdConfig
): GateDecision {
  const t = config.static;
  const violations: GateViolation[] = [];
  let rulesChecked = 0;
  const suitesChecked = Object.keys(report.summary.bySuite);

  // ── Rule 1: No raw failures ──────────────────────────────────
  rulesChecked++;
  if (report.failed > t.maxFailuresAllowed) {
    const failedCaseIds = report.results
      .filter((r) => !r.passed && !r.skipReason)
      .map((r) => r.caseId);
    violations.push({
      rule: "max-failures-allowed",
      expected: `failed <= ${t.maxFailuresAllowed}`,
      actual: `failed = ${report.failed}`,
      message: `${report.failed} case(s) failed; policy allows ${t.maxFailuresAllowed}.`,
      caseIds: failedCaseIds,
    });
  }

  // ── Rule 2: No unexpected skips ──────────────────────────────
  rulesChecked++;
  if (report.skipped > t.maxSkippedAllowed) {
    const skippedIds = report.results
      .filter((r) => r.skipReason)
      .map((r) => r.caseId);
    violations.push({
      rule: "max-skipped-allowed",
      expected: `skipped <= ${t.maxSkippedAllowed}`,
      actual: `skipped = ${report.skipped}`,
      message: `${report.skipped} case(s) skipped; policy allows ${t.maxSkippedAllowed}. Skipping a case silently is how regressions hide.`,
      caseIds: skippedIds,
    });
  }

  // ── Rule 3: Classifier accuracy ─────────────────────────────
  if (report.summary.classifierAccuracy !== undefined) {
    rulesChecked++;
    if (report.summary.classifierAccuracy < t.minClassifierAccuracy) {
      violations.push({
        rule: "classifier-accuracy",
        expected: `>= ${pct(t.minClassifierAccuracy)}`,
        actual: pct(report.summary.classifierAccuracy),
        message: `Intent classification regressed. Every intent-classification case must still resolve to its expected module.`,
      });
    }
  }

  // ── Rule 4: Memory recall rate ───────────────────────────────
  if (report.summary.memoryRecallRate !== undefined) {
    rulesChecked++;
    if (report.summary.memoryRecallRate < t.minMemoryRecallRate) {
      violations.push({
        rule: "memory-recall-rate",
        expected: `>= ${pct(t.minMemoryRecallRate)}`,
        actual: pct(report.summary.memoryRecallRate),
        message: `Seeded memory facts stopped reaching the LLM prompt. This is the sharpest quality signal we have — a drop means the orchestrator is silently dropping facts.`,
      });
    }
  }

  // ── Rule 5: Runtime ceiling ──────────────────────────────────
  rulesChecked++;
  const totalRuntime = report.results.reduce((sum, r) => sum + r.runtimeMs, 0);
  if (totalRuntime > t.maxRuntimeMs) {
    violations.push({
      rule: "max-runtime-ms",
      expected: `<= ${t.maxRuntimeMs}ms`,
      actual: `${totalRuntime}ms`,
      message: `Harness runtime exceeded. Either a case hit pathological behavior or the fixture set grew past what's safe for per-PR CI. Split into a nightly suite before raising this.`,
    });
  }

  // ── Rule 6: Per-case token budget ────────────────────────────
  // One violation per suite with an overrun (but with per-case detail
  // in caseIds). This keeps the PR comment compact when a whole suite
  // regresses together.
  rulesChecked++;
  const perSuiteOverruns = new Map<SuiteId, { cap: number; offenders: string[] }>();
  for (const r of report.results) {
    if (r.skipReason) continue;
    const cap = t.maxTokensPerCase[r.suite as SuiteId];
    if (cap === undefined) continue; // forward-compat: unknown suite
    const tokens = r.metrics.totalTokens;
    if (tokens === undefined) continue; // metric absent — don't fault the case
    if (tokens > cap) {
      const entry = perSuiteOverruns.get(r.suite as SuiteId) ?? {
        cap,
        offenders: [],
      };
      entry.offenders.push(`${r.caseId}=${tokens}tok`);
      perSuiteOverruns.set(r.suite as SuiteId, entry);
    }
  }
  for (const [suite, { cap, offenders }] of perSuiteOverruns) {
    violations.push({
      rule: "max-tokens-per-case",
      expected: `<= ${cap} tokens per case in suite '${suite}'`,
      actual: `${offenders.length} case(s) over: ${offenders.join(", ")}`,
      message: `At least one case in '${suite}' exceeded its per-case token cap. A single overrun means prompt content grew past the Context Contract's safety margin — investigate before raising the cap.`,
      caseIds: offenders.map((s) => s.split("=")[0]),
    });
  }

  return {
    passed: violations.length === 0,
    violations,
    rulesChecked,
    suitesChecked,
  };
}

// ─── Markdown rendering (for PR comment) ──────────────────────────

/**
 * Render a gate decision as GitHub-flavored markdown suitable for a PR
 * comment. Designed to be self-contained: a reviewer shouldn't need to
 * click into the Actions log to know WHAT regressed.
 */
export function renderGateMarkdown(
  decision: GateDecision,
  report: EvalReport
): string {
  const lines: string[] = [];

  // Headline.
  const emoji = decision.passed ? "✅" : "❌";
  const verdict = decision.passed ? "PASS" : "FAIL";
  lines.push(`## ${emoji} Olive Eval Harness — ${verdict}`);
  lines.push("");
  lines.push(
    `**${report.passed}/${report.executedCases}** cases passed · ` +
      `**${report.failed}** failed · **${report.skipped}** skipped`
  );
  lines.push("");

  // Per-suite rollup.
  const suiteEntries = Object.entries(report.summary.bySuite);
  if (suiteEntries.length > 0) {
    lines.push("### Per-suite");
    lines.push("");
    lines.push("| Suite | Pass | Fail | Skip |");
    lines.push("|---|---:|---:|---:|");
    for (const [suite, s] of suiteEntries) {
      lines.push(`| \`${suite}\` | ${s.passed} | ${s.failed} | ${s.skipped} |`);
    }
    lines.push("");
  }

  // Metrics.
  if (
    report.summary.classifierAccuracy !== undefined ||
    report.summary.memoryRecallRate !== undefined ||
    report.summary.tokenPercentiles
  ) {
    lines.push("### Metrics");
    lines.push("");
    if (report.summary.classifierAccuracy !== undefined) {
      lines.push(
        `- Classifier accuracy: **${pct(report.summary.classifierAccuracy)}**`
      );
    }
    if (report.summary.memoryRecallRate !== undefined) {
      lines.push(
        `- Memory recall rate: **${pct(report.summary.memoryRecallRate)}**`
      );
    }
    if (report.summary.tokenPercentiles) {
      lines.push("- Token budgets (passing cases):");
      for (const [suite, pctn] of Object.entries(
        report.summary.tokenPercentiles
      )) {
        lines.push(
          `  - \`${suite}\`: p50=${pctn.p50}, p95=${pctn.p95}, max=${pctn.max}`
        );
      }
    }
    lines.push("");
  }

  // Violations.
  if (decision.violations.length > 0) {
    lines.push("### Violations");
    lines.push("");
    for (const v of decision.violations) {
      lines.push(`**${v.rule}**`);
      lines.push("");
      lines.push(`- Expected: \`${v.expected}\``);
      lines.push(`- Actual: \`${v.actual}\``);
      lines.push(`- ${v.message}`);
      if (v.caseIds?.length) {
        lines.push(
          `- Cases: ${v.caseIds.map((id) => `\`${id}\``).join(", ")}`
        );
      }
      lines.push("");
    }
  }

  // Failure detail.
  const failed = report.results.filter((r) => !r.passed && !r.skipReason);
  if (failed.length > 0) {
    lines.push("### Failing cases (first 10)");
    lines.push("");
    for (const r of failed.slice(0, 10)) {
      lines.push(`#### \`${r.caseId}\` — suite: \`${r.suite}\``);
      for (const f of r.failures) {
        lines.push(
          `- \`${f.field}\`: expected \`${JSON.stringify(f.expected)}\`, ` +
            `got \`${JSON.stringify(f.actual)}\`` +
            (f.reason ? ` (${f.reason})` : "")
        );
      }
      lines.push("");
    }
  }

  // Footer.
  if (report.provenance) {
    const p = report.provenance;
    const parts = [
      p.commitSha ? `sha \`${p.commitSha.slice(0, 7)}\`` : null,
      p.branch ? `branch \`${p.branch}\`` : null,
      p.runner ? `runner \`${p.runner}\`` : null,
    ].filter(Boolean);
    lines.push("---");
    lines.push(
      `<sub>${parts.join(" · ")} · ran at ${report.ranAt} · ${decision.rulesChecked} rules checked</sub>`
    );
  }

  return lines.join("\n");
}
