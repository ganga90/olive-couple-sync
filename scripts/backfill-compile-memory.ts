/**
 * backfill-compile-memory.ts
 * ==========================
 * One-shot remediation script for the 02:00 UTC `olive-compile-memory`
 * batch failures (Bucket 1).
 *
 * For every user that had at least one `status='error'` row in
 * `olive_llm_calls` for `function_name='olive-compile-memory'` since
 * `--since`, re-invokes `compile_user` with `force: true` so the user
 * gets a fresh set of compiled artifacts on the new pacing + retry
 * path.
 *
 * Invocation:
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
 *   SUPABASE_FUNCTION_URL=https://xxxx.functions.supabase.co \
 *   deno run --allow-net --allow-env scripts/backfill-compile-memory.ts \
 *     --since 2026-04-30
 *
 * Required env:
 *   - SUPABASE_URL                — for the query against olive_llm_calls
 *   - SUPABASE_SERVICE_ROLE_KEY   — service-role key (RLS bypass)
 *   - SUPABASE_FUNCTION_URL       — base URL of deployed edge functions
 *                                   (e.g. https://<ref>.functions.supabase.co)
 *
 * Flags:
 *   --since <ISO-date>            — earliest created_at to consider
 *                                   (default: 14 days ago)
 *   --dry-run                     — print users that would be recompiled
 *                                   without invoking the function
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface Args {
  since: string;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = Deno.args;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000)
    .toISOString()
    .slice(0, 10);
  let since = fourteenDaysAgo;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--since" && args[i + 1]) {
      since = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { since, dryRun };
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`Missing required env: ${name}`);
    Deno.exit(2);
  }
  return v;
}

async function main() {
  const { since, dryRun } = parseArgs();
  const SUPABASE_URL = requireEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const SUPABASE_FUNCTION_URL = requireEnv("SUPABASE_FUNCTION_URL");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log(
    `[backfill] Querying failed compile-memory calls since ${since}` +
      (dryRun ? " (dry-run)" : "")
  );

  // Pull distinct user_ids that had at least one error since `since`.
  // We page to keep memory bounded; failed-call volume is low (~60/14d
  // pre-fix), but the page guard is cheap.
  const failedUsers = new Set<string>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("olive_llm_calls")
      .select("user_id")
      .eq("function_name", "olive-compile-memory")
      .eq("status", "error")
      .gte("created_at", since)
      .not("user_id", "is", null)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("[backfill] Query failed:", error.message);
      Deno.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.user_id) failedUsers.add(row.user_id as string);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const userIds = Array.from(failedUsers).sort();
  console.log(`[backfill] ${userIds.length} unique users with failures`);

  if (userIds.length === 0) {
    console.log("[backfill] Nothing to do.");
    return;
  }

  // Snapshot per-user before/after error counts so we can print the summary
  // table the prompt asked for.
  const countErrors = async (
    userId: string
  ): Promise<{ success: number; error: number }> => {
    const { count: successCount } = await supabase
      .from("olive_llm_calls")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "olive-compile-memory")
      .eq("user_id", userId)
      .eq("status", "success")
      .gte("created_at", since);
    const { count: errorCount } = await supabase
      .from("olive_llm_calls")
      .select("id", { count: "exact", head: true })
      .eq("function_name", "olive-compile-memory")
      .eq("user_id", userId)
      .eq("status", "error")
      .gte("created_at", since);
    return { success: successCount ?? 0, error: errorCount ?? 0 };
  };

  const summary: Array<{
    user_id: string;
    before: { success: number; error: number };
    after: { success: number; error: number };
    invoke_status: string;
  }> = [];

  for (const userId of userIds) {
    const before = await countErrors(userId);

    if (dryRun) {
      summary.push({
        user_id: userId,
        before,
        after: before,
        invoke_status: "skipped (dry-run)",
      });
      continue;
    }

    let invokeStatus = "ok";
    try {
      const res = await fetch(
        `${SUPABASE_FUNCTION_URL.replace(/\/$/, "")}/olive-compile-memory`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Service role works for edge functions invoked this way.
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            action: "compile_user",
            user_id: userId,
            force: true,
          }),
        }
      );
      if (!res.ok) {
        invokeStatus = `http_${res.status}`;
        console.warn(
          `[backfill] ${userId}: invoke failed (${res.status} ${await res
            .text()
            .then((t) => t.slice(0, 200))})`
        );
      } else {
        const body = await res.json();
        invokeStatus = body?.success ? "ok" : `body_error: ${body?.error ?? "?"}`;
      }
    } catch (err) {
      invokeStatus = `throw: ${(err as Error).message?.slice(0, 120) ?? "?"}`;
    }

    const after = await countErrors(userId);
    summary.push({ user_id: userId, before, after, invoke_status: invokeStatus });

    console.log(
      `[backfill] ${userId}: ${invokeStatus} | before err=${before.error} ok=${before.success} → after err=${after.error} ok=${after.success}`
    );
  }

  // Final summary table
  console.log("\n=== Backfill Summary ===");
  console.log(
    "user_id".padEnd(36) +
      " | " +
      "before(ok/err)".padEnd(16) +
      " | " +
      "after(ok/err)".padEnd(16) +
      " | invoke"
  );
  console.log("-".repeat(100));
  for (const row of summary) {
    console.log(
      row.user_id.padEnd(36) +
        " | " +
        `${row.before.success}/${row.before.error}`.padEnd(16) +
        " | " +
        `${row.after.success}/${row.after.error}`.padEnd(16) +
        " | " +
        row.invoke_status
    );
  }
}

if (import.meta.main) {
  await main();
}
