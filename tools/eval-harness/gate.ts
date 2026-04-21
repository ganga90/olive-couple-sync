/**
 * Olive Eval Harness — CI Gate Entry Point
 * ==========================================
 * Single command for CI: load fixtures, run the static harness, apply
 * the declarative thresholds in `thresholds.json`, and exit 0/1.
 * Also emits a PR-comment-ready markdown body and a JSON snapshot.
 *
 * Why merge run + gate into one CLI?
 *   - CI has one moving piece, not two. Fewer places to misread env.
 *   - Report writing is a side-effect of running; keeping it in the
 *     same process guarantees the gate sees the report that was just
 *     produced (no race with a concurrent run).
 *   - Local dev gets the same command as CI: `deno run tools/eval-harness/gate.ts`.
 *     That makes "does this fail locally" a one-liner before pushing.
 *
 * Outputs
 *   stdout                                Human-readable summary + verdict.
 *   tools/eval-harness/reports/latest.json  Structured EvalReport.
 *   tools/eval-harness/reports/latest.md    Markdown body for PR comment.
 *
 * Exit codes
 *   0  gate passed (all rules satisfied).
 *   1  gate failed (one+ rule violation).
 *   2  CLI argument / filesystem error.
 *
 * Usage
 *   deno run --allow-read --allow-write --allow-net --allow-env --allow-run \
 *     tools/eval-harness/gate.ts
 *
 *   # Override thresholds path (e.g. for staging vs prod gates):
 *   deno run ... tools/eval-harness/gate.ts --thresholds path/to/other.json
 *
 *   # Suite / tag filters propagate to the underlying harness run:
 *   deno run ... tools/eval-harness/gate.ts --suites memory-recall,prompt-budget
 */

import { parseArgs } from "https://deno.land/std@0.207.0/cli/parse_args.ts";

import type {
  EvalConfig,
  SuiteId,
} from "../../supabase/functions/_shared/eval-harness/types.ts";
import { loadFixturesFromDir } from "../../supabase/functions/_shared/eval-harness/loader.ts";
import { runStaticBatch } from "../../supabase/functions/_shared/eval-harness/static-runner.ts";
import {
  buildReport,
  formatHumanSummary,
} from "../../supabase/functions/_shared/eval-harness/reporter.ts";
import {
  applyGate,
  renderGateMarkdown,
  type ThresholdConfig,
} from "../../supabase/functions/_shared/eval-harness/gate.ts";

const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname;
const REPORTS_DIR = new URL("./reports", import.meta.url).pathname;
const DEFAULT_THRESHOLDS = new URL("./thresholds.json", import.meta.url).pathname;

async function loadThresholds(path: string): Promise<ThresholdConfig> {
  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw) as ThresholdConfig;
  // Minimal shape sanity check — any missing `static` field is a config
  // error that would cause the gate to silently accept regressions.
  if (!parsed.static) {
    throw new Error(`thresholds.json missing 'static' block (path: ${path})`);
  }
  return parsed;
}

async function getProvenance() {
  const provenance: { commitSha?: string; branch?: string; runner: string } = {
    runner: Deno.env.get("CI") ? "ci" : "local",
  };
  try {
    const shaCmd = new Deno.Command("git", {
      args: ["rev-parse", "--short", "HEAD"],
      stdout: "piped",
      stderr: "null",
    });
    const shaOut = await shaCmd.output();
    if (shaOut.success) {
      provenance.commitSha = new TextDecoder().decode(shaOut.stdout).trim();
    }

    const branchCmd = new Deno.Command("git", {
      args: ["branch", "--show-current"],
      stdout: "piped",
      stderr: "null",
    });
    const branchOut = await branchCmd.output();
    if (branchOut.success) {
      provenance.branch = new TextDecoder().decode(branchOut.stdout).trim();
    }
  } catch {
    // git unavailable — non-fatal.
  }
  return provenance;
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["suites", "tags", "thresholds"],
    boolean: ["help"],
    default: {
      help: false,
      thresholds: DEFAULT_THRESHOLDS,
    },
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(
      "Usage: deno run --allow-read --allow-write --allow-net --allow-env \\\n" +
        "         --allow-run tools/eval-harness/gate.ts [options]\n\n" +
        "Runs the static eval harness and applies declarative thresholds.\n" +
        "Designed as CI's single entry point — exits 1 on any violation.\n\n" +
        "Options:\n" +
        "  --thresholds <path>   path to thresholds.json (default: next to this file)\n" +
        "  --suites <a,b>        comma-sep suite filter\n" +
        "  --tags <a,b>          comma-sep tag filter\n" +
        "  --help                show this help\n\n" +
        "Exit codes: 0 gate passed · 1 gate failed · 2 CLI / IO error.\n"
    );
    Deno.exit(0);
  }

  // Load thresholds.
  let thresholds: ThresholdConfig;
  try {
    thresholds = await loadThresholds(args.thresholds as string);
  } catch (err) {
    console.error(
      `[gate] cannot load thresholds at ${args.thresholds}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    Deno.exit(2);
  }

  // Load fixtures.
  const { cases, errors } = await loadFixturesFromDir(FIXTURES_DIR);
  if (errors.length > 0) {
    console.error(`[gate] ${errors.length} fixture loader error(s):`);
    for (const e of errors) console.error(`  ${e.file}: ${e.reason}`);
    // Fixture errors are a hard fail — an assertion we meant to run
    // isn't running, so we can't assert we're safe.
    Deno.exit(1);
  }
  if (cases.length === 0) {
    console.error("[gate] no fixtures loaded — nothing to assert on");
    Deno.exit(2);
  }

  // Build runner config.
  const config: EvalConfig = {
    layer: "static",
    // Gate always runs all cases and sees every failure — no failFast.
    // We'd rather get the full picture than halt on the first violation.
    failFast: false,
    suites: args.suites
      ? (args.suites.split(",").map((s) => s.trim()) as SuiteId[])
      : undefined,
    tags: args.tags ? args.tags.split(",").map((s) => s.trim()) : undefined,
  };

  // Run.
  const startedAt = performance.now();
  const results = await runStaticBatch(cases, config);
  const elapsedMs = Math.round(performance.now() - startedAt);

  // Build report + apply gate.
  const provenance = await getProvenance();
  const report = buildReport(results, {
    layer: config.layer,
    totalCasesSeen: cases.length,
    provenance,
  });
  const decision = applyGate(report, thresholds);

  // Emit human summary to stdout.
  console.log(formatHumanSummary(report));
  console.log(`\nGate: ${decision.passed ? "PASS ✓" : "FAIL ✗"}  (${decision.rulesChecked} rules)`);
  if (decision.violations.length > 0) {
    console.log(`\nViolations:`);
    for (const v of decision.violations) {
      console.log(`  ✗ ${v.rule}: ${v.message}`);
      console.log(`      expected=${v.expected}  actual=${v.actual}`);
      if (v.caseIds?.length) {
        console.log(`      cases=${v.caseIds.join(", ")}`);
      }
    }
  }
  console.log(`\nCompleted in ${elapsedMs}ms.`);

  // Persist outputs for CI to upload + comment with.
  try {
    await Deno.mkdir(REPORTS_DIR, { recursive: true });
    const jsonPath = `${REPORTS_DIR}/latest.json`;
    const mdPath = `${REPORTS_DIR}/latest.md`;
    await Deno.writeTextFile(jsonPath, JSON.stringify(report, null, 2));
    await Deno.writeTextFile(mdPath, renderGateMarkdown(decision, report));
    console.log(`\nReport JSON: ${jsonPath}`);
    console.log(`Report MD:   ${mdPath}`);
  } catch (err) {
    console.warn(
      `[gate] failed to write report files: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    // Non-fatal — the gate decision itself is already in stdout.
  }

  Deno.exit(decision.passed ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
