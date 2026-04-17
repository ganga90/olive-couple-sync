/**
 * Unit tests for the Context Contract (Phase 1 Task 1-A).
 * Run with: deno test supabase/functions/_shared/context-contract.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  assembleContext,
  estimateTokens,
  getSlotTokenLog,
  STANDARD_CONTRACT,
  STANDARD_BUDGET,
  EMERGENCY_BUDGET,
  type ContextSlot,
} from "./context-contract.ts";

// ─── estimateTokens ────────────────────────────────────────────────

Deno.test("estimateTokens: empty string is 0", () => {
  assertEquals(estimateTokens(""), 0);
});

Deno.test("estimateTokens: rounds up at 4 chars/token", () => {
  assertEquals(estimateTokens("abcd"), 1);
  assertEquals(estimateTokens("abcde"), 2); // 5/4 = 1.25 → 2
  assertEquals(estimateTokens("a".repeat(400)), 100);
});

// ─── assembleContext: happy paths ──────────────────────────────────

Deno.test("assembleContext: small inputs fit without truncation or drops", () => {
  const result = assembleContext({
    IDENTITY: "You are Olive.",
    QUERY: "What's my next task?",
    USER_COMPILED: "Profile: prefers mornings.",
    DYNAMIC: "Calendar: meeting at 10am.",
  });

  assertEquals(result.truncatedSlots.length, 0);
  assertEquals(result.droppedSlots.length, 0);
  assertEquals(result.emergency, false);
  assertEquals(result.degraded, false);
  assertEquals(result.missingRequired.length, 0);
  assert(result.prompt.includes("You are Olive."));
  assert(result.prompt.includes("What's my next task?"));
  assert(result.prompt.includes("Profile: prefers mornings."));
});

Deno.test("assembleContext: slots appear in contract order in the assembled prompt", () => {
  const result = assembleContext({
    HISTORY: "HIST_CONTENT",
    QUERY: "QUERY_CONTENT",
    IDENTITY: "IDENT_CONTENT",
    DYNAMIC: "DYN_CONTENT",
  });

  const idxIdent = result.prompt.indexOf("IDENT_CONTENT");
  const idxQuery = result.prompt.indexOf("QUERY_CONTENT");
  const idxDyn = result.prompt.indexOf("DYN_CONTENT");
  const idxHist = result.prompt.indexOf("HIST_CONTENT");

  // Contract order: IDENTITY, QUERY, USER_COMPILED, INTENT_MODULE, TOOLS, DYNAMIC, HISTORY.
  assert(idxIdent < idxQuery, "IDENTITY should precede QUERY");
  assert(idxQuery < idxDyn, "QUERY should precede DYNAMIC");
  assert(idxDyn < idxHist, "DYNAMIC should precede HISTORY");
});

// ─── Truncation ────────────────────────────────────────────────────

Deno.test("assembleContext: oversized slot is truncated to its max", () => {
  // QUERY slot has maxTokens=400, so ~1600 chars.
  const longQuery = "a ".repeat(2000); // 4000 chars, ~1000 tokens
  const result = assembleContext({
    IDENTITY: "You are Olive.",
    QUERY: longQuery,
  });

  const querySlot = result.slots.find((s) => s.name === "QUERY")!;
  assert(querySlot.truncated, "QUERY should be truncated");
  assert(
    querySlot.tokens <= 405,
    `QUERY tokens (${querySlot.tokens}) should be near max 400`
  );
  assert(result.truncatedSlots.includes("QUERY"));
  assert(querySlot.content.includes("(truncated)"), "Truncation marker should be present");
});

Deno.test("assembleContext: truncation prefers sentence boundaries", () => {
  // Build a string that clearly has multiple sentences within the budget window.
  // maxTokens * 4 = 1600 chars for QUERY. First sentence ends well before 1600.
  const sentence = "This is a sentence. ".repeat(100); // 2000 chars
  const result = assembleContext({
    IDENTITY: "Hi",
    QUERY: sentence,
  });

  const q = result.slots.find((s) => s.name === "QUERY")!;
  // Should end at a period+space boundary (not mid-word) before the marker.
  assert(q.content.includes(". \n...(truncated)") || q.content.includes(".\n...(truncated)"));
});

// ─── Priority-based dropping ───────────────────────────────────────

Deno.test("assembleContext: drops lowest-priority first when over budget", () => {
  // Craft inputs so the total is JUST over budget. Each slot maxes out at
  // its full budget allocation. STANDARD_BUDGET = 3200 tokens.
  // Filling all slots to their max gives:
  //   200 + 400 + 650 + 250 + 300 + 800 + 600 = 3200 (exactly at budget).
  // To force a drop we need to push just over. We'll stuff USER_COMPILED
  // above its max, so it gets truncated AND the others are also at max,
  // pushing us over.
  const slotContents: Record<string, string> = {
    IDENTITY: "x".repeat(800),       // ~200 tokens max
    QUERY: "x".repeat(1600),          // ~400 tokens max
    USER_COMPILED: "x".repeat(2600),  // ~650 tokens max
    INTENT_MODULE: "x".repeat(1000),  // ~250 tokens max
    TOOLS: "x".repeat(1200),          // ~300 tokens max
    DYNAMIC: "x".repeat(3200),        // ~800 tokens max
    HISTORY: "x".repeat(2400),        // ~600 tokens max
  };

  // Push budget down to force dropping.
  const tightBudget = 2000;
  const result = assembleContext(slotContents, STANDARD_CONTRACT, tightBudget);

  // HISTORY (priority 4) must be dropped before DYNAMIC (priority 3).
  assert(
    result.droppedSlots.includes("HISTORY"),
    `HISTORY (priority 4) must be dropped first — droppedSlots: ${result.droppedSlots.join(",")}`
  );

  // Required slots (IDENTITY, QUERY) must NEVER be dropped.
  assert(!result.droppedSlots.includes("IDENTITY"));
  assert(!result.droppedSlots.includes("QUERY"));

  assert(result.degraded, "degraded flag should be set when any slot is dropped");
  assertEquals(result.totalTokens <= tightBudget, true);
});

Deno.test("assembleContext: emergency flag is true only when DYNAMIC is dropped", () => {
  // Force a very tight budget that drops DYNAMIC.
  const slotContents: Record<string, string> = {
    IDENTITY: "x".repeat(800),
    QUERY: "x".repeat(1600),
    USER_COMPILED: "x".repeat(2600),
    DYNAMIC: "x".repeat(3200),
    HISTORY: "x".repeat(2400),
  };

  const result = assembleContext(slotContents, STANDARD_CONTRACT, EMERGENCY_BUDGET);
  if (result.droppedSlots.includes("DYNAMIC")) {
    assertEquals(result.emergency, true);
  } else {
    assertEquals(result.emergency, false);
  }
});

// ─── Required-slot contract violations ─────────────────────────────

Deno.test("assembleContext: empty required slot surfaced in missingRequired", () => {
  const result = assembleContext({
    // IDENTITY missing
    QUERY: "hello",
  });
  assert(
    result.missingRequired.includes("IDENTITY"),
    `missingRequired should include IDENTITY, got: ${result.missingRequired.join(",")}`
  );
});

Deno.test("assembleContext: missingRequired is empty when both required slots are filled", () => {
  const result = assembleContext({
    IDENTITY: "You are Olive.",
    QUERY: "hello",
  });
  assertEquals(result.missingRequired.length, 0);
});

// ─── getSlotTokenLog ───────────────────────────────────────────────

Deno.test("getSlotTokenLog: returns per-slot token map", () => {
  const result = assembleContext({
    IDENTITY: "You are Olive.",
    QUERY: "hi",
  });
  const log = getSlotTokenLog(result);
  // Must include an entry for every slot in the contract (including empties).
  for (const slot of STANDARD_CONTRACT) {
    assert(
      slot.name in log,
      `log should include ${slot.name}`
    );
  }
  // IDENTITY had content, should have non-zero tokens.
  assert(log.IDENTITY > 0);
  assertEquals(log.USER_COMPILED, 0);
});

// ─── Custom contract ───────────────────────────────────────────────

Deno.test("assembleContext: honors a custom contract", () => {
  const customContract: ContextSlot[] = [
    { name: "MINI", priority: 1, maxTokens: 50, required: true },
    { name: "OPTIONAL", priority: 3, maxTokens: 50, required: false },
  ];
  const result = assembleContext(
    { MINI: "hello world", OPTIONAL: "aux" },
    customContract,
    100
  );
  assertEquals(result.missingRequired.length, 0);
  assert(result.prompt.includes("hello world"));
  assert(result.prompt.includes("aux"));
});
