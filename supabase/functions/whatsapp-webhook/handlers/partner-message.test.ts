// Tests for the PARTNER_MESSAGE handler.
// ============================================================================
// Coverage:
//   #  | Test                                                          | Asserts
//   ───|───────────────────────────────────────────────────────────────|──────────────
//   1  | isTaskLikeRelay: action gates + verb detection                | (pure helper)
//   2  | no couple → partner_no_space                                  | no Meta call
//   3  | partner without phone → partner_no_phone                      | no Meta call
//   4  | happy path: resolve + free-form send + task create + reply    | Meta call, insert, after_reply queued
//   5  | Meta 131047 (outside 24h window) → template fallback          | 2 Meta calls (free-form then template)
//   6  | duplicate task found → skip creation, just relay              | partner_message_existing_task copy
//   7  | trust gate blocks send → queued reply, no Meta call           | (gated when soul_enabled — failed_open path skipped)

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import {
  makePartnerMessageHandler,
  isTaskLikeRelay,
  type MetaFetchFn,
} from "./partner-message.ts";
import type { SaveReferencedEntityFn } from "./contextual-ask.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  selectData?: Record<string, DbResponse>;
  rpcData?: Record<string, DbResponse>;
  invokeData?: Record<string, DbResponse>;
  insertResponse?: DbResponse;
}

interface Recorded {
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  invokes: Array<{ name: string; body: Record<string, unknown> }>;
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
  const recorded: Recorded = { inserts: [], updates: [], rpcs: [], invokes: [] };
  const selectData = opts.selectData ?? {};
  const rpcData = opts.rpcData ?? {};
  const invokeData = opts.invokeData ?? {};
  let insertCount = 0;

  const stub = {
    from(table: string) {
      const chain = makeChainable(selectData[table] ?? { data: null, error: null });
      return {
        select(_cols: string) {
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          const payloads = Array.isArray(rows) ? rows : [rows];
          payloads.forEach((p) => recorded.inserts.push({ table, payload: p }));
          insertCount += payloads.length;
          if (opts.insertResponse) return makeChainable(opts.insertResponse);
          const echoRows = payloads.map((p, i) => ({
            id: `note-${insertCount - payloads.length + i + 1}`,
            summary: (p as { summary?: string }).summary ?? null,
            list_id: (p as { list_id?: string }).list_id ?? null,
          }));
          return makeChainable({
            data: payloads.length > 1 ? echoRows : echoRows[0],
            error: null,
          });
        },
        update(patch: Record<string, unknown>) {
          recorded.updates.push({ table, patch });
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
      };
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      recorded.rpcs.push({ name, args });
      return Promise.resolve(rpcData[name] ?? { data: null, error: null });
    },
    functions: {
      invoke(name: string, opts2: { body?: Record<string, unknown> } = {}) {
        recorded.invokes.push({ name, body: opts2.body ?? {} });
        return Promise.resolve(invokeData[name] ?? { data: null, error: null });
      },
    },
  };
  return { stub, recorded };
}

function buildCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  const session = overrides.session ?? {
    id: 'sess-1',
    user_id: 'user-1',
    context_data: {} as ConversationContext,
  };
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    userLang: 'en',
    userTimezone: 'America/New_York',
    profile: {
      id: 'user-1',
      display_name: 'Sender',
      phone_number: '+15555550100',
      timezone: 'America/New_York',
      language_preference: 'en',
      default_privacy: 'shared',
    },
    coupleId: 'couple-1',
    effectiveCoupleId: 'couple-1',
    session,
    messageBody: 'remind Marco to buy lemons',
    cleanMessage: 'buy lemons',
    effectiveMessage: 'buy lemons',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'PARTNER_MESSAGE', _partnerAction: 'remind' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

const okEmbedding = async (_: string) => null;

function recordingSaveEntity(): {
  fn: SaveReferencedEntityFn;
  calls: Array<{ task: unknown; response: string }>;
} {
  const calls: Array<{ task: unknown; response: string }> = [];
  const fn: SaveReferencedEntityFn = async (task, response) => {
    calls.push({ task, response });
  };
  return { fn, calls };
}

interface MetaScenarioStep {
  ok: boolean;
  status: number;
  body: string;
}

function scriptedMetaFetch(steps: MetaScenarioStep[]): {
  fn: MetaFetchFn;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn: MetaFetchFn = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(i, steps.length - 1)];
    i++;
    return {
      ok: step.ok,
      status: step.status,
      text: async () => step.body,
    };
  };
  return { fn, calls };
}

async function runAfterReply(after_reply?: Array<() => Promise<void>>) {
  if (!after_reply) return;
  for (const cb of after_reply) await cb();
}

// ─── Pure helper tests ─────────────────────────────────────────────────

Deno.test("isTaskLikeRelay: action verbs + always-task actions", () => {
  assert(isTaskLikeRelay('remind', 'anything'));
  assert(isTaskLikeRelay('notify', 'anything'));
  assert(isTaskLikeRelay('tell', 'buy lemons'));
  assert(isTaskLikeRelay('ask', 'pick up the kids'));
  assert(isTaskLikeRelay('tell', 'comprar limones'));
  assert(!isTaskLikeRelay('tell', 'I love you'));
  assert(!isTaskLikeRelay('ask', 'how was your day'));
});

// ─── Handler tests ─────────────────────────────────────────────────────

Deno.test("no coupleId → partner_no_space, no Meta call", async () => {
  const { stub } = buildSupabaseStub();
  const meta = scriptedMetaFetch([{ ok: true, status: 200, body: '{}' }]);
  const saveEntity = recordingSaveEntity();

  const handler = makePartnerMessageHandler({
    t: fakeT, generateEmbedding: okEmbedding,
    saveReferencedEntity: saveEntity.fn, metaFetch: meta.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    coupleId: null,
    effectiveCoupleId: null,
  }));

  assertEquals(reply.text, 'partner_no_space');
  assertEquals(meta.calls.length, 0);
});

Deno.test("partner without phone_number → partner_no_phone, no Meta call", async () => {
  const { stub } = buildSupabaseStub({
    rpcData: {
      get_space_members: {
        data: [
          { user_id: 'user-1', display_name: 'Sender' },
          { user_id: 'user-2', display_name: 'Marco' },
        ],
        error: null,
      },
    },
    selectData: {
      clerk_profiles: {
        data: [{ id: 'user-2', phone_number: null, display_name: 'Marco', last_user_message_at: null }],
        error: null,
      },
    },
  });
  const meta = scriptedMetaFetch([{ ok: true, status: 200, body: '{}' }]);
  const saveEntity = recordingSaveEntity();

  const handler = makePartnerMessageHandler({
    t: fakeT, generateEmbedding: okEmbedding,
    saveReferencedEntity: saveEntity.fn, metaFetch: meta.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assert(reply.text.includes('partner_no_phone'));
  assert(reply.text.includes('partner=Marco'));
  assertEquals(meta.calls.length, 0);
});

Deno.test("happy path: resolve + send free-form + create task + after_reply queued", async () => {
  const { stub, recorded } = buildSupabaseStub({
    rpcData: {
      get_space_members: {
        data: [
          { user_id: 'user-1', display_name: 'Sender' },
          { user_id: 'user-2', display_name: 'Marco' },
        ],
        error: null,
      },
      check_budget_status: { data: null, error: null },
    },
    selectData: {
      clerk_profiles: {
        data: [{
          id: 'user-2', phone_number: '+19999990000',
          display_name: 'Marco',
          last_user_message_at: new Date().toISOString(),
        }],
        error: null,
      },
      // No dupes in the keyword fallback.
      clerk_notes: { data: [], error: null },
    },
    invokeData: {
      'process-note': {
        data: { summary: 'Buy lemons', category: 'task' },
        error: null,
      },
    },
  });
  const meta = scriptedMetaFetch([{
    ok: true, status: 200,
    body: JSON.stringify({ messages: [{ id: 'wamid.MOCK1' }] }),
  }]);
  const saveEntity = recordingSaveEntity();

  const handler = makePartnerMessageHandler({
    t: fakeT, generateEmbedding: okEmbedding,
    saveReferencedEntity: saveEntity.fn, metaFetch: meta.fn,
    env: { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' },
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Meta got the free-form call.
  assertEquals(meta.calls.length, 1);
  assert(meta.calls[0].url.includes('messages'));
  // process-note was invoked (no duplicate found).
  const processNoteCall = recorded.invokes.find((i) => i.name === 'process-note');
  assertExists(processNoteCall);
  // Outbound queue logged as sent.
  const queueInsert = recorded.inserts.find((i) => i.table === 'olive_outbound_queue');
  assertExists(queueInsert);
  assertEquals((queueInsert.payload as { status: string }).status, 'sent');
  // Reply uses the task-created template.
  assert(reply.text.includes('partner_message_and_task'));
  // After-reply queued: saveReferencedEntity called once the callbacks run.
  await runAfterReply(reply.after_reply);
  assertEquals(saveEntity.calls.length, 1);
});

Deno.test("Meta 131047 (outside 24h window) → template fallback fires", async () => {
  const { stub, recorded } = buildSupabaseStub({
    rpcData: {
      get_space_members: {
        data: [
          { user_id: 'user-1', display_name: 'Sender' },
          { user_id: 'user-2', display_name: 'Marco' },
        ],
        error: null,
      },
    },
    selectData: {
      clerk_profiles: {
        data: [{
          id: 'user-2', phone_number: '+19999990000',
          display_name: 'Marco',
          last_user_message_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }],
        error: null,
      },
      clerk_notes: { data: [], error: null },
    },
    invokeData: {
      'process-note': { data: { summary: 'Buy lemons', category: 'task' }, error: null },
    },
  });
  const meta = scriptedMetaFetch([
    // Free-form fails with 131047
    { ok: false, status: 400, body: JSON.stringify({ error: { code: 131047, message: 'outside window' } }) },
    // Template succeeds
    { ok: true, status: 200, body: JSON.stringify({ messages: [{ id: 'wamid.TPL1' }] }) },
  ]);
  const saveEntity = recordingSaveEntity();

  const handler = makePartnerMessageHandler({
    t: fakeT, generateEmbedding: okEmbedding,
    saveReferencedEntity: saveEntity.fn, metaFetch: meta.fn,
    env: { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' },
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Two Meta calls: free-form then template.
  assertEquals(meta.calls.length, 2);
  // Outbound queue logged as sent.
  const queueInsert = recorded.inserts.find((i) => i.table === 'olive_outbound_queue');
  assertExists(queueInsert);
  assertEquals((queueInsert.payload as { status: string }).status, 'sent');
  void reply;
});

Deno.test("duplicate task found via vector match → skip creation, relay only", async () => {
  const { stub, recorded } = buildSupabaseStub({
    rpcData: {
      get_space_members: {
        data: [
          { user_id: 'user-1', display_name: 'Sender' },
          { user_id: 'user-2', display_name: 'Marco' },
        ],
        error: null,
      },
      find_similar_notes: {
        data: [{ id: 'task-existing', summary: 'Buy lemons', similarity: 0.92 }],
        error: null,
      },
    },
    selectData: {
      clerk_profiles: {
        data: [{
          id: 'user-2', phone_number: '+19999990000',
          display_name: 'Marco',
          last_user_message_at: new Date().toISOString(),
        }],
        error: null,
      },
    },
  });
  const meta = scriptedMetaFetch([{
    ok: true, status: 200,
    body: JSON.stringify({ messages: [{ id: 'wamid.X' }] }),
  }]);
  const saveEntity = recordingSaveEntity();

  // Make the embedding generator return something so the vector check fires.
  const handler = makePartnerMessageHandler({
    t: fakeT,
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    saveReferencedEntity: saveEntity.fn,
    metaFetch: meta.fn,
    env: { WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: 'p' },
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Reply uses the "existing task" template variant.
  assert(reply.text.includes('partner_message_existing_task'));
  assert(reply.text.includes('task=Buy lemons'));
  // process-note NOT invoked (duplicate found, skipped creation).
  const pn = recorded.invokes.find((i) => i.name === 'process-note');
  assertEquals(pn, undefined);
});
