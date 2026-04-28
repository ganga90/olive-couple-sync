/**
 * Unit tests for the Context Soul (Layer 4) framework.
 *
 * Pinned guarantees:
 *   1. Budget helpers are deterministic and clamp at the right point
 *   2. Registry CRUD round-trips cleanly
 *   3. Dispatcher returns empty (not throws) on:
 *      - missing userId
 *      - unknown intent (delegates to DEFAULT)
 *      - planner throwing
 *   4. fellBackToDefault flag is set correctly per case
 *   5. Default planner returns the expected no-op shape
 *   6. registerPlanner is last-write-wins (test fixtures can override)
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildBudgetedSection,
  clampToBudget,
  estimateTokens,
} from "./budget.ts";
import {
  _clearRegistryForTesting,
  getPlanner,
  listIntents,
  registerPlanner,
} from "./registry.ts";
import { assembleContextSoul } from "./index.ts";
import type { ContextSoulPlanner } from "./types.ts";

// ─── Budget ────────────────────────────────────────────────────────

Deno.test("estimateTokens: ~1 token per 4 chars", () => {
  assertEquals(estimateTokens(""), 0);
  assertEquals(estimateTokens("abcd"), 1);
  assertEquals(estimateTokens("abcde"), 2); // ceiling
  assertEquals(estimateTokens("a".repeat(40)), 10);
});

Deno.test("clampToBudget: returns text unchanged when under budget", () => {
  const text = "short";
  assertEquals(clampToBudget(text, 100), text);
});

Deno.test("clampToBudget: truncates with marker when over budget", () => {
  // 200 chars, 50 token budget → 200 chars allowed → exactly fits
  const exactly = "a".repeat(200);
  assertEquals(clampToBudget(exactly, 50).length, 200);

  // 300 chars, 50 token budget → 200 chars allowed → must truncate
  const over = "a".repeat(300);
  const clamped = clampToBudget(over, 50);
  // Total length must NOT exceed maxChars (50 * 4 = 200)
  assertEquals(clamped.length <= 200, true);
  // Must end with the truncation marker
  assertEquals(clamped.includes("[truncated]"), true);
});

Deno.test("clampToBudget: zero/negative budget → empty string", () => {
  assertEquals(clampToBudget("anything", 0), "");
  assertEquals(clampToBudget("anything", -1), "");
});

Deno.test("buildBudgetedSection: empty title omits ## prefix", () => {
  const r = buildBudgetedSection("", "body", 100);
  assertEquals(r.text, "body");
});

Deno.test("buildBudgetedSection: with title prepends ## heading", () => {
  const r = buildBudgetedSection("Recent expenses", "no data", 100);
  assertEquals(r.text.startsWith("## Recent expenses\n"), true);
  // Token estimate is sane and positive
  assertEquals(r.tokens > 0, true);
});

// ─── Registry ──────────────────────────────────────────────────────

Deno.test("registry: register + getPlanner round-trip", () => {
  // Snapshot existing state so we don't poison subsequent tests
  const beforeIntents = listIntents();

  const fakeFn: ContextSoulPlanner = async (_sb, _p) => ({
    prompt: "fake",
    tokensUsed: 1,
    sectionsLoaded: ["fake"],
    fellBackToDefault: false,
  });

  registerPlanner("EXPENSE", fakeFn);
  assertEquals(getPlanner("EXPENSE"), fakeFn);

  // Restore: unregister by registering a no-op (we don't expose
  // delete; clean state is via _clearRegistryForTesting which
  // wipes ALL — too aggressive for this test).
  // For now leave EXPENSE registered to a fake; later tests don't
  // depend on EXPENSE being absent.
  assertEquals(listIntents().length >= beforeIntents.length, true);
});

Deno.test("registry: getPlanner returns null for unregistered", () => {
  // GROUP_RECAP isn't registered in C-4.a — only DEFAULT is from the
  // side-effect import in index.ts (assuming index.ts has been
  // imported by `assembleContextSoul` test below; that import is
  // shared across the test file so the side-effect has fired).
  assertEquals(getPlanner("GROUP_RECAP"), null);
});

Deno.test("registry: last-write-wins on registerPlanner", () => {
  const a: ContextSoulPlanner = async () => ({
    prompt: "a",
    tokensUsed: 1,
    sectionsLoaded: ["a"],
    fellBackToDefault: false,
  });
  const b: ContextSoulPlanner = async () => ({
    prompt: "b",
    tokensUsed: 1,
    sectionsLoaded: ["b"],
    fellBackToDefault: false,
  });
  registerPlanner("CHAT", a);
  registerPlanner("CHAT", b);
  assertEquals(getPlanner("CHAT"), b);
});

// ─── Dispatcher ────────────────────────────────────────────────────

Deno.test("assembleContextSoul: missing userId → empty result", async () => {
  const r = await assembleContextSoul({} as unknown, "EXPENSE", {
    userId: "",
  });
  assertEquals(r.prompt, "");
  assertEquals(r.fellBackToDefault, true);
  assertEquals(r.sectionsLoaded.includes("error-missing-user"), true);
});

Deno.test("assembleContextSoul: unmapped intent falls back to DEFAULT", async () => {
  // After this test file has been loaded, index.ts side-effect
  // imports default.ts → DEFAULT is registered.
  const r = await assembleContextSoul({} as unknown, "TASK_ACTION", {
    userId: "user_x",
  });
  // The DEFAULT planner returns the no-op breadcrumb
  assertEquals(r.prompt, "");
  // fellBackToDefault is true because TASK_ACTION had no registered planner
  assertEquals(r.fellBackToDefault, true);
});

Deno.test("assembleContextSoul: registered planner runs and result is returned", async () => {
  const planner: ContextSoulPlanner = async (_sb, p) => ({
    prompt: `## Test for ${p.userId}\nhello`,
    tokensUsed: 5,
    sectionsLoaded: ["test"],
    fellBackToDefault: false,
  });
  registerPlanner("CREATE", planner);
  const r = await assembleContextSoul({} as unknown, "CREATE", {
    userId: "user_y",
  });
  assertEquals(r.prompt.includes("Test for user_y"), true);
  assertEquals(r.fellBackToDefault, false);
  assertEquals(r.sectionsLoaded.includes("test"), true);
});

Deno.test("assembleContextSoul: planner throws → empty result, never bubbles", async () => {
  const exploder: ContextSoulPlanner = async () => {
    throw new Error("simulated planner failure");
  };
  registerPlanner("WEB_SEARCH", exploder);

  // The dispatcher must catch and return empty — NOT throw.
  const r = await assembleContextSoul({} as unknown, "WEB_SEARCH", {
    userId: "user_z",
  });
  assertEquals(r.prompt, "");
  assertEquals(r.fellBackToDefault, true);
  assertEquals(r.sectionsLoaded.some((s) => s.startsWith("error-planner-")), true);
});

Deno.test("assembleContextSoul: defaults are applied to params", async () => {
  let captured: { spaceId: string | null; query: string; budgetTokens: number } | null = null;
  const inspect: ContextSoulPlanner = async (_sb, p) => {
    captured = { spaceId: p.spaceId, query: p.query, budgetTokens: p.budgetTokens };
    return { prompt: "ok", tokensUsed: 1, sectionsLoaded: [], fellBackToDefault: false };
  };
  registerPlanner("SEARCH", inspect);
  await assembleContextSoul({} as unknown, "SEARCH", { userId: "u" });
  assertNotEquals(captured, null);
  assertEquals(captured!.spaceId, null);
  assertEquals(captured!.query, "");
  assertEquals(captured!.budgetTokens > 0, true);
});

// ─── Default planner ───────────────────────────────────────────────

Deno.test("default planner: returns no-op shape with breadcrumb", async () => {
  // Reset CHAT/CREATE/SEARCH/WEB_SEARCH (overridden by tests above)
  // and then explicitly request DEFAULT
  const r = await assembleContextSoul({} as unknown, "DEFAULT", {
    userId: "user_default",
  });
  assertEquals(r.prompt, "");
  assertEquals(r.tokensUsed, 0);
  assertEquals(r.fellBackToDefault, true);
  assertEquals(r.sectionsLoaded.includes("default-noop"), true);
});
