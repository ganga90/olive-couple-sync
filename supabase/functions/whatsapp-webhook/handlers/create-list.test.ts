// Tests for the CREATE_LIST handler.
// ============================================================================
// Coverage (Initiative 1.8):
//   1. happy path: name only → list inserted + success copy
//   2. with initial items → list + N notes inserted, response counts items
//   3. duplicate same-scope → list_already_exists (no insert)
//   4. duplicate different-scope (one shared, one private) → allows creation
//   5. name shorter than 2 chars → list_no_name (no insert)
//   6. insert error → graceful "couldn't create that list"

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import { makeCreateListHandler, type SaveReferencedEntityFn } from "./create-list.ts";

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  selectByTable?: Record<string, DbResponse>;
  selectQueueByTable?: Record<string, DbResponse[]>;
  insertOverride?: { table: string; response: DbResponse };
}

interface Recorded {
  inserts: Array<{ table: string; payload: Record<string, unknown> | Array<Record<string, unknown>> }>;
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
  const recorded: Recorded = { inserts: [], updates: [] };
  const selectByTable = opts.selectByTable ?? {};
  const selectQueueByTable: Record<string, DbResponse[]> = {};
  for (const [k, v] of Object.entries(opts.selectQueueByTable ?? {})) selectQueueByTable[k] = [...v];
  let insertCount = 0;

  const responseFor = (table: string): DbResponse => {
    const q = selectQueueByTable[table];
    if (q && q.length > 0) return q.shift()!;
    return selectByTable[table] ?? { data: null, error: null };
  };

  const stub = {
    from(table: string) {
      return {
        select(_cols: string) { return makeChainable(responseFor(table)); },
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          recorded.inserts.push({ table, payload: rows });
          if (opts.insertOverride && opts.insertOverride.table === table) {
            return makeChainable(opts.insertOverride.response);
          }
          const isList = !Array.isArray(rows);
          insertCount += Array.isArray(rows) ? rows.length : 1;
          const echo = isList
            // deno-lint-ignore no-explicit-any
            ? { id: `new-list-${insertCount}`, ...(rows as any) }
            // deno-lint-ignore no-explicit-any
            : (rows as Array<Record<string, unknown>>).map((p: any, i: number) => ({ id: `new-${insertCount - rows.length + i + 1}`, ...p }));
          return makeChainable({ data: echo, error: null });
        },
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
    tracker: null, intentResult: { intent: 'CREATE_LIST' }, members: null,
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

Deno.test("happy path: name-only creates list + Title-Case + success copy", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: { clerk_lists: { data: [], error: null } },
  });
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CREATE_LIST', _listName: 'travel ideas' },
  }));

  // List insert went through with Title Case.
  const listInsert = recorded.inserts.find((i) => i.table === 'clerk_lists')!;
  assertExists(listInsert);
  // deno-lint-ignore no-explicit-any
  const payload = listInsert.payload as any;
  assertEquals(payload.name, 'Travel Ideas');
  assertEquals(payload.is_manual, true);
  // Reply includes the formatted list name + onboarding nudges.
  assert(reply.text.includes('*Travel Ideas*'));
  assert(reply.text.includes('Now just send items'));
  assertEquals(save.calls, 1);
});

Deno.test("with initial items: bulk-inserts notes + reports count", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: { clerk_lists: { data: [], error: null } },
  });
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CREATE_LIST', _listName: 'Books', _initialItems: 'Dune, Foundation; Snow Crash' },
  }));

  // The list itself + a single bulk insert of 3 notes.
  const listInsert = recorded.inserts.find((i) => i.table === 'clerk_lists');
  const notesInsert = recorded.inserts.find((i) => i.table === 'clerk_notes');
  assertExists(listInsert);
  assertExists(notesInsert);
  assert(Array.isArray(notesInsert!.payload));
  assertEquals((notesInsert!.payload as Array<unknown>).length, 3);
  assert(reply.text.includes('Added 3 items'));
});

Deno.test("duplicate same-scope: returns list_already_exists", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_lists: [
        // First fetch: returns existing personal "Work" list
        { data: [{ id: 'list-old', name: 'Work', couple_id: null }], error: null },
      ],
      clerk_notes: [
        // Active-item count fetch
        { data: [{ id: 'n1' }, { id: 'n2' }], error: null },
      ],
    },
  });
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    effectiveCoupleId: null,
    intentResult: { intent: 'CREATE_LIST', _listName: 'Work' },
  }));

  assert(reply.text.startsWith('list_already_exists'));
  assert(reply.text.includes('count=2'));
  // No new list inserted.
  assertEquals(recorded.inserts.filter((i) => i.table === 'clerk_lists').length, 0);
});

Deno.test("duplicate different-scope: personal name OK when existing was shared", async () => {
  // User has shared "Work" (couple_id=couple-1), creates personal "Work" — should be allowed.
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_lists: { data: [{ id: 'shared-work', name: 'Work', couple_id: 'couple-1' }], error: null },
    },
  });
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    coupleId: 'couple-1',
    effectiveCoupleId: null, // private scope
    intentResult: { intent: 'CREATE_LIST', _listName: 'Work' },
  }));

  // New list inserted (private), did NOT short-circuit on the shared duplicate.
  const listInsert = recorded.inserts.find((i) => i.table === 'clerk_lists');
  assertExists(listInsert);
  assert(reply.text.includes('*Work*'));
});

Deno.test("name too short → list_no_name (no insert)", async () => {
  const { stub, recorded } = buildSupabaseStub();
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CREATE_LIST', _listName: 'a' },
  }));
  assertEquals(reply.text, 'list_no_name');
  assertEquals(recorded.inserts.length, 0);
});

Deno.test("list insert error → graceful 'couldn't create' fallback", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: { clerk_lists: { data: [], error: null } },
    insertOverride: { table: 'clerk_lists', response: { data: null, error: { message: 'PG error' } } },
  });
  const save = fakeSaveRef();
  const handler = makeCreateListHandler({ t: fakeT, saveReferencedEntity: save.fn });
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'CREATE_LIST', _listName: 'Anything' },
  }));
  assert(reply.text.includes("couldn't create"));
});
