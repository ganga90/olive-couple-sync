// Co-located tests for the WhatsApp outbound-context module.
//
// Coverage
//   1. extractTaskFromOutbound — pure parser, 7 format variants.
//   2. getOutboundContextWithTaskId — fast-path with DB fixture.
//   3. getRecentOutboundMessages — three-source aggregation
//      (profile primary, queue secondary, heartbeat tertiary) +
//      staleness gating + error-skip gating + DB failure soft-fail.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  extractTaskFromOutbound,
  getOutboundContextWithTaskId,
  getRecentOutboundMessages,
  type RecentOutbound,
} from "./whatsapp-outbound-context.ts";

// ────────────────────────────────────────────────────────────────────
// extractTaskFromOutbound — pure parser
// ────────────────────────────────────────────────────────────────────

function makeOutbound(content: string): RecentOutbound {
  return {
    type: "reminder",
    content,
    sent_at: new Date().toISOString(),
    source: "queue",
  };
}

Deno.test("extractTaskFromOutbound: empty content → null", () => {
  assertEquals(extractTaskFromOutbound(makeOutbound("")), null);
});

Deno.test("extractTaskFromOutbound: reminder with quoted task", () => {
  const out = extractTaskFromOutbound(makeOutbound('⏰ Reminder: "Buy milk" is due in 24 hours'));
  assertEquals(out, "Buy milk");
});

Deno.test("extractTaskFromOutbound: reminder unquoted (alt format)", () => {
  const out = extractTaskFromOutbound(makeOutbound('⏰ Reminder: Answer email from CHAI'));
  assertEquals(out, "Answer email from CHAI");
});

Deno.test("extractTaskFromOutbound: reminder unquoted with due suffix", () => {
  const out = extractTaskFromOutbound(makeOutbound('⏰ Reminder: Call dentist is due tomorrow'));
  assertStringIncludes(out!, "Call dentist");
});

Deno.test("extractTaskFromOutbound: nudge format (bullet)", () => {
  const out = extractTaskFromOutbound(makeOutbound("Here's a nudge:\n• Buy Christmas gifts\n"));
  assertEquals(out, "Buy Christmas gifts");
});

Deno.test("extractTaskFromOutbound: numbered briefing line with fire emoji", () => {
  const out = extractTaskFromOutbound(makeOutbound("Your morning briefing:\n1. Buy groceries 🔥\n"));
  assertEquals(out, "Buy groceries");
});

Deno.test("extractTaskFromOutbound: free-form text without recognised pattern → null", () => {
  assertEquals(extractTaskFromOutbound(makeOutbound("Just a hello message")), null);
});

// ────────────────────────────────────────────────────────────────────
// getOutboundContextWithTaskId — DB-backed fast path
// ────────────────────────────────────────────────────────────────────

function makeFakeProfileClient(opts: {
  ctx?: {
    task_id?: string;
    task_summary?: string;
    sent_at?: string;
    all_task_ids?: Array<{ id: string; summary: string }>;
  } | null;
  throwOnQuery?: boolean;
}) {
  return {
    from(_table: string) {
      const chain = {
        select(_cols: string) { return chain; },
        eq(_col: string, _val: unknown) { return chain; },
        async single() {
          if (opts.throwOnQuery) throw new Error("simulated query failure");
          return { data: opts.ctx === undefined ? null : { last_outbound_context: opts.ctx } };
        },
      };
      return chain;
    },
  };
}

Deno.test("getOutboundContextWithTaskId: fresh context with task_id → returns shape", async () => {
  const supabase = makeFakeProfileClient({
    ctx: {
      task_id: "uuid-1",
      task_summary: "Buy milk",
      sent_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    },
  });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out, { task_id: "uuid-1", task_summary: "Buy milk", all_task_ids: undefined });
});

Deno.test("getOutboundContextWithTaskId: stale context (>60min) → null", async () => {
  const supabase = makeFakeProfileClient({
    ctx: {
      task_id: "uuid-1",
      task_summary: "Buy milk",
      sent_at: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
    },
  });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out, null);
});

Deno.test("getOutboundContextWithTaskId: no task_id in context → null", async () => {
  const supabase = makeFakeProfileClient({
    ctx: { task_summary: "Buy milk", sent_at: new Date().toISOString() },
  });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out, null);
});

Deno.test("getOutboundContextWithTaskId: no profile row → null", async () => {
  const supabase = makeFakeProfileClient({ ctx: undefined });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out, null);
});

Deno.test("getOutboundContextWithTaskId: query throws → caught, returns null (fire-soft)", async () => {
  const supabase = makeFakeProfileClient({ throwOnQuery: true });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out, null);
});

Deno.test("getOutboundContextWithTaskId: returns all_task_ids when batch reminder", async () => {
  const supabase = makeFakeProfileClient({
    ctx: {
      task_id: "uuid-1",
      task_summary: "Buy milk",
      sent_at: new Date().toISOString(),
      all_task_ids: [
        { id: "uuid-1", summary: "Buy milk" },
        { id: "uuid-2", summary: "Call dentist" },
      ],
    },
  });
  // deno-lint-ignore no-explicit-any
  const out = await getOutboundContextWithTaskId(supabase as any, "user_1");
  assertEquals(out?.all_task_ids?.length, 2);
});

// ────────────────────────────────────────────────────────────────────
// getRecentOutboundMessages — multi-source aggregator
// ────────────────────────────────────────────────────────────────────
//
// This client supports the three different tables the helper queries
// in a controlled order: clerk_profiles → olive_outbound_queue →
// olive_heartbeat_log. The fixture lets tests drive different
// outcomes for each.

function makeFakeMultiClient(opts: {
  profileCtx?: {
    message_type?: string;
    content?: string;
    sent_at?: string;
    is_error?: boolean;
  } | null;
  queueRows?: Array<{ message_type: string; content?: string; sent_at: string }>;
  heartbeatRows?: Array<{ job_type: string; message_preview: string; created_at: string }>;
}) {
  return {
    from(table: string) {
      if (table === 'clerk_profiles') {
        const chain = {
          select(_c: string) { return chain; },
          eq(_c: string, _v: unknown) { return chain; },
          async single() {
            return { data: opts.profileCtx === undefined ? null : { last_outbound_context: opts.profileCtx } };
          },
        };
        return chain;
      }
      // queue / heartbeat: select/eq/eq/gte/order/limit -> data
      const chain = {
        select(_c: string) { return chain; },
        eq(_c: string, _v: unknown) { return chain; },
        gte(_c: string, _v: unknown) { return chain; },
        order(_c: string, _opts: unknown) { return chain; },
        limit(_n: number) {
          if (table === 'olive_outbound_queue') return Promise.resolve({ data: opts.queueRows ?? [] });
          if (table === 'olive_heartbeat_log') return Promise.resolve({ data: opts.heartbeatRows ?? [] });
          return Promise.resolve({ data: [] });
        },
      };
      return chain;
    },
  };
}

Deno.test("getRecentOutboundMessages: fresh profile context returns one row, skips secondary sources", async () => {
  const supabase = makeFakeMultiClient({
    profileCtx: {
      message_type: 'reminder',
      content: '⏰ Reminder: Buy milk',
      sent_at: new Date().toISOString(),
    },
  });
  // deno-lint-ignore no-explicit-any
  const out = await getRecentOutboundMessages(supabase as any, "user_1");
  assertEquals(out.length, 1);
  assertEquals(out[0].type, "reminder");
});

Deno.test("getRecentOutboundMessages: stale profile context drops, falls back to queue+heartbeat", async () => {
  const stale = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const supabase = makeFakeMultiClient({
    profileCtx: { message_type: 'reminder', content: 'old reminder', sent_at: stale },
    queueRows: [
      { message_type: 'briefing', content: 'morning brief', sent_at: new Date().toISOString() },
    ],
    heartbeatRows: [
      { job_type: 'nudge', message_preview: 'nudge body', created_at: new Date().toISOString() },
    ],
  });
  // deno-lint-ignore no-explicit-any
  const out = await getRecentOutboundMessages(supabase as any, "user_1");
  // queue + heartbeat → 2 results
  assertEquals(out.length, 2);
});

Deno.test("getRecentOutboundMessages: error context is skipped (does not pollute context)", async () => {
  const supabase = makeFakeMultiClient({
    profileCtx: {
      message_type: 'error',
      is_error: true,
      content: 'Sorry, I had trouble',
      sent_at: new Date().toISOString(),
    },
    queueRows: [],
    heartbeatRows: [],
  });
  // deno-lint-ignore no-explicit-any
  const out = await getRecentOutboundMessages(supabase as any, "user_1");
  assertEquals(out.length, 0);
});

Deno.test("getRecentOutboundMessages: no rows anywhere → empty array (never undefined/null)", async () => {
  const supabase = makeFakeMultiClient({ profileCtx: undefined });
  // deno-lint-ignore no-explicit-any
  const out = await getRecentOutboundMessages(supabase as any, "user_1");
  assertEquals(out, []);
});

Deno.test("getRecentOutboundMessages: caps result list at 5", async () => {
  const now = Date.now();
  const supabase = makeFakeMultiClient({
    profileCtx: undefined,
    queueRows: Array.from({ length: 8 }, (_, i) => ({
      message_type: 'reminder',
      content: `m${i}`,
      sent_at: new Date(now - i * 1000).toISOString(),
    })),
    heartbeatRows: [],
  });
  // deno-lint-ignore no-explicit-any
  const out = await getRecentOutboundMessages(supabase as any, "user_1");
  assertEquals(out.length, 5);
});
