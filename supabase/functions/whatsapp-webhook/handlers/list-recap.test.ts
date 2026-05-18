// Tests for the LIST_RECAP handler.
// ============================================================================
// Coverage (Initiative 1.8):
//   1. Pure helpers: normalizeListName, singularizeListName, matchListByName
//   2. Happy path: AI returns recap → returned (sliced 1500) + entity stamped
//   3. AI throws → structured fallback rendered with urgent/overdue/active
//   4. No matched list → list_not_found with sample names
//   5. Empty list → list_empty
//   6. No lists at all → "you don't have any lists yet" copy

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import {
  makeListRecapHandler,
  normalizeListName,
  singularizeListName,
  matchListByName,
  type ListRecapCallAI,
  type SaveReferencedEntityFn,
} from "./list-recap.ts";

// ─── Pure-helper tests ────────────────────────────────────────────────

Deno.test("normalizeListName: lowercase, strip articles, collapse whitespace", () => {
  assertEquals(normalizeListName('The Travel List'), 'travel list');
  assertEquals(normalizeListName('My  Books'), 'books');
  assertEquals(normalizeListName('our weekly groceries'), 'weekly groceries');
});

Deno.test("singularizeListName: ies→y, plain s drop, ss kept", () => {
  assertEquals(singularizeListName('parties'), 'party');
  assertEquals(singularizeListName('books'), 'book');
  assertEquals(singularizeListName('chess'), 'chess');
});

Deno.test("matchListByName: exact, singular, contains both ways", () => {
  const lists = [
    { id: 'l1', name: 'Books' },
    { id: 'l2', name: 'Travel Ideas' },
    { id: 'l3', name: 'Daily Tasks' },
  ];
  assertEquals(matchListByName(lists, 'books')?.id, 'l1');
  assertEquals(matchListByName(lists, 'book')?.id, 'l1');
  assertEquals(matchListByName(lists, 'travel')?.id, 'l2');
  assertEquals(matchListByName(lists, 'my travel ideas')?.id, 'l2');
  assertEquals(matchListByName(lists, 'completely unrelated'), null);
});

// ─── Stub scaffolding ─────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  selectQueueByTable?: Record<string, DbResponse[]>;
  selectByTable?: Record<string, DbResponse>;
}

interface Recorded {
  updates: Array<{ table: string; patch: Record<string, unknown> }>;
}

function makeChainable(response: DbResponse): unknown {
  const target = { response };
  // deno-lint-ignore no-explicit-any
  const handler: ProxyHandler<any> = {
    get(t, prop) {
      if (prop === 'then') return (resolve: (v: DbResponse) => void) => resolve(t.response);
      if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(t.response);
      return () => new Proxy(t, handler);
    },
  };
  return new Proxy(target, handler);
}

function buildSupabaseStub(opts: StubOptions = {}) {
  const recorded: Recorded = { updates: [] };
  const selectByTable = opts.selectByTable ?? {};
  const selectQueueByTable: Record<string, DbResponse[]> = {};
  for (const [k, v] of Object.entries(opts.selectQueueByTable ?? {})) selectQueueByTable[k] = [...v];
  const responseFor = (table: string): DbResponse => {
    const q = selectQueueByTable[table];
    if (q && q.length > 0) return q.shift()!;
    return selectByTable[table] ?? { data: null, error: null };
  };
  const stub = {
    from(table: string) {
      return {
        select(_cols: string) { return makeChainable(responseFor(table)); },
        update(patch: Record<string, unknown>) {
          recorded.updates.push({ table, patch });
          return makeChainable({ data: null, error: null });
        },
      };
    },
  };
  return { stub, recorded };
}

function buildCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1', userLang: 'en', userTimezone: 'America/New_York',
    profile: { id: 'user-1', display_name: 'T', phone_number: null, timezone: 'America/New_York', language_preference: 'en', default_privacy: 'shared' },
    coupleId: null, effectiveCoupleId: null,
    session: { id: 'sess-1', user_id: 'user-1', context_data: {} as ConversationContext },
    messageBody: 'recap my books', cleanMessage: 'books', effectiveMessage: 'books',
    mediaUrls: [], mediaTypes: [],
    wamid: 'wamid-1', inboundNoteSource: 'whatsapp',
    quotedMessageId: null, receivedAtIso: new Date().toISOString(),
    tracker: null, intentResult: { intent: 'LIST_RECAP' }, members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

function fakeSaveRef(): { fn: SaveReferencedEntityFn; calls: Array<{ task: unknown; response: string }> } {
  const calls: Array<{ task: unknown; response: string }> = [];
  const fn: SaveReferencedEntityFn = async (task, response) => { calls.push({ task, response }); };
  return { fn, calls };
}

const scriptedAI = (opts: { returns?: string; throws?: boolean } = {}): ListRecapCallAI => async () => {
  if (opts.throws) throw new Error('AI down');
  return opts.returns ?? 'AI recap content';
};

// ─── Handler tests ────────────────────────────────────────────────────

Deno.test("happy path: AI returns recap → sliced + entity stamped", async () => {
  const long = 'X'.repeat(1700);
  const { stub } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_lists: [{ data: [{ id: 'l1', name: 'Books', description: null, created_at: '2026-01-01T00:00:00Z' }], error: null }],
      clerk_notes: [{ data: [
        { id: 't1', summary: 'Dune', priority: 'medium', completed: false, due_date: null, original_text: null, items: [] },
        { id: 't2', summary: 'Foundation', priority: 'high', completed: false, due_date: null, original_text: null, items: [] },
      ], error: null }],
    },
  });
  const save = fakeSaveRef();
  const handler = makeListRecapHandler({
    callAI: scriptedAI({ returns: long }), t: fakeT, saveReferencedEntity: save.fn,
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assertEquals(reply.text.length, 1500);
  assertEquals(save.calls.length, 1);
});

Deno.test("AI throws → structured fallback with urgent/overdue/active buckets", async () => {
  const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const { stub } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_lists: [{ data: [{ id: 'l1', name: 'Tasks', description: 'My todos', created_at: '2026-01-01T00:00:00Z' }], error: null }],
      clerk_notes: [{ data: [
        { id: 't1', summary: 'Pay rent', priority: 'high', completed: false, due_date: null, items: [] },
        { id: 't2', summary: 'Old task', priority: 'medium', completed: false, due_date: oneWeekAgo, items: [] },
        { id: 't3', summary: 'Regular task', priority: 'medium', completed: false, due_date: null, items: [] },
      ], error: null }],
    },
  });
  const save = fakeSaveRef();
  const handler = makeListRecapHandler({
    callAI: scriptedAI({ throws: true }), t: fakeT, saveReferencedEntity: save.fn,
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any, intentResult: { intent: 'LIST_RECAP', _listName: 'Tasks' } }));
  assert(reply.text.includes('*Tasks*'));
  assert(reply.text.includes('🔥 *Urgent:*'));
  assert(reply.text.includes('Pay rent'));
  assert(reply.text.includes('⚠️ *Overdue:*'));
  assert(reply.text.includes('Old task'));
  assert(reply.text.includes('📝 *Active:*'));
  assert(reply.text.includes('Regular task'));
});

Deno.test("no match → list_not_found with sample names", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_lists: { data: [{ id: 'l1', name: 'Books', description: null, created_at: '2026-01-01' }, { id: 'l2', name: 'Travel', description: null, created_at: '2026-01-01' }], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeListRecapHandler({
    callAI: scriptedAI(), t: fakeT, saveReferencedEntity: save.fn,
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any, intentResult: { intent: 'LIST_RECAP', _listName: 'xyzzy nope' } }));
  assert(reply.text.startsWith('list_not_found'));
  assert(reply.text.includes('Books'));
  assert(reply.text.includes('Travel'));
});

Deno.test("empty list → list_empty", async () => {
  const { stub } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_lists: [{ data: [{ id: 'l1', name: 'Books', description: null, created_at: '2026-01-01' }], error: null }],
      clerk_notes: [{ data: [], error: null }],
    },
  });
  const save = fakeSaveRef();
  const handler = makeListRecapHandler({
    callAI: scriptedAI(), t: fakeT, saveReferencedEntity: save.fn,
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assert(reply.text.startsWith('list_empty'));
  assertExists(reply.text.includes('list=Books') ? true : null);
});

Deno.test("no lists at all → onboarding hint", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: { clerk_lists: { data: [], error: null } },
  });
  const save = fakeSaveRef();
  const handler = makeListRecapHandler({
    callAI: scriptedAI(), t: fakeT, saveReferencedEntity: save.fn,
  });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assert(reply.text.includes('don\'t have any lists yet'));
});
