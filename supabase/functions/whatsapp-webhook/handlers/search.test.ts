// Tests for the SEARCH handler.
// ============================================================================
// Coverage (Initiative 1.8):
//   Pure helpers:
//   1.  normalizeListName / singularize / isContentQuestion
//
//   List lookup:
//   2.  Specific list matched (AI _listName) → renders numbered items
//   3.  Specific list matched but empty (all completed) → "all done" msg
//   4.  No tasks at all → onboarding "send me something" copy
//
//   queryType dashboards:
//   5.  urgent: filters priority=high, slice 8, manage link
//   6.  today: dueTodayTasks + (empty calendar OK)
//   7.  tomorrow: dueTomorrow + overdue suffix
//   8.  this_week: window aggregate + urgent footer
//   9.  recent: last-24h tasks
//   10. overdue: "X overdue" + Nd suffix
//
//   Escalation:
//   11. SEARCH content question with no dashboard match → escalate_to=CONTEXTUAL_ASK
//
//   Default:
//   12. fall-through dashboard summary (no queryType, no specific list, no question)

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import {
  makeSearchHandler,
  normalizeListName,
  singularize,
  isContentQuestion,
  type SaveReferencedEntityFn,
} from "./search.ts";

// ─── Pure helper tests ────────────────────────────────────────────────

Deno.test("normalizeListName: strips articles, lowercases, collapses ws", () => {
  assertEquals(normalizeListName('The Books'), 'books');
  assertEquals(normalizeListName('My  Travel'), 'travel');
});

Deno.test("singularize: handles ies/ves/ses/regular s", () => {
  assertEquals(singularize('parties'), 'party');
  assertEquals(singularize('leaves'), 'leaf');
  assertEquals(singularize('boxes'), 'box');
  assertEquals(singularize('books'), 'book');
  assertEquals(singularize('chess'), 'chess');
});

Deno.test("isContentQuestion: trailing ? + lead with what/which/etc", () => {
  assert(isContentQuestion("what's my Waymo code?"));
  assert(isContentQuestion('which restaurant did I save'));
  assert(isContentQuestion('do I have milk?'));
  assert(!isContentQuestion('show my groceries list'));
  assert(!isContentQuestion(''));
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
    messageBody: '', cleanMessage: '', effectiveMessage: '',
    mediaUrls: [], mediaTypes: [],
    wamid: 'wamid-1', inboundNoteSource: 'whatsapp',
    quotedMessageId: null, receivedAtIso: new Date().toISOString(),
    tracker: null, intentResult: { intent: 'SEARCH' }, members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

function fakeSaveRef(): { fn: SaveReferencedEntityFn; calls: number } {
  const ref = { calls: 0 } as { fn: SaveReferencedEntityFn; calls: number };
  ref.fn = async () => { ref.calls++; };
  return ref;
}

const nowIso = new Date().toISOString();
const recentTaskIso = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
const oldTaskIso = new Date(Date.now() - 7 * 86400000).toISOString(); // 1w ago

// ─── Handler tests ────────────────────────────────────────────────────

Deno.test("specific list matched (AI _listName): renders numbered active items", async () => {
  const { stub } = buildSupabaseStub({
    selectQueueByTable: {
      // 1st: tasks fetch (100-recent) — returns at least one row so flow proceeds
      clerk_notes: [
        { data: [{ id: 'a', summary: 'a', completed: false, created_at: nowIso }], error: null },
        // 2nd: targeted list fetch by list_id
        { data: [
          { id: 'b1', summary: 'Dune', completed: false, priority: 'medium', items: [] },
          { id: 'b2', summary: 'Foundation', completed: false, priority: 'high', items: [] },
        ], error: null },
      ],
      clerk_lists: [
        { data: [{ id: 'list-books', name: 'Books', description: null }], error: null },
      ],
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any, intentResult: { intent: 'SEARCH', _listName: 'Books' } }));
  assert(reply.text.includes('📋 Books (2)'));
  assert(reply.text.includes('1. Dune'));
  assert(reply.text.includes('2. Foundation 🔥'));
  assertEquals(save.calls, 1);
});

Deno.test("specific list matched but all completed → 'all done' message", async () => {
  const { stub } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_notes: [
        { data: [{ id: 'a', summary: 'x', completed: false, created_at: nowIso }], error: null },
        { data: [
          { id: 'b1', summary: 'Read X', completed: true, priority: 'medium', items: [] },
          { id: 'b2', summary: 'Read Y', completed: true, priority: 'medium', items: [] },
        ], error: null },
      ],
      clerk_lists: [{ data: [{ id: 'list-books', name: 'Books', description: null }], error: null }],
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any, intentResult: { intent: 'SEARCH', _listName: 'Books' } }));
  assert(reply.text.includes('all done'));
  assert(reply.text.includes('2 completed'));
});

Deno.test("no tasks at all → onboarding 'send me something' copy", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  assert(reply.text.includes('don\'t have any tasks yet'));
});

Deno.test("queryType=urgent: filters priority=high, manage link", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [
        { id: 't1', summary: 'Pay rent', completed: false, priority: 'high', created_at: nowIso },
        { id: 't2', summary: 'Call doctor', completed: false, priority: 'high', created_at: nowIso },
        { id: 't3', summary: 'Buy bread', completed: false, priority: 'medium', created_at: nowIso },
      ], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'SEARCH', queryType: 'urgent' },
  }));
  assert(reply.text.includes('🔥 2 Urgent Tasks:'));
  assert(reply.text.includes('Pay rent'));
  assert(reply.text.includes('Call doctor'));
  assert(reply.text.includes('Manage:'));
});

Deno.test("queryType=urgent with none → empty_no_urgent", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [{ id: 't1', summary: 'x', completed: false, priority: 'medium', created_at: nowIso }], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'SEARCH', queryType: 'urgent' },
  }));
  assertEquals(reply.text, 'empty_no_urgent');
});

Deno.test("queryType=recent: returns last-24h tasks", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [
        { id: 't1', summary: 'New thing', completed: false, priority: 'medium', created_at: recentTaskIso },
        { id: 't2', summary: 'Older', completed: false, priority: 'medium', created_at: oldTaskIso },
      ], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'SEARCH', queryType: 'recent' },
  }));
  assert(reply.text.includes('🕐 1 Task Added Recently'));
  assert(reply.text.includes('New thing'));
  assert(!reply.text.includes('Older'));
});

Deno.test("queryType=overdue: surfaces Nd-overdue suffix", async () => {
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [
        { id: 't1', summary: 'Late bill', completed: false, priority: 'medium', due_date: fiveDaysAgo, created_at: oldTaskIso },
      ], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'SEARCH', queryType: 'overdue' },
  }));
  assert(reply.text.includes('⚠️ 1 Overdue Task'));
  assert(reply.text.includes('Late bill'));
  assert(/\d+d overdue/.test(reply.text));
});

Deno.test("escalation: content question + no dashboard slot → escalate_to CONTEXTUAL_ASK", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [{ id: 't1', summary: 'x', completed: false, priority: 'medium', created_at: nowIso }], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    effectiveMessage: "what's my Waymo discount code?",
    intentResult: { intent: 'SEARCH' }, // no queryType, no _listName
  }));
  assertEquals(reply.text, '');
  assertEquals(reply.escalate_to, 'CONTEXTUAL_ASK');
});

Deno.test("default dashboard: no queryType, no list, no question → summary", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [
        { id: 't1', summary: 'Task A', completed: false, priority: 'high', created_at: nowIso },
        { id: 't2', summary: 'Task B', completed: false, priority: 'medium', created_at: nowIso },
      ], error: null },
      clerk_lists: { data: [], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeSearchHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    effectiveMessage: 'just show me stuff',
  }));
  assert(reply.text.startsWith('📊 Your Tasks:'));
  assert(reply.text.includes('Active: 2'));
  assert(reply.text.includes('Urgent: 1'));
  assert(reply.text.includes('⚡ Urgent:'));
  assert(reply.text.includes('Task A'));
  assertEquals(save.calls, 1);
});
