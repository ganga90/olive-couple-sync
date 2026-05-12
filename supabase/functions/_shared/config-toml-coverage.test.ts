// Tests that supabase/config.toml lists every deployed edge function.
//
// Why this test exists
// ────────────────────
// Supabase Functions default `verify_jwt = true`. The repo convention
// is that most functions authenticate from body.user_id with a
// service-role client they build internally, so they're explicitly
// registered as `verify_jwt = false`. A handful are deliberately kept
// at `verify_jwt = true` — cron-only targets and admin utilities where
// the extra gateway check is genuinely useful and no server-to-server
// caller forwards a non-Supabase JWT. Either way, every function on
// disk MUST appear in config.toml so the deployed state is
// reproducible from `git`. Functions without an explicit entry inherit
// the `verify_jwt = true` default — which is what bit us on 2026-05-12.
//
// On 2026-05-12 the `calendar-update-event`, `calendar-delete-event`,
// `calendar-watch-register`, `calendar-watch-renew`, and
// `calendar-sync-retry` functions had no entry in config.toml. They
// silently inherited `verify_jwt = true`. When `ask-olive-stream`
// invoked `calendar-update-event` server-to-server with a Clerk-bearing
// auth header (Clerk JWTs are not Supabase JWTs and don't pass the
// gateway's JWT check), the Supabase gateway 401'd at the edge before
// the function body could run — bypassing the `olive_calendar_sync_log`
// telemetry, the retry queue, and every other Phase 2.1 safety net.
// The end user saw "but I couldn't reach Google Calendar this time"
// with no recourse.
//
// This test fails the build the moment a new function directory is
// added under `supabase/functions/` without a matching config.toml
// entry. It can't infer which value (`true` or `false`) is right for
// a given function — that's a deliberate human choice tied to who can
// call it and how — but it does catch the much commoner failure mode
// of "I forgot to register the function at all."

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { basename } from "https://deno.land/std@0.224.0/path/mod.ts";

// Path is relative to the project root — Deno tests run with the
// project root as CWD per the deno.json task definition.
const CONFIG_TOML_PATH = "supabase/config.toml";
const FUNCTIONS_DIR = "supabase/functions";

// _shared is utilities, not a deployable function — no config entry expected.
// Add to this set if a future utility-only directory appears.
const NON_FUNCTION_DIRS = new Set(["_shared"]);

// Pre-existing legacy gaps as of the 2026-05-12 fix. These functions
// were deployed without a config.toml entry long before the test
// existed; they all happen to self-authenticate via SERVICE_ROLE_KEY +
// body.user_id (same pattern as the recently-added calendar functions),
// so they likely also default to `verify_jwt = true` at the gateway
// without obvious symptoms because nothing else invokes them
// server-to-server with a non-Supabase auth header.
//
// **DO NOT add new entries here.** Each name in this list should be
// removed by registering it properly in config.toml. The list shrinks,
// it doesn't grow. New functions that lack config entries will fail
// the test immediately — which is the whole point.
const KNOWN_LEGACY_STRAGGLERS = new Set([
  "clerk-sync",
  "daily-pulse",
  "olive-collaboration",
  "olive-community-detect",
  "olive-compile-memory",
  "olive-knowledge-extract",
  "olive-memory-maintenance",
  "olive-prompt-evolve",
  "olive-reflect",
  "olive-soul-evolve",
  "olive-soul-seed",
  "olive-space-manage",
  "olive-trust-gate",
  "onboarding-finalize",
  "process-receipt",
  "repair-embeddings",
  "save-link",
  "send-invite",
]);

async function listFunctionDirs(): Promise<string[]> {
  const dirs: string[] = [];
  for await (const entry of walk(FUNCTIONS_DIR, { maxDepth: 1, includeFiles: false, includeDirs: true })) {
    // walk yields the root dir first — skip it.
    if (entry.path === FUNCTIONS_DIR) continue;
    const name = basename(entry.path);
    if (NON_FUNCTION_DIRS.has(name)) continue;
    dirs.push(name);
  }
  return dirs.sort();
}

async function listConfiguredFunctions(): Promise<Set<string>> {
  const content = await Deno.readTextFile(CONFIG_TOML_PATH);
  // Match `[functions.<name>]` headers. Names are kebab-case
  // identifiers; the regex is intentionally strict so we don't false-
  // match a malformed line (e.g. an inline comment containing the
  // string `[functions.x]`).
  const re = /^\[functions\.([a-zA-Z0-9_-]+)\]\s*$/gm;
  const names = new Set<string>();
  for (const m of content.matchAll(re)) names.add(m[1]);
  return names;
}

Deno.test("config-toml-coverage: every edge function directory has a [functions.X] entry in config.toml", async () => {
  const onDisk = await listFunctionDirs();
  const configured = await listConfiguredFunctions();

  const missing = onDisk.filter(
    (name) => !configured.has(name) && !KNOWN_LEGACY_STRAGGLERS.has(name),
  );

  if (missing.length > 0) {
    const list = missing.map((n) => `  - [functions.${n}]`).join("\n");
    throw new Error(
      `${missing.length} edge function(s) on disk are not registered in ` +
      `supabase/config.toml. Without an explicit entry they inherit the ` +
      `Supabase default \`verify_jwt = true\` and will 401 when invoked ` +
      `server-to-server. Add a block for each:\n${list}\n\n` +
      `(If a function legitimately needs verify_jwt = true, add it with ` +
      `that value — the test only requires the entry to exist.)`,
    );
  }

  // Sanity check: we found at least the well-known functions. Without
  // this, a misconfigured walker that yields nothing would still pass.
  assert(onDisk.length >= 10, `expected ≥10 function dirs on disk, found ${onDisk.length}`);
  assert(configured.size >= 10, `expected ≥10 configured functions, found ${configured.size}`);
});

Deno.test("config-toml-coverage: KNOWN_LEGACY_STRAGGLERS only contains functions that actually exist on disk", async () => {
  // Catches the case where a straggler gets fixed (good!) but the
  // allow-list entry is forgotten. Without this check, the list would
  // silently accumulate dead names.
  const onDisk = new Set(await listFunctionDirs());
  const ghost = [...KNOWN_LEGACY_STRAGGLERS].filter((name) => !onDisk.has(name));
  assertEquals(
    ghost,
    [],
    `KNOWN_LEGACY_STRAGGLERS lists ${ghost.length} function(s) that no longer exist: ` +
    `${ghost.join(", ")}. Remove them from the allow-list.`,
  );
});

Deno.test("config-toml-coverage: KNOWN_LEGACY_STRAGGLERS shrinks — entries in the allow-list with a real config.toml entry should be removed", async () => {
  // Catches the inverse: a function gets registered in config.toml
  // (good!) but the allow-list entry is left in place. The list should
  // only contain unregistered functions.
  const configured = await listConfiguredFunctions();
  const overlap = [...KNOWN_LEGACY_STRAGGLERS].filter((name) => configured.has(name));
  assertEquals(
    overlap,
    [],
    `${overlap.length} function(s) appear in BOTH KNOWN_LEGACY_STRAGGLERS and ` +
    `config.toml: ${overlap.join(", ")}. Remove them from the allow-list — ` +
    `the goal is for it to shrink to zero.`,
  );
});

Deno.test("config-toml-coverage: no stale [functions.X] entries pointing at deleted functions", async () => {
  const onDisk = new Set(await listFunctionDirs());
  const configured = await listConfiguredFunctions();

  const stale = [...configured].filter((name) => !onDisk.has(name));

  assertEquals(
    stale,
    [],
    `config.toml registers ${stale.length} function(s) that no longer exist ` +
    `on disk: ${stale.join(", ")}. Remove the stale [functions.X] block(s).`,
  );
});
