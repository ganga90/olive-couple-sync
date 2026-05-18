// Tests for the MERGE handler.
// ============================================================================
// Coverage (Initiative 1.8):
//   1. No recent note (>5min) → merge_no_recent
//   2. Recent note has no embedding + generateEmbedding returns one → similar
//      found → pending_action 'merge' offer
//   3. No similar found anywhere → merge_no_similar
//   4. Recent note already has embedding → skips generateEmbedding

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import { makeMergeHandler } from "./merge.ts";

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  selectByTable?: Record<string, DbResponse>;
  selectQueueByTable?: Record<string, DbResponse[]>;
  rpcData?: Record<string, DbResponse>;
}

interface Recorded {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeChainable(response: DbResponse): unknown {
  const target = { response };
  // deno-lint-ignore no-explicit-any
  const handler: ProxyHandler<any> = {
    get(t, prop) {
      if (prop === 'then') {
        return (resolve: (v: DbResponse) => void) => resolve(t.response);
      }
      if (prop === 'single' || prop === 'maybeSingle') {
        return () => Promise.resolve(t.response);
      }
      return () => new Proxy(t, handler);
    },
  };
  return new Proxy(target, handler);
}

function buildSupabaseStub(opts: StubOptions = {}) {
  const recorded: Recorded = { inserts: [], updates: [], rpcs: [] };
  const selectByTable = opts.selectByTable ?? {};
  const selectQueueByTable: Record<string, DbResponse[]> = {};
  for (const [k, v] of Object.entries(opts.selectQueueByTable ?? {})) selectQueueByTable[k] = [...v];
  const rpcData = opts.rpcData ?? {};

  const responseFor = (table: string): DbResponse => {
    const q = selectQueueByTable[table];
    if (q && q.length > 0) return q.shift()!;
    return selectByTable[table] ?? { data: null, error: null };
  };

  const stub = {
    from(table: string) {
      return {
        select(_cols: string) {
          return makeChainable(responseFor(table));
        },
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          const payloads = Array.isArray(rows) ? rows : [rows];
          payloads.forEach((p) => recorded.inserts.push({ table, payload: p }));
          return makeChainable({ data: payloads[0], error: null });
        },
        update(patch: Record<string, unknown>) {
          recorded.updates.push({ table, patch });
          return makeChainable({ data: null, error: null });
        },
      };
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      recorded.rpcs.push({ name, args });
      return Promise.resolve(rpcData[name] ?? { data: null, error: null });
    },
  };
  return { stub, recorded };
}

function buildCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    userLang: 'en',
    userTimezone: 'America/New_York',
    profile: {
      id: 'user-1', display_name: 'Test', phone_number: '+15555550100',
      timezone: 'America/New_York', language_preference: 'en', default_privacy: 'shared',
    },
    coupleId: null,
    effectiveCoupleId: null,
    session: { id: 'sess-1', user_id: 'user-1', context_data: {} as ConversationContext },
    messageBody: 'merge it',
    cleanMessage: 'merge it',
    effectiveMessage: 'merge it',
    mediaUrls: [], mediaTypes: [],
    wamid: 'wamid-1', inboundNoteSource: 'whatsapp',
    quotedMessageId: null, receivedAtIso: new Date().toISOString(),
    tracker: null, intentResult: { intent: 'MERGE' }, members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

Deno.test("merge_no_recent: no note in last 5 minutes", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: { clerk_notes: { data: [], error: null } },
  });
  const handler = makeMergeHandler({ t: fakeT, generateEmbedding: async () => null });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assertEquals(reply.text, 'merge_no_recent');
});

Deno.test("happy path: recent note → embedding generated → similar found → pending merge offer", async () => {
  let embedCalls = 0;
  const { stub, recorded } = buildSupabaseStub({
    selectQueueByTable: {
      // 1st: resolveRelativeReference-style recent fetch returns one note
      clerk_notes: [
        { data: [{ id: 'src-1', summary: 'Buy groceries', embedding: null, created_at: new Date().toISOString() }], error: null },
      ],
    },
    rpcData: {
      // findSimilarNotes uses find_similar_notes RPC
      find_similar_notes: {
        data: [{ id: 'tgt-1', summary: 'Buy milk and eggs', similarity: 0.92 }],
        error: null,
      },
    },
  });
  const handler = makeMergeHandler({
    t: fakeT,
    generateEmbedding: async () => { embedCalls++; return new Array(1536).fill(0.01); },
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  assert(reply.text.startsWith('confirm_merge'));
  assert(reply.text.includes('source=Buy groceries'));
  assert(reply.text.includes('target=Buy milk and eggs'));
  // Embedding was generated (source had no embedding).
  assertEquals(embedCalls, 1);
  // Session updated to AWAITING_CONFIRMATION with pending_action.type='merge'.
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  const pa = (sessUpd!.patch as any).context_data.pending_action;
  assertEquals(pa.type, 'merge');
  assertEquals(pa.source_id, 'src-1');
  assertEquals(pa.target_id, 'tgt-1');
});

Deno.test("merge_no_similar: source exists but no similar match in DB", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [{ id: 'src-1', summary: 'Plant flowers', embedding: null, created_at: new Date().toISOString() }], error: null },
    },
    rpcData: { find_similar_notes: { data: [], error: null } },
  });
  const handler = makeMergeHandler({
    t: fakeT, generateEmbedding: async () => new Array(1536).fill(0.01),
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assertEquals(reply.text, 'merge_no_similar|task=Plant flowers');
});

Deno.test("embedding skipped when source note already has one", async () => {
  let embedCalls = 0;
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [{ id: 'src-2', summary: 'Call dentist', embedding: new Array(1536).fill(0.5), created_at: new Date().toISOString() }], error: null },
    },
    rpcData: { find_similar_notes: { data: [{ id: 'tgt-2', summary: 'Schedule dentist', similarity: 0.85 }], error: null } },
  });
  const handler = makeMergeHandler({
    t: fakeT, generateEmbedding: async () => { embedCalls++; return new Array(1536).fill(0.99); },
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assert(reply.text.startsWith('confirm_merge'));
  assertEquals(embedCalls, 0);
});
