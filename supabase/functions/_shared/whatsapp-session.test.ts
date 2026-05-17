// Co-located tests for touchGatewaySession.
//
// Strategy
//   Use a hand-built fake Supabase client that records the call
//   sequence and returns canned data. Two fixtures:
//     - "first-message" — no existing session row; helper inserts one
//       and then increments.
//     - "returning-user" — existing session row; helper skips insert
//       and goes straight to the increment RPC.
//   Plus failure-mode tests verifying the fire-and-forget contract:
//   every error path returns null without throwing.

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { touchGatewaySession } from "./whatsapp-session.ts";

// ────────────────────────────────────────────────────────────────────
// Test fixture helpers
// ────────────────────────────────────────────────────────────────────

type Op = string;

function makeFakeSupabase(opts: {
  // The result the chained `.from(...).select(...).maybeSingle()` call should yield.
  existingSession?: { id: string } | null;
  insertResult?: { data?: { id: string }; error?: { message: string } };
  rpcResult?: {
    data?: Array<{ message_count: number; total_messages_ever: number }>;
    error?: { message: string };
  };
  throwOnFrom?: boolean;
}) {
  const ops: Op[] = [];
  const supabase = {
    from(_table: string) {
      ops.push("from:" + _table);
      if (opts.throwOnFrom) throw new Error("simulated network blip");
      const chain = {
        select(_cols: string) { ops.push("select"); return chain; },
        eq(_col: string, _val: unknown) { ops.push("eq"); return chain; },
        order(_col: string, _opts: unknown) { ops.push("order"); return chain; },
        limit(_n: number) { ops.push("limit"); return chain; },
        async maybeSingle() {
          ops.push("maybeSingle");
          return { data: opts.existingSession ?? null };
        },
        insert(_row: unknown) {
          ops.push("insert");
          return {
            select(_cols: string) {
              ops.push("select-after-insert");
              return {
                async single() {
                  ops.push("single");
                  return opts.insertResult ?? { data: { id: "new-session-id" } };
                },
              };
            },
          };
        },
      };
      return chain;
    },
    async rpc(name: string, _args: unknown) {
      ops.push("rpc:" + name);
      return opts.rpcResult ?? { data: [{ message_count: 1, total_messages_ever: 1 }] };
    },
  };
  return { supabase, ops };
}

// ────────────────────────────────────────────────────────────────────
// Happy paths
// ────────────────────────────────────────────────────────────────────

Deno.test("touchGatewaySession: existing session → skips insert, increments via RPC", async () => {
  const { supabase, ops } = makeFakeSupabase({
    existingSession: { id: "existing-uuid" },
    rpcResult: { data: [{ message_count: 4, total_messages_ever: 21 }] },
  });

  const result = await touchGatewaySession(supabase, "user_test_1");

  assertEquals(result, { messageCount: 4, totalMessagesEver: 21 });
  // Insert path should NOT have run.
  assertEquals(ops.includes("insert"), false);
  assertEquals(ops.includes("rpc:increment_gateway_session_message"), true);
});

Deno.test("touchGatewaySession: first-time user → inserts then increments", async () => {
  const { supabase, ops } = makeFakeSupabase({
    existingSession: null,
    insertResult: { data: { id: "fresh-uuid" } },
    rpcResult: { data: [{ message_count: 1, total_messages_ever: 1 }] },
  });

  const result = await touchGatewaySession(supabase, "user_test_2");

  assertEquals(result, { messageCount: 1, totalMessagesEver: 1 });
  assertEquals(ops.includes("insert"), true);
  assertEquals(ops.includes("rpc:increment_gateway_session_message"), true);
});

// ────────────────────────────────────────────────────────────────────
// Failure paths — fire-and-forget contract (must return null, never throw)
// ────────────────────────────────────────────────────────────────────

Deno.test("touchGatewaySession: insert fails → returns null, no throw", async () => {
  const { supabase } = makeFakeSupabase({
    existingSession: null,
    insertResult: { error: { message: "FK violation" } },
  });

  // deno-lint-ignore no-explicit-any
  const result = await touchGatewaySession(supabase as any, "user_test_3");
  assertEquals(result, null);
});

Deno.test("touchGatewaySession: RPC fails → returns null, no throw", async () => {
  const { supabase } = makeFakeSupabase({
    existingSession: { id: "uuid" },
    rpcResult: { error: { message: "RPC down" } },
  });

  // deno-lint-ignore no-explicit-any
  const result = await touchGatewaySession(supabase as any, "user_test_4");
  assertEquals(result, null);
});

Deno.test("touchGatewaySession: RPC returns empty data → returns null", async () => {
  const { supabase } = makeFakeSupabase({
    existingSession: { id: "uuid" },
    rpcResult: { data: [] },
  });

  // deno-lint-ignore no-explicit-any
  const result = await touchGatewaySession(supabase as any, "user_test_5");
  assertEquals(result, null);
});

Deno.test("touchGatewaySession: client throws synchronously → caught, returns null", async () => {
  const { supabase } = makeFakeSupabase({ throwOnFrom: true });

  // deno-lint-ignore no-explicit-any
  const result = await touchGatewaySession(supabase as any, "user_test_6");
  assertEquals(result, null);
});
