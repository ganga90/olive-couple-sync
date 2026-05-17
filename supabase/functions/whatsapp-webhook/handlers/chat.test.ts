// Tests for the CHAT handler.
// ============================================================================
// Coverage (Initiative 1.4 acceptance criteria — OLIVE_REFACTOR_PLAN.md task
// ledger):
//
//   #  | Test                                                | Asserts
//   ───|─────────────────────────────────────────────────────|──────────────
//   1  | briefing                                            | tier=standard, 3 after_reply
//   2  | daily_focus                                         | tier=standard, prompt selected
//   3  | weekly_summary                                      | tier=pro
//   4  | weekly_summary Pro fails → Flash fallback           | 2 callAI calls
//   5  | motivation                                          | tier=standard
//   6  | general                                             | tier=standard, max_length 1500
//   7  | assistant                                           | tier=standard, max_length 2000
//   8  | help (early exit, no AI call)                       | no callAI, help_text reply
//   9  | after-reply effects (session write + daily log RPC) | recorded calls
//   10 | AI throws on standard tier → error fallback         | deterministic per-chatType fallback
//
// Gemini is mocked through the `callAI` dep. Supabase is mocked with a
// Proxy-based chainable stub that returns programmable per-table responses
// and records `from(table).update()` + `rpc()` calls so after-reply
// side-effects can be asserted.

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import { makeChatHandler, detectChatType, type ChatCallAI } from "./chat.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  /** Per-table SELECT responses. Defaults to `{ data: null, error: null }`. */
  selectData?: Record<string, DbResponse>;
  /** Per-RPC-name responses. Defaults to `{ data: null, error: null }`. */
  rpcData?: Record<string, DbResponse>;
  /** Per-functions-invoke responses. */
  invokeData?: Record<string, DbResponse>;
}

interface Recorded {
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
  upserts: Array<{ table: string; payload: Record<string, unknown> }>;
  inserts: Array<{ table: string; payload: Record<string, unknown> }>;
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  invokes: Array<{ name: string; body: Record<string, unknown> }>;
}

/** Build a chainable stub that resolves any query chain (.eq/.in/.or/.order/
 *  .limit/.gte/.gt/.lte/.lt/.neq/.is/.contains/.match etc.) to a single
 *  programmable response. `.single()` and `.maybeSingle()` resolve to the
 *  same response; awaiting the chain itself also resolves to the response. */
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
      // Every other method is a chain step that returns the same proxy.
      return () => new Proxy(t, handler);
    },
  };
  return new Proxy(target, handler);
}

function buildSupabaseStub(opts: StubOptions = {}) {
  const recorded: Recorded = {
    updates: [], upserts: [], inserts: [], rpcs: [], invokes: [],
  };
  const selectData = opts.selectData ?? {};
  const rpcData = opts.rpcData ?? {};
  const invokeData = opts.invokeData ?? {};

  const stub = {
    from(table: string) {
      // Build the chain proxy seeded with this table's response.
      const chain = makeChainable(selectData[table] ?? { data: null, error: null });

      // Wrap insert/update/upsert at the `from(...)` level so we can record
      // the payload/patch BEFORE returning the chain.
      return {
        select(_cols: string) {
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          const payload = Array.isArray(rows) ? rows[0] : rows;
          recorded.inserts.push({ table, payload });
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
        update(patch: Record<string, unknown>) {
          recorded.updates.push({ table, patch });
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
        upsert(payload: Record<string, unknown>, _opts?: unknown) {
          recorded.upserts.push({ table, payload });
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
    context_data: {
      conversation_history: [
        { role: 'user', content: 'hello', timestamp: new Date().toISOString() },
      ],
    } as ConversationContext,
  };
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    userLang: 'en',
    userTimezone: 'America/New_York',
    profile: {
      id: 'user-1',
      display_name: 'Test User',
      phone_number: '+15555550100',
      timezone: 'America/New_York',
      language_preference: 'en',
      default_privacy: 'shared',
    },
    coupleId: null,
    effectiveCoupleId: null,
    session,
    messageBody: 'hi olive',
    cleanMessage: 'hi olive',
    effectiveMessage: 'hi olive',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'CHAT', chatType: 'general' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

/** Builds a `callAI` mock that returns scripted text and records each call.
 *  When `throwsOnTier` is set, the first invocation at that tier throws. */
function scripted(opts: {
  returns?: string;
  throwsOnTier?: string;
  throwsAlways?: boolean;
} = {}): {
  fn: ChatCallAI;
  calls: Array<{
    tier: string; systemPrompt: string; userMessage: string;
    promptVersion: string | undefined;
  }>;
} {
  const calls: Array<{
    tier: string; systemPrompt: string; userMessage: string;
    promptVersion: string | undefined;
  }> = [];
  const text = opts.returns ?? '🌿 mock reply';
  let invocations = 0;
  const fn: ChatCallAI = async (
    systemPrompt, userMessage, _temp, tier,
    _tracker, promptVersion, _media, _userId,
  ) => {
    calls.push({ tier, systemPrompt, userMessage, promptVersion });
    invocations++;
    if (opts.throwsAlways) throw new Error('AI throws (always)');
    // throwsOnTier fires only on the FIRST invocation at that tier
    // (so retry-at-different-tier paths can succeed).
    if (opts.throwsOnTier === tier && invocations === 1) {
      throw new Error(`AI throws for tier ${tier}`);
    }
    return text;
  };
  return { fn, calls };
}

async function runAfterReply(after_reply?: Array<() => Promise<void>>) {
  if (!after_reply) return;
  for (const cb of after_reply) await cb();
}

// ─── Tests ────────────────────────────────────────────────────────────

Deno.test("detectChatType: heuristics for greeting / help / general", () => {
  assertEquals(detectChatType('hi'), 'greeting');
  assertEquals(detectChatType('hello!'), 'greeting');
  assertEquals(detectChatType('help'), 'help');
  assertEquals(detectChatType('what can you do'), 'help');
  assertEquals(detectChatType('summarize my week'), 'general'); // AI handles real intent
});

Deno.test("briefing: routes standard tier, queues 3 after_reply callbacks", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: '🌅 Morning briefing for today.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'briefing' },
    messageBody: 'morning briefing',
    effectiveMessage: 'morning briefing',
  }));

  assertEquals(callAI.calls.length, 1);
  assertEquals(callAI.calls[0].tier, 'standard');
  assertExists(reply.text);
  assertEquals(reply.max_length, 1500);
  assertEquals(reply.after_reply?.length, 3);
  // Prompt version stamped from registry.
  assertEquals(callAI.calls[0].promptVersion, 'wa-chat-briefing-v1.0');
});

Deno.test("daily_focus: routes standard, includes prompt enhancement", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: '🎯 Focus on these 3 things.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'daily_focus' },
    effectiveMessage: 'what should I focus on today',
  }));

  assertEquals(callAI.calls[0].tier, 'standard');
  // userPromptEnhancement is appended to effectiveMessage by the handler.
  assert(callAI.calls[0].userMessage.includes('Please recommend my top priorities'));
  assertExists(reply.text);
});

Deno.test("weekly_summary: routes to Pro tier", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: '📊 Your week summary.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'weekly_summary' },
    effectiveMessage: 'summarize my week',
  }));

  assertEquals(callAI.calls.length, 1);
  assertEquals(callAI.calls[0].tier, 'pro');
  assertEquals(callAI.calls[0].promptVersion, 'wa-chat-weekly-summary-v1.0');
});

Deno.test("weekly_summary: Pro fails → falls back to standard tier", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({
    returns: '📊 Weekly summary (from Flash).',
    throwsOnTier: 'pro',
  });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'weekly_summary' },
    effectiveMessage: 'summarize my week',
  }));

  // Two callAI invocations — Pro then standard.
  assertEquals(callAI.calls.length, 2);
  assertEquals(callAI.calls[0].tier, 'pro');
  assertEquals(callAI.calls[1].tier, 'standard');
  // Reply still ships (the fallback content).
  assert(reply.text.includes('Weekly summary'));
});

Deno.test("motivation: routes standard, includes motivation prompt", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: '💚 You\'re doing great.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'motivation' },
    effectiveMessage: 'motivate me',
  }));

  assertEquals(callAI.calls[0].tier, 'standard');
  // Motivation prompt has a recognizable empathy directive.
  assert(callAI.calls[0].systemPrompt.includes('toxic positivity'));
  assertExists(reply.text);
});

Deno.test("general: routes standard, max_length 1500", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: 'Help-KB answer.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'general' },
  }));

  assertEquals(callAI.calls[0].tier, 'standard');
  assertEquals(reply.max_length, 1500);
});

Deno.test("assistant: routes standard, max_length 2000, assistant prompt", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ returns: '**Subject:** Draft email body…' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'assistant' },
    effectiveMessage: 'draft a thank-you email to my client',
  }));

  assertEquals(callAI.calls[0].tier, 'standard');
  assertEquals(reply.max_length, 2000);
  // Assistant prompt has the action-over-description directive.
  assert(callAI.calls[0].systemPrompt.includes('ACTION OVER DESCRIPTION'));
});

Deno.test("help: short-circuits with help_text, no callAI invocation", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted();
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'help' },
  }));

  assertEquals(callAI.calls.length, 0);
  assertEquals(reply.text, 'help_text');
  // No after_reply for the early-exit help branch.
  assertEquals(reply.after_reply, undefined);
});

Deno.test("after_reply: session write + daily log RPC fire, isolated from failures", async () => {
  const { stub, recorded } = buildSupabaseStub();
  const callAI = scripted({ returns: '🌿 General reply.' });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'general' },
  }));

  assertEquals(reply.after_reply?.length, 3);
  await runAfterReply(reply.after_reply);

  // After-reply #1: user_sessions update with last_assistant_output set.
  const sessionUpdate = recorded.updates.find((u) => u.table === 'user_sessions');
  assertExists(sessionUpdate);
  const ctxData = (sessionUpdate.patch.context_data as { last_assistant_output?: string });
  assert(ctxData.last_assistant_output?.includes('General reply'));

  // After-reply #3: append_to_daily_log RPC fired.
  const dailyLogRpc = recorded.rpcs.find((r) => r.name === 'append_to_daily_log');
  assertExists(dailyLogRpc);
  assertEquals(dailyLogRpc.args.p_source, 'chat');
});

Deno.test("AI throws on standard tier (no Pro): renders deterministic fallback", async () => {
  const { stub } = buildSupabaseStub();
  const callAI = scripted({ throwsAlways: true });
  const handler = makeChatHandler({ callAI: callAI.fn, t: fakeT });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CHAT', chatType: 'motivation' },
    effectiveMessage: 'motivate me',
  }));

  // motivation fallback shape from buildChatErrorFallback.
  assert(reply.text.includes('🫒') || reply.text.includes('You\'re doing great'));
  // No after_reply on the error path — nothing was produced to persist.
  assertEquals(reply.after_reply, undefined);
});
