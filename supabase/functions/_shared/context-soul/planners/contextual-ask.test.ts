/**
 * Tests for the CONTEXTUAL_ASK planner.
 *
 * Coverage:
 *   1. Empty query → empty result with breadcrumb
 *   2. Vector path: embedder provided + RPC returns hits → vector-search
 *      breadcrumb, hydrated content in output
 *   3. Vector path failure → falls through to keyword
 *   4. Keyword path: extracts significant words, runs textSearch,
 *      hydrates results
 *   5. No matches anywhere → empty result with no-matches breadcrumb
 *   6. Hydrate failure → empty result with hydrate-empty breadcrumb
 *   7. Full content is included only when it adds info beyond summary
 *   8. Long original_text is capped to ~240 chars
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { assembleContextSoul } from "../index.ts";

interface Recorded {
  table?: string;
  rpc?: string;
  filters: Record<string, unknown>;
}

interface Behavior {
  rpcResult?: { data?: unknown[]; error?: unknown };
  rpcThrows?: boolean;
  keywordResult?: { data?: unknown[]; error?: unknown };
  hydrateResult?: { data?: unknown[]; error?: unknown };
}

function makeFake(behavior: Behavior, log: Recorded[]) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      log.push({ rpc: name, filters: args });
      if (behavior.rpcThrows) throw new Error("simulated rpc failure");
      return Promise.resolve(behavior.rpcResult ?? { data: [], error: null });
    },
    from(table: string) {
      const recorded: Recorded = { table, filters: {} };
      log.push(recorded);
      const ret: any = {
        select(_cols?: string) { return ret; },
        eq(c: string, v: unknown) { recorded.filters[`eq_${c}`] = v; return ret; },
        in(c: string, v: unknown) { recorded.filters[`in_${c}`] = v; return ret; },
        or(filter: string) { recorded.filters["or"] = filter; return ret; },
        order(_c: string, _opts?: unknown) { return ret; },
        textSearch(c: string, q: string, _opts?: unknown) {
          recorded.filters[`textSearch_${c}`] = q;
          return ret;
        },
        async limit(_n: number) {
          // Distinguish hydrate (.in('id', ...)) from keyword search
          // (.textSearch). The hydrate query uses .in() and the
          // keyword path uses .textSearch().
          if (recorded.filters["in_id"]) {
            return behavior.hydrateResult ?? { data: [], error: null };
          }
          if (recorded.filters["textSearch_summary"]) {
            return behavior.keywordResult ?? { data: [], error: null };
          }
          return { data: [], error: null };
        },
      };
      return ret;
    },
  };
}

// ─── Empty / no-op ─────────────────────────────────────────────────

Deno.test("contextual-ask planner: empty query → no-query breadcrumb", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({}, log);
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", { userId: "u1", query: "" });
  assertEquals(r.prompt, "");
  assertEquals(r.sectionsLoaded.includes("no-query"), true);
});

Deno.test("contextual-ask planner: stop-words-only query → no-keywords breadcrumb (no embedder)", async () => {
  const log: Recorded[] = [];
  const sb = makeFake({}, log);
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "is it the?",
  });
  assertEquals(r.sectionsLoaded.includes("no-keywords"), true);
});

// ─── Vector path ───────────────────────────────────────────────────

Deno.test("contextual-ask planner: vector search returns hits, hydrates, formats", async () => {
  const log: Recorded[] = [];
  const sb = makeFake(
    {
      rpcResult: {
        data: [
          { id: "n1", summary: "Flight to Rome", similarity: 0.91 },
          { id: "n2", summary: "Hotel reservation", similarity: 0.82 },
        ],
      },
      hydrateResult: {
        data: [
          {
            id: "n1",
            summary: "Flight to Rome",
            original_text: "Flight to Rome on June 12 — Delta DL451, leaves JFK 8pm",
            category: "travel",
            due_date: null,
            completed: false,
          },
          {
            id: "n2",
            summary: "Hotel reservation",
            original_text: "Hotel reservation",
            category: "travel",
            due_date: null,
            completed: false,
          },
        ],
      },
    },
    log,
  );
  const fakeEmbedder = async (_t: string) => Array(768).fill(0);
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    coupleId: "11111111-1111-1111-1111-111111111111",
    query: "when do I land in Rome",
    generateEmbedding: fakeEmbedder,
  });

  assertEquals(r.sectionsLoaded.includes("vector-search"), true);
  assertEquals(r.prompt.includes("Flight to Rome"), true);
  // Full details surfaced because original_text differs from summary
  assertEquals(r.prompt.includes("Delta DL451"), true);
  // Hotel: original_text matches summary, so full details should be omitted
  // (we should NOT see a duplicate "Full details: Hotel reservation")
  const hotelOccurrences = (r.prompt.match(/Hotel reservation/g) || []).length;
  assertEquals(hotelOccurrences, 1);
});

Deno.test("contextual-ask planner: vector RPC throws → falls back to keyword", async () => {
  const log: Recorded[] = [];
  const sb = makeFake(
    {
      rpcThrows: true,
      keywordResult: { data: [{ id: "n9" }] },
      hydrateResult: {
        data: [{
          id: "n9",
          summary: "Wifi password is HelloWorld123",
          original_text: "Wifi password is HelloWorld123",
          category: "trip",
          due_date: null,
          completed: false,
        }],
      },
    },
    log,
  );
  const fakeEmbedder = async (_t: string) => Array(768).fill(0);
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "wifi password airbnb",
    generateEmbedding: fakeEmbedder,
  });
  assertEquals(r.sectionsLoaded.includes("keyword-search"), true);
  assertEquals(r.prompt.includes("HelloWorld123"), true);
});

// ─── Keyword path (no embedder) ────────────────────────────────────

Deno.test("contextual-ask planner: no embedder → keyword search runs immediately", async () => {
  const log: Recorded[] = [];
  const sb = makeFake(
    {
      keywordResult: { data: [{ id: "n5" }] },
      hydrateResult: {
        data: [{
          id: "n5",
          summary: "Anniversary May 14",
          original_text: "Anniversary May 14 — wedding anniversary",
          category: "personal",
          due_date: null,
          completed: false,
        }],
      },
    },
    log,
  );
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "when is our anniversary",
  });
  assertEquals(r.sectionsLoaded.includes("keyword-search"), true);
  // No vector-search breadcrumb since embedder wasn't provided
  assertEquals(r.sectionsLoaded.includes("vector-search"), false);
  assertEquals(r.prompt.includes("May 14"), true);
});

// ─── No matches ────────────────────────────────────────────────────

Deno.test("contextual-ask planner: no matches anywhere → no-matches breadcrumb", async () => {
  const log: Recorded[] = [];
  const sb = makeFake(
    {
      keywordResult: { data: [] },
      hydrateResult: { data: [] },
    },
    log,
  );
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "this question matches nothing in saved data",
  });
  assertEquals(r.prompt, "");
  assertEquals(r.sectionsLoaded.includes("no-matches"), true);
});

// ─── Hydrate empty ─────────────────────────────────────────────────

Deno.test("contextual-ask planner: hits found but hydrate returns empty → hydrate-empty", async () => {
  const log: Recorded[] = [];
  const sb = makeFake(
    {
      keywordResult: { data: [{ id: "n1" }] },
      hydrateResult: { data: [] },
    },
    log,
  );
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "test query keyword",
  });
  assertEquals(r.sectionsLoaded.includes("hydrate-empty"), true);
  assertEquals(r.prompt, "");
});

// ─── Long bodies ───────────────────────────────────────────────────

Deno.test("contextual-ask planner: caps long original_text at ~240 chars", async () => {
  const log: Recorded[] = [];
  const longBody = "x".repeat(500);
  const sb = makeFake(
    {
      keywordResult: { data: [{ id: "long" }] },
      hydrateResult: {
        data: [{
          id: "long",
          summary: "short summary",
          original_text: longBody,
          category: "test",
          due_date: null,
          completed: false,
        }],
      },
    },
    log,
  );
  const r = await assembleContextSoul(sb, "CONTEXTUAL_ASK", {
    userId: "u1",
    query: "long body test",
  });
  // The cap leaves an "..." marker
  assertEquals(r.prompt.includes("..."), true);
  // Total prompt length must be sane (well under 5K chars)
  assertEquals(r.prompt.length < 5000, true);
});
