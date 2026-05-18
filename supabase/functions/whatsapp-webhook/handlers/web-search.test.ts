// Tests for the WEB_SEARCH handler.
// ============================================================================
// Coverage matrix (Initiative 1.5 acceptance criteria —
// OLIVE_REFACTOR_PLAN.md task ledger):
//
//   #  | Test                                                       | Asserts
//   ───|────────────────────────────────────────────────────────────|──────────────
//   1  | missing OLIVE_PERPLEXITY env → web_search_unavailable      | t() called, no Perplexity fetch
//   2  | happy path: rewriter + Perplexity + formatter chain        | reply text + 2 after_reply queued
//   3  | response with "save this" tail → pending_offer constructed | save_artifact + artifact_kind='web_search'
//   4  | artifact freezing: artifact_content = response.slice[0,4000) | exact slice check
//   5  | Perplexity API non-200 → web_search_unavailable_hint       | t() called with hint, no formatter pass
//   6  | empty Perplexity result → "couldn't find" fallback         | reply text matches
//   7  | formatter throws → raw Perplexity result + first citation  | "🔍 Here's what I found:" fallback
//   8  | uncaught exception → web_search_error                      | t() called, after_reply absent

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import {
  makeWebSearchHandler,
  type PerplexityFetchFn,
  type WebSearchCallAI,
} from "./web-search.ts";
import type { SaveReferencedEntityFn } from "./contextual-ask.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  selectData?: Record<string, DbResponse>;
}

interface Recorded {
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
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
  const recorded: Recorded = { updates: [] };
  const selectData = opts.selectData ?? {};

  const stub = {
    from(table: string) {
      const chain = makeChainable(selectData[table] ?? { data: null, error: null });
      return {
        select(_cols: string) {
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
        update(patch: Record<string, unknown>) {
          recorded.updates.push({ table, patch });
          // deno-lint-ignore no-explicit-any
          return chain as any;
        },
      };
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
      display_name: 'Test',
      phone_number: '+15555550100',
      timezone: 'America/New_York',
      language_preference: 'en',
      default_privacy: 'shared',
    },
    coupleId: null,
    effectiveCoupleId: null,
    session,
    messageBody: 'best italian restaurants in miami',
    cleanMessage: 'best italian restaurants in miami',
    effectiveMessage: 'best italian restaurants in miami',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'WEB_SEARCH' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

function scriptedAI(opts: {
  formatterReturns?: string;
  rewriterReturns?: string;
  formatterThrows?: boolean;
} = {}): {
  fn: WebSearchCallAI;
  calls: Array<{ tier: string; promptVersion: string | undefined }>;
} {
  const calls: Array<{ tier: string; promptVersion: string | undefined }> = [];
  const fn: WebSearchCallAI = async (_sys, _msg, _temp, tier, _tracker, promptVersion) => {
    calls.push({ tier, promptVersion });
    // Rewriter (lite + WA_REWRITER_PROMPT_VERSION) vs formatter (lite +
    // WA_WEB_SEARCH_FORMAT_PROMPT_VERSION) distinguishable by promptVersion.
    if (promptVersion === 'wa-rewriter-v1.0') {
      return opts.rewriterReturns ?? `SEARCH_QUERY: best italian restaurants miami
USER_QUESTION: What are the best Italian restaurants in Miami?`;
    }
    if (opts.formatterThrows) throw new Error('formatter AI down');
    return opts.formatterReturns ?? '🌿 Here are some great options.';
  };
  return { fn, calls };
}

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

interface FetchScenario {
  ok: boolean;
  status?: number;
  body?: unknown;
  textBody?: string;
}

function scriptedFetch(scenario: FetchScenario): {
  fn: PerplexityFetchFn;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn: PerplexityFetchFn = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: scenario.ok,
      status: scenario.status,
      text: async () => scenario.textBody ?? 'error body',
      json: async () => scenario.body ?? null,
    };
  };
  return { fn, calls };
}

async function runAfterReply(after_reply?: Array<() => Promise<void>>) {
  if (!after_reply) return;
  for (const cb of after_reply) await cb();
}

// ─── Tests ─────────────────────────────────────────────────────────────

Deno.test("OLIVE_PERPLEXITY unset → web_search_unavailable", async () => {
  Deno.env.delete('OLIVE_PERPLEXITY');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI();
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({ ok: false });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assertEquals(reply.text, 'web_search_unavailable');
  assertEquals(reply.after_reply, undefined);
  assertEquals(fetchStub.calls.length, 0);
});

Deno.test("happy path: rewriter + Perplexity + formatter, 2 after_reply queued", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI({ formatterReturns: '🌿 Joe\'s Stone Crab and Yardbird.' });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: {
      choices: [{ message: { content: 'Top spots: Joe\'s Stone Crab, Yardbird.' } }],
      citations: ['https://example.com/joes'],
    },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Rewriter called once (lite + WA_REWRITER) — but only when conversation_history is present.
  // In this test it isn't, so only the formatter callAI fires.
  assertEquals(callAI.calls.length, 1);
  assertEquals(callAI.calls[0].tier, 'lite');
  assertEquals(callAI.calls[0].promptVersion, 'wa-web-search-v2.0');
  assertEquals(fetchStub.calls.length, 1);
  assertEquals(fetchStub.calls[0].url, 'https://api.perplexity.ai/chat/completions');
  assert(reply.text.includes('Joe'));
  assertEquals(reply.after_reply?.length, 2);
});

Deno.test("response contains 'save this' tail → pending_offer save_artifact constructed", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub, recorded } = buildSupabaseStub();
  const formattedText = '🌿 Here are top picks. Want me to save this?';
  const callAI = scriptedAI({ formatterReturns: formattedText });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: { choices: [{ message: { content: 'Some recs' } }], citations: [] },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));
  await runAfterReply(reply.after_reply);

  const sessionUpdate = recorded.updates.find((u) => u.table === 'user_sessions');
  assertExists(sessionUpdate);
  const ctxData = sessionUpdate.patch.context_data as ConversationContext;
  const offer = ctxData.pending_offer;
  assertExists(offer);
  if (offer!.type === 'save_artifact') {
    assertEquals(offer!.artifact_kind, 'web_search');
    assertEquals(offer!.artifact_content, formattedText.substring(0, 4000));
  }
});

Deno.test("artifact freezing: artifact_content slices at 4000 chars verbatim", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub, recorded } = buildSupabaseStub();
  const longResponse = '🌿 ' + 'b'.repeat(4500) + ' save this?';
  const callAI = scriptedAI({ formatterReturns: longResponse });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: { choices: [{ message: { content: 'x' } }], citations: [] },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));
  await runAfterReply(reply.after_reply);

  const sessionUpdate = recorded.updates.find((u) => u.table === 'user_sessions');
  const ctxData = sessionUpdate!.patch.context_data as ConversationContext;
  const offer = ctxData.pending_offer;
  assertExists(offer);
  if (offer!.type === 'save_artifact') {
    assertEquals(offer!.artifact_content.length, 4000);
    assertEquals(offer!.artifact_content, longResponse.substring(0, 4000));
  }
  // Reply itself sliced to 1500.
  assertEquals(reply.text.length, 1500);
});

Deno.test("Perplexity non-200 → web_search_unavailable_hint, no formatter call", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI();
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({ ok: false, status: 500, textBody: 'gateway timeout' });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assert(reply.text.startsWith('web_search_unavailable_hint'));
  // Only the rewriter could have called callAI — and only when history is present (it isn't).
  assertEquals(callAI.calls.length, 0);
  assertEquals(reply.after_reply, undefined);
});

Deno.test("Perplexity empty content → \"couldn't find\" message", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI();
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: { choices: [{ message: { content: '' } }], citations: [] },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assert(reply.text.includes('couldn\'t find relevant results'));
  assertEquals(reply.after_reply, undefined);
});

Deno.test("formatter throws → raw Perplexity result + first citation fallback", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI({ formatterThrows: true });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: {
      choices: [{ message: { content: 'Raw Perplexity prose.' } }],
      citations: ['https://example.com/source'],
    },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assert(reply.text.includes('🔍 Here\'s what I found:'));
  assert(reply.text.includes('Raw Perplexity prose'));
  assert(reply.text.includes('https://example.com/source'));
  // After-reply still queued — the raw fallback is a valid response.
  assertExists(reply.after_reply);
});

// ─── Citation guard tests (v2.0) ───────────────────────────────────────
//
// The handler's citation guard (added with prompt v2.0) is a deterministic
// safety net: if Gemini's formatted output contains no http(s):// substring
// AND Perplexity returned citations, the top citation is appended on its
// own line as "🔗 <url>". WhatsApp `preview_url: true` then linkifies it.

Deno.test("citation guard: AI omits URL but citations exist → top source appended", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  // Formatter returns prose without ANY URL — the bug we're fixing.
  const callAI = scriptedAI({
    formatterReturns: '🌿 The Calatrava Hotel is a luxury boutique hotel in Palma de Mallorca.',
  });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: {
      choices: [{ message: { content: 'Calatrava details...' } }],
      citations: ['https://www.boutiquehotelcalatrava.com', 'https://example.com/other'],
    },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Guard fired: top citation appended on its own line.
  assert(
    reply.text.includes('🔗 https://www.boutiquehotelcalatrava.com'),
    `Expected top citation in reply, got: ${reply.text}`,
  );
  // Only the top citation, not all of them.
  assert(!reply.text.includes('https://example.com/other'));
});

Deno.test("citation guard: AI already included a URL → no append (no duplication)", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  // Formatter complied with v2.0 prompt and included the URL itself.
  const callAI = scriptedAI({
    formatterReturns: '🌿 Calatrava Hotel — boutique in Palma.\n\n🔗 https://www.boutiquehotelcalatrava.com',
  });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: {
      choices: [{ message: { content: 'x' } }],
      citations: ['https://www.boutiquehotelcalatrava.com'],
    },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // Exactly one occurrence — guard did NOT re-append.
  const occurrences = reply.text.split('https://www.boutiquehotelcalatrava.com').length - 1;
  assertEquals(occurrences, 1);
});

Deno.test("citation guard: no citations returned → guard does nothing", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI({
    formatterReturns: '🌿 No URL in this answer.',
  });
  const saveEntity = recordingSaveEntity();
  const fetchStub = scriptedFetch({
    ok: true,
    body: {
      choices: [{ message: { content: 'no sources' } }],
      citations: [],
    },
  });

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub.fn,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  // No citations + no URL in response → guard skipped, no 🔗 line.
  assert(!reply.text.includes('🔗'));
  assert(!/https?:\/\//.test(reply.text));
});

Deno.test("uncaught exception in flow → web_search_error", async () => {
  Deno.env.set('OLIVE_PERPLEXITY', 'test-key');
  const { stub } = buildSupabaseStub();
  const callAI = scriptedAI();
  const saveEntity = recordingSaveEntity();
  // Fetch throws on its own — simulates network blow-up after env check passed.
  const fetchStub: PerplexityFetchFn = async () => {
    throw new Error('network blip');
  };

  const handler = makeWebSearchHandler({
    callAI: callAI.fn, t: fakeT, saveReferencedEntity: saveEntity.fn, perplexityFetch: fetchStub,
  });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
  }));

  assertEquals(reply.text, 'web_search_error');
  assertEquals(reply.after_reply, undefined);
});
