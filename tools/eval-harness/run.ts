/**
 * Olive Eval Harness — CLI Entry Point
 * ======================================
 * Runs the static (free, deterministic) layer of the eval harness over
 * every fixture in `tools/eval-harness/fixtures/*.json`, prints a
 * human-readable summary to stdout, and writes a timestamped JSON
 * report under `tools/eval-harness/reports/`.
 *
 * Why Deno for the CLI:
 *   - The harness modules live under `supabase/functions/_shared/` and
 *     are authored for Deno (Supabase edge runtime). Running the CLI
 *     on Deno means zero import-path shimming; we use the same code
 *     production uses.
 *   - Node/Vitest would work but needs a bundler pass + ESM interop.
 *     Keep it simple: one command, one runtime.
 *
 * Usage:
 *
 *   # Full static suite (default)
 *   deno run --allow-read --allow-write --allow-net --allow-env \
 *     tools/eval-harness/run.ts
 *
 *   # Filter by suite
 *   deno run ... tools/eval-harness/run.ts --suites memory-recall,prompt-budget
 *
 *   # Filter by tag
 *   deno run ... tools/eval-harness/run.ts --tags phase4-option-a
 *
 *   # Fail-fast (CI mode — exit on first failure)
 *   deno run ... tools/eval-harness/run.ts --fail-fast
 *
 *   # Suppress the JSON report write
 *   deno run ... tools/eval-harness/run.ts --no-report
 *
 * Exit codes:
 *   0 — all cases passed (or skipped).
 *   1 — at least one case failed OR fixture loader reported errors.
 *   2 — CLI argument error / directory missing.
 */

import { parseArgs } from "https://deno.land/std@0.207.0/cli/parse_args.ts";

import type { EvalConfig, SuiteId } from "../../supabase/functions/_shared/eval-harness/types.ts";
import { loadFixturesFromDir } from "../../supabase/functions/_shared/eval-harness/loader.ts";
import { runStaticBatch } from "../../supabase/functions/_shared/eval-harness/static-runner.ts";
import {
  buildReport,
  formatHumanSummary,
} from "../../supabase/functions/_shared/eval-harness/reporter.ts";

const FIXTURES_DIR = new URL("./fixtures", import.meta.url).pathname;
const REPORTS_DIR = new URL("./reports", import.meta.url).pathname;

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
    // git not available — non-fatal; the report just omits provenance.
  }
  return provenance;
}

async function main() {
  const args = parseArgs(Deno.args, {
    string: ["suites", "tags"],
    boolean: ["fail-fast", "no-report", "help"],
    default: { "fail-fast": false, "no-report": false, help: false },
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(
      "Usage: deno run --allow-read --allow-write --allow-net --allow-env \\\n" +
        "         tools/eval-harness/run.ts [options]\n\n" +
        "Options:\n" +
        "  --suites <a,b>   comma-sep suite filter (intent-classification, prompt-budget,\n" +
        "                   memory-recall, user-slot-source, modular-prompt-parity)\n" +
        "  --tags <a,b>     comma-sep tag filter (any match includes the case)\n" +
        "  --fail-fast      exit on first failure\n" +
        "  --no-report      skip writing the JSON report to disk\n" +
        "  --help           show this help\n"
    );
    Deno.exit(0);
  }

  // Load fixtures.
  const { cases, errors } = await loadFixturesFromDir(FIXTURES_DIR);
  if (errors.length > 0) {
    console.error(`\n[harness] ${errors.length} fixture loader error(s):`);
    for (const e of errors) {
      console.error(`  ${e.file}: ${e.reason}`);
    }
    // Fixture errors are NOT silent — they fail the run so authors catch
    // them immediately. Even if some cases loaded, a malformed fixture
    // usually means an assertion we INTENDED to run isn't running.
    Deno.exit(1);
  }
  if (cases.length === 0) {
    console.error("[harness] no fixtures found at", FIXTURES_DIR);
    Deno.exit(2);
  }

  // Build config.
  const config: EvalConfig = {
    layer: "static",
    failFast: !!args["fail-fast"],
    suites: args.suites
      ? (args.suites.split(",").map((s) => s.trim()) as SuiteId[])
      : undefined,
    tags: args.tags ? args.tags.split(",").map((s) => s.trim()) : undefined,
  };

  // Run.
  const startedAt = performance.now();
  const results = await runStaticBatch(cases, config);
  const elapsedMs = Math.round(performance.now() - startedAt);

  // Report.
  const provenance = await getProvenance();
  const report = buildReport(results, {
    layer: config.layer,
    totalCasesSeen: cases.length,
    provenance,
  });

  console.log(formatHumanSummary(report));
  console.log(`\nCompleted in ${elapsedMs}ms.`);

  // Write JSON report.
  if (!args["no-report"]) {
    try {
      await Deno.mkdir(REPORTS_DIR, { recursive: true });
      const stamp = report.ranAt.replace(/[:.]/g, "-");
      const reportPath = `${REPORTS_DIR}/${stamp}.json`;
      await Deno.writeTextFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`Report: ${reportPath}`);
    } catch (err) {
      console.warn(
        "[harness] failed to write JSON report (continuing):",
        err instanceof Error ? err.message : err
      );
    }
  }

  Deno.exit(report.failed > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
