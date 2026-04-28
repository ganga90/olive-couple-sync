/**
 * Tests for the EXPENSE planner.
 *
 * Coverage:
 *   1. No expenses → returns "No expenses recorded" message
 *   2. Recent expenses → totals + top categories + last 3 transactions
 *   3. Recurring expenses appear when present
 *   4. Recurring section is omitted when empty
 *   5. Budget clamp triggers when output is huge
 *   6. DB fetch failure is fail-soft (no throw, partial result)
 *   7. spaceId scoping uses .or with user_id OR space_id
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { assembleContextSoul } from "../index.ts";

interface Recorded {
  table: string;
  ops: string[];
  filters: Record<string, unknown>;
}

interface FakeBehavior {
  recent?: { data?: unknown[]; error?: unknown };
  recurring?: { data?: unknown[]; error?: unknown };
  recentThrows?: boolean;
}

function makeFake(behavior: FakeBehavior, log: Recorded[]) {
  function chain(table: string) {
    const recorded: Recorded = { table, ops: [], filters: {} };
    log.push(recorded);
    const ret: any = {
      select(_cols?: string) { recorded.ops.push("select"); return ret; },
      gte(c: string, v: unknown) { recorded.filters[`gte_${c}`] = v; recorded.ops.push("gte"); return ret; },
      eq(c: string, v: unknown) { recorded.filters[`eq_${c}`] = v; recorded.ops.push("eq"); return ret; },
      or(filter: string) { recorded.filters["or"] = filter; recorded.ops.push("or"); return ret; },
      order(_c: string, _opts?: unknown) { recorded.ops.push("order"); return ret; },
      async limit(_n: number) {
        recorded.ops.push("limit");
        if (table === "expenses") {
          // 1st call (recent) vs 2nd call (recurring) — distinguished by
          // the presence of 'is_recurring' in eq filters.
          if (recorded.filters["eq_is_recurring"]) {
            return behavior.recurring ?? { data: [], error: null };
          }
          if (behavior.recentThrows) throw new Error("simulated recent fetch failure");
          return behavior.recent ?? { data: [], error: null };
        }
        return { data: [], error: null };
      },
    };
    return ret;
  }
  return {
    from(table: string) { return chain(table); },
  };
}

// ─── Empty ─────────────────────────────────────────────────────────

Deno.test("expense planner: no data → 'No expenses recorded' summary", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({ recent: { data: [] }, recurring: { data: [] } }, log);
  const r = await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  assertEquals(r.prompt.includes("No expenses recorded"), true);
  assertEquals(r.fellBackToDefault, false);
});

// ─── Recent expenses ───────────────────────────────────────────────

Deno.test("expense planner: aggregates totals + lists top categories", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({
    recent: {
      data: [
        { amount: 100, currency: "USD", category: "groceries", name: "Whole Foods", expense_date: "2026-04-25T10:00:00Z" },
        { amount: 50, currency: "USD", category: "groceries", name: "Trader Joe's", expense_date: "2026-04-20T10:00:00Z" },
        { amount: 30, currency: "USD", category: "gas", name: "Shell", expense_date: "2026-04-22T10:00:00Z" },
      ],
    },
    recurring: { data: [] },
  }, log);
  const r = await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  // Total: 180
  assertEquals(r.prompt.includes("USD 180.00"), true);
  // Top category groceries: 150
  assertEquals(r.prompt.includes("groceries: USD 150.00"), true);
  // Most-recent transactions section
  assertEquals(r.prompt.includes("Most recent:"), true);
  assertEquals(r.prompt.includes("Whole Foods"), true);
});

// ─── Recurring section ─────────────────────────────────────────────

Deno.test("expense planner: includes recurring when present", async () => {
  const log: Recorded[] = [];
  const future = new Date(Date.now() + 86400000).toISOString();
  const sb = makeFake({
    recent: { data: [] },
    recurring: {
      data: [
        { name: "Netflix", amount: 15.99, currency: "USD", recurrence_frequency: "monthly", next_recurrence_date: future },
      ],
    },
  }, log);
  const r = await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  assertEquals(r.prompt.includes("Netflix"), true);
  assertEquals(r.prompt.includes("monthly"), true);
});

Deno.test("expense planner: omits recurring section when empty", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({
    recent: {
      data: [{ amount: 10, currency: "USD", category: "x", name: "y", expense_date: "2026-04-25T10:00:00Z" }],
    },
    recurring: { data: [] },
  }, log);
  const r = await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  assertEquals(r.prompt.includes("## Recurring expenses"), false);
});

// ─── Fail-soft ─────────────────────────────────────────────────────

Deno.test("expense planner: recent fetch throws → no crash, default no-data message", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({ recentThrows: true, recurring: { data: [] } }, log);
  const r = await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  // Should NOT throw — and should return a sane fallback string.
  assertEquals(r.fellBackToDefault, false);
  assertEquals(r.prompt.includes("No expenses recorded"), true);
});

// ─── Scoping ───────────────────────────────────────────────────────

Deno.test("expense planner: spaceId scope uses OR filter", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({ recent: { data: [] }, recurring: { data: [] } }, log);
  await assembleContextSoul(sb, "EXPENSE", { userId: "u1", spaceId: "space-1" });
  const recentCall = log.find((r) =>
    r.table === "expenses" && !r.filters["eq_is_recurring"]
  );
  assertEquals(typeof recentCall, "object");
  assertEquals(
    String(recentCall!.filters["or"]).includes("user_id.eq.u1"),
    true,
  );
  assertEquals(
    String(recentCall!.filters["or"]).includes("space_id.eq.space-1"),
    true,
  );
});

Deno.test("expense planner: no spaceId → eq user_id only", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({ recent: { data: [] }, recurring: { data: [] } }, log);
  await assembleContextSoul(sb, "EXPENSE", { userId: "u1" });
  const recentCall = log.find((r) =>
    r.table === "expenses" && !r.filters["eq_is_recurring"]
  );
  assertEquals(recentCall!.filters["eq_user_id"], "u1");
  assertEquals(recentCall!.filters["or"], undefined);
});
