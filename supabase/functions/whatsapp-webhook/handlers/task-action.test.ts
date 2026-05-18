// Tests for the TASK_ACTION handler.
// ============================================================================
// Coverage (Initiative 1.7b acceptance criteria — happy path + edge cases):
//
//   Task resolution:
//   1.  parseOrdinalIndex (pure helper)
//   2.  quoted-message context wins over other paths
//   3.  relative reference ("last task") resolves via resolveRelativeReference
//   4.  ordinal ("the first one") from session.last_displayed_list
//   5.  AI UUID with matchQuality < 0.4 → REJECTED, falls through
//   6.  semantic-search ambiguity (top-2 within 15%) → disambiguation offer
//
//   Action happy paths:
//   7.  complete → direct update + saveReferencedEntity called
//   8.  set_priority → direct update + priority_updated
//   9.  set_due → parseNaturalDate → pending_action offer (set_due_date)
//   10. assign → pending_action offer
//   11. delete → snapshot + pending_action offer
//   12. move (existing list, case-insensitive) → direct move + saveReferencedEntity
//   13. remind w/ explicit time → pending_action offer (set_reminder)
//   14. remind w/o time → smart default (smart_reminder_tomorrow_9am)
//
//   Edge cases:
//   15. task_not_found (semantic search returns nothing, not a pronoun)
//   16. weak candidate (0.2 <= quality < 0.4) → "Did you mean X?" offer
//   17. bulk_reschedule_weekday happy path → confirm_bulk_reschedule
//   18. unknown action → task_action_unknown

import { assert, assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import {
  makeTaskActionHandler,
  parseOrdinalIndex,
  type SaveReferencedEntityFn,
} from "./task-action.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type DbResponse = { data: unknown; error: unknown };

interface StubOptions {
  /** Map "table:select" → response. The chainable swallows further
   *  operators (.eq, .or, .order, .limit, .neq) and resolves to this
   *  response when .single()/.maybeSingle()/await runs. */
  selectByTable?: Record<string, DbResponse>;
  /** Queue of select responses per table — pops in FIFO order; falls
   *  back to selectByTable if queue is exhausted. */
  selectQueueByTable?: Record<string, DbResponse[]>;
  /** rpc(name) → response. */
  rpcData?: Record<string, DbResponse>;
  /** functions.invoke(name) → response. */
  invokeData?: Record<string, DbResponse>;
  /** Optional override of the insert resolver. Defaults to echoing
   *  back `{ id: 'new-<n>', ...payload }`. */
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
  const selectByTable = opts.selectByTable ?? {};
  const selectQueueByTable: Record<string, DbResponse[]> = {};
  for (const [k, v] of Object.entries(opts.selectQueueByTable ?? {})) {
    selectQueueByTable[k] = [...v];
  }
  const rpcData = opts.rpcData ?? {};
  const invokeData = opts.invokeData ?? {};
  let insertCount = 0;

  const responseFor = (table: string): DbResponse => {
    const queue = selectQueueByTable[table];
    if (queue && queue.length > 0) return queue.shift()!;
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
          insertCount += payloads.length;
          if (opts.insertResponse) return makeChainable(opts.insertResponse);
          const echo = payloads.map((p, i) => ({
            id: `new-${insertCount - payloads.length + i + 1}`,
            ...(p as Record<string, unknown>),
          }));
          return makeChainable({
            data: payloads.length > 1 ? echo : echo[0],
            error: null,
          });
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
      display_name: 'Test',
      phone_number: '+15555550100',
      timezone: 'America/New_York',
      language_preference: 'en',
      default_privacy: 'shared',
    },
    coupleId: null,
    effectiveCoupleId: null,
    session,
    messageBody: '',
    cleanMessage: '',
    effectiveMessage: '',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'TASK_ACTION' },
    members: null,
    quotedTaskCtx: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

const fakeEmbedding = async () => new Array(1536).fill(0.01);

function fakeSaveRef(): { fn: SaveReferencedEntityFn; calls: Array<{ task: unknown; response: string }> } {
  const calls: Array<{ task: unknown; response: string }> = [];
  const fn: SaveReferencedEntityFn = async (task, oliveResponse) => {
    calls.push({ task, response: oliveResponse });
  };
  return { fn, calls };
}

const baseDeps = () => {
  const ref = fakeSaveRef();
  return {
    deps: {
      t: fakeT,
      generateEmbedding: fakeEmbedding,
      saveReferencedEntity: ref.fn,
    },
    refCalls: ref.calls,
  };
};

// ─── 1. parseOrdinalIndex (pure helper) ────────────────────────────────

Deno.test("parseOrdinalIndex: word + digit forms", () => {
  assertEquals(parseOrdinalIndex('the first one'), 0);
  assertEquals(parseOrdinalIndex('the third task'), 2);
  assertEquals(parseOrdinalIndex('#3'), 2);
  assertEquals(parseOrdinalIndex('number 5'), 4);
  assertEquals(parseOrdinalIndex('nothing ordinal here'), -1);
  assertEquals(parseOrdinalIndex(''), -1);
});

// ─── 2. Quoted-message context wins ────────────────────────────────────

Deno.test("quoted-message context resolves before other paths (complete)", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: {
        data: { id: 'task-quoted', summary: 'Quoted task', completed: false, priority: 'medium', author_id: 'user-1' },
        error: null,
      },
    },
  });
  const { deps, refCalls } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-quoted', task_summary: 'Quoted task', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'it' },
    messageBody: 'mark it done',
  }));

  assertEquals(reply.text, 'task_completed|task=Quoted task');
  // Update of clerk_notes was sent (completed: true).
  const completed = recorded.updates.find((u) => u.table === 'clerk_notes' && u.patch.completed === true);
  assertExists(completed);
  // saveReferencedEntity was called at least once (focal-entity + post-action).
  assert(refCalls.length >= 1);
});

// ─── 3. Relative reference "last task" ─────────────────────────────────

Deno.test("relative reference 'last task' resolves via resolveRelativeReference (complete)", async () => {
  // resolveRelativeReference does `.from('clerk_notes').select(...).eq().order().limit()` → array.
  // Our stub resolves the entire chain to the same selectByTable response.
  // After resolution, the handler does another `.from('clerk_notes').update(...)` for complete.
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: [{ id: 'task-last', summary: 'Last note', completed: false, author_id: 'user-1' }], error: null },
    },
  });
  const { deps, refCalls } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'last task' },
    messageBody: 'complete the last task',
  }));

  assertEquals(reply.text, 'task_completed|task=Last note');
  assert(refCalls.length >= 1);
});

// ─── 4. Ordinal from displayed_list ────────────────────────────────────

Deno.test("ordinal 'the first one' resolves from session.last_displayed_list", async () => {
  const session = {
    id: 'sess-1',
    user_id: 'user-1',
    context_data: {
      last_displayed_list: [
        { id: 'task-A', summary: 'First task', position: 0 },
        { id: 'task-B', summary: 'Second task', position: 1 },
      ],
      list_displayed_at: new Date().toISOString(),
    } as ConversationContext,
  };
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-A', summary: 'First task', completed: false, author_id: 'user-1' }, error: null },
    },
  });
  const { deps, refCalls } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    session,
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'the first one' },
    messageBody: 'complete the first one',
  }));

  assertEquals(reply.text, 'task_completed|task=First task');
  assert(refCalls.length >= 1);
});

// ─── 5. AI UUID with weak matchQuality is rejected ─────────────────────

Deno.test("AI UUID with matchQuality < 0.4 is rejected → falls through to task_not_found", async () => {
  // AI returns a UUID but actionTarget words don't overlap with the task summary.
  // Then semantic search returns nothing (no rpc data) → not_found.
  const { stub } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-x', summary: 'Buy almond milk', completed: false }, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: {
      intent: 'TASK_ACTION',
      actionType: 'complete',
      actionTarget: 'doctor appointment',
      _aiTaskId: 'task-x',
    },
    messageBody: 'complete the doctor appointment',
  }));

  // No words overlap → matchQuality 0 → rejected. Semantic search returns nothing
  // (no rpc data and no keyword-fallback data on clerk_notes for this query).
  // Eventually returns task_not_found.
  assert(reply.text.startsWith('task_not_found'));
});

// ─── 6. Semantic-search ambiguity → disambiguation offer ───────────────

Deno.test("semantic-search ambiguity (top-2 close) → AWAITING_DISAMBIGUATION offer", async () => {
  const { stub, recorded } = buildSupabaseStub({
    rpcData: {
      hybrid_search_notes: {
        data: [
          // Two clearly matching candidates with near-identical word overlap.
          { id: 'task-1', summary: 'meeting with marco', completed: false, score: 0.9 },
          { id: 'task-2', summary: 'meeting with sofia', completed: false, score: 0.88 },
        ],
        error: null,
      },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'meeting' },
    messageBody: 'complete the meeting',
  }));

  // Disambiguation reply uses task_ambiguous key.
  assert(reply.text.startsWith('task_ambiguous'));
  // Session was put into AWAITING_DISAMBIGUATION.
  const sessUpdate = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_DISAMBIGUATION'
  );
  assertExists(sessUpdate);
});

// ─── 7. complete happy path ────────────────────────────────────────────

Deno.test("complete: direct update + task_completed + saveReferencedEntity", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-1', summary: 'Walk the dog', completed: false }, error: null },
    },
  });
  const { deps, refCalls } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Walk the dog', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'it' },
  }));

  assertEquals(reply.text, 'task_completed|task=Walk the dog');
  // Completed update fired.
  assertExists(recorded.updates.find((u) => u.table === 'clerk_notes' && u.patch.completed === true));
  // Post-action saveReferencedEntity carried the response text.
  assert(refCalls.some((c) => c.response === 'task_completed|task=Walk the dog'));
});

// ─── 8. set_priority happy path ────────────────────────────────────────

Deno.test("set_priority: direct update + priority_updated", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-1', summary: 'Buy milk', completed: false, priority: 'medium' }, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Buy milk', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'set_priority', actionTarget: 'it' },
    effectiveMessage: 'make it high priority',
  }));

  assert(reply.text.startsWith('priority_updated'));
  assert(reply.text.includes('priority=high'));
  // Update with priority field present.
  const upd = recorded.updates.find((u) => u.table === 'clerk_notes' && u.patch.priority === 'high');
  assertExists(upd);
});

// ─── 9. set_due → pending_action offer ─────────────────────────────────

Deno.test("set_due: parseNaturalDate → AWAITING_CONFIRMATION (set_due_date)", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-1', summary: 'Doctor visit', completed: false, due_date: null, reminder_time: null }, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Doctor visit', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'set_due', actionTarget: 'it' },
    effectiveMessage: 'tomorrow',
  }));

  assert(reply.text.startsWith('confirm_set_due'));
  // pending_action.type === 'set_due_date'
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  const ctxData = (sessUpd!.patch as any).context_data;
  assertEquals(ctxData.pending_action.type, 'set_due_date');
  assertEquals(ctxData.pending_action.task_id, 'task-1');
});

// ─── 10. assign → pending_action offer (couple resolved) ───────────────

Deno.test("assign: pending_action offer with partner lookup", async () => {
  // We need clerk_notes (task), clerk_couple_members (partner), clerk_couples (partner_name).
  const { stub, recorded } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_notes: [
        { data: { id: 'task-1', summary: 'Pay rent', completed: false }, error: null },
      ],
      clerk_couple_members: [
        { data: { user_id: 'user-2' }, error: null },
      ],
      clerk_couples: [
        { data: { you_name: 'Me', partner_name: 'Marco', created_by: 'user-1' }, error: null },
      ],
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    coupleId: 'couple-1',
    effectiveCoupleId: 'couple-1',
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Pay rent', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'assign', actionTarget: 'it' },
  }));

  assert(reply.text.startsWith('confirm_assign'));
  assert(reply.text.includes('partner=Marco'));
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  assertEquals((sessUpd!.patch as any).context_data.pending_action.type, 'assign');
});

// ─── 11. delete → snapshot + pending_action offer ─────────────────────

Deno.test("delete: snapshot prior row + AWAITING_CONFIRMATION offer", async () => {
  // Resolution + delete snapshot both hit clerk_notes; then calendar_events lookup.
  const { stub, recorded } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_notes: [
        // resolution (via quotedTaskCtx)
        { data: { id: 'task-1', summary: 'Old task', completed: false, due_date: null, reminder_time: null }, error: null },
        // snapshot for undo
        { data: { id: 'task-1', summary: 'Old task', author_id: 'user-1' }, error: null },
      ],
      calendar_events: [
        { data: null, error: null },
      ],
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Old task', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'delete', actionTarget: 'it' },
  }));

  assert(reply.text.startsWith('confirm_delete'));
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  const pa = (sessUpd!.patch as any).context_data.pending_action;
  assertEquals(pa.type, 'delete');
  assertEquals(pa.task_id, 'task-1');
  // restored_row was snapshotted.
  assertExists(pa.restored_row);
});

// ─── 12. move (existing list, case-insensitive) ────────────────────────

Deno.test("move: existing list matched case-insensitively → direct move", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectQueueByTable: {
      clerk_notes: [
        { data: { id: 'task-1', summary: 'Email Boss', completed: false }, error: null },
      ],
      clerk_lists: [
        { data: [{ id: 'list-work', name: 'Work' }, { id: 'list-personal', name: 'Personal' }], error: null },
      ],
    },
  });
  const { deps, refCalls } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Email Boss', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'move', actionTarget: 'it' },
    effectiveMessage: 'work',
  }));

  assert(reply.text.includes('Moved "Email Boss" to Work'));
  // Update was fired with list_id = list-work.
  const upd = recorded.updates.find((u) => u.table === 'clerk_notes' && u.patch.list_id === 'list-work');
  assertExists(upd);
  // Post-move saveReferencedEntity carried the response.
  assert(refCalls.some((c) => c.response.includes('Moved "Email Boss"')));
});

// ─── 13. remind with explicit time → offer ─────────────────────────────

Deno.test("remind: explicit time → AWAITING_CONFIRMATION (set_reminder)", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-1', summary: 'Call mom', completed: false, due_date: null, reminder_time: null }, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Call mom', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'remind', actionTarget: 'it' },
    effectiveMessage: 'tomorrow at 9am',
  }));

  assert(reply.text.startsWith('confirm_set_reminder'));
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  assertEquals((sessUpd!.patch as any).context_data.pending_action.type, 'set_reminder');
});

// ─── 14. remind w/o time → smart default ───────────────────────────────

Deno.test("remind without time + no due_date → smart_reminder_tomorrow_9am default", async () => {
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: { data: { id: 'task-1', summary: 'Pay rent', completed: false, due_date: null, reminder_time: null }, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Pay rent', sent_at: new Date().toISOString() },
    intentResult: { intent: 'TASK_ACTION', actionType: 'remind', actionTarget: 'it' },
    effectiveMessage: '',
    messageBody: '',
  }));

  // The smart-default copy uses smart_reminder_tomorrow_9am as the readable string.
  assert(reply.text.includes('smart_reminder_tomorrow_9am'));
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  assertEquals((sessUpd!.patch as any).context_data.pending_action.type, 'set_reminder');
});

// ─── 15. task_not_found ────────────────────────────────────────────────

Deno.test("task_not_found when nothing resolves and actionTarget is non-pronoun", async () => {
  const { stub } = buildSupabaseStub({
    // No matching task anywhere — semantic RPC returns nothing.
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: { intent: 'TASK_ACTION', actionType: 'complete', actionTarget: 'nonexistent xyzzy' },
    messageBody: 'complete nonexistent xyzzy',
  }));

  assert(reply.text.startsWith('task_not_found'));
  assert(reply.text.includes('query=nonexistent xyzzy'));
});

// ─── 16. Weak candidate → "Did you mean X?" ────────────────────────────

Deno.test("weak candidate (0.2–0.4 quality) → task_did_you_mean offer", async () => {
  // computeMatchQuality counts: 'book hotel' = {book, hotel} vs candidate
  // 'Reserve hotel for Mallorca' → tokens {reserve, hotel, for, mallorca}.
  // matchQuality = 1/2 = 0.5 ≥ 0.4 → would be auto-selected. We want
  // 0.2 ≤ q < 0.4, so use a query like 'book hotel mallorca dinner trip'
  // (5 tokens) against 'Reserve hotel for Mallorca' (3 distinct content tokens)
  // → matched = hotel + mallorca = 2/5 = 0.4. Edge case. Use 6-token query
  // so matched = 2/6 = 0.33 → weak band.
  const { stub, recorded } = buildSupabaseStub({
    rpcData: {
      hybrid_search_notes: {
        data: [
          { id: 'task-1', summary: 'Reserve hotel for Mallorca', completed: false, score: 0.5 },
        ],
        error: null,
      },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: {
      intent: 'TASK_ACTION', actionType: 'set_due',
      actionTarget: 'book hotel mallorca dinner trip departure',
    },
    messageBody: 'set due book hotel mallorca dinner trip departure tomorrow',
  }));

  assert(reply.text.startsWith('task_did_you_mean'));
  // Session was put into AWAITING_DISAMBIGUATION with the single weak candidate.
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_DISAMBIGUATION'
  );
  assertExists(sessUpd);
});

// ─── 17. bulk_reschedule_weekday happy path ────────────────────────────

Deno.test("bulk_reschedule_weekday: shifts candidates and freezes confirmation", async () => {
  // resolveWeekdayCandidates pulls incomplete tasks via
  // `clerk_notes` select+order+limit and filters by day-of-week in app.
  // shiftToWeekday is real and computes the new ISO for the target day.
  const fromIso = '2026-05-18T14:00:00Z'; // Monday 10:00 EDT in America/New_York
  const { stub, recorded } = buildSupabaseStub({
    selectByTable: {
      clerk_notes: {
        data: [
          { id: 'task-1', summary: 'Monday call', due_date: fromIso, reminder_time: fromIso },
          { id: 'task-2', summary: 'Monday gym', due_date: fromIso, reminder_time: fromIso },
        ],
        error: null,
      },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    intentResult: {
      intent: 'TASK_ACTION',
      actionType: 'bulk_reschedule_weekday',
      _fromDow: 1, // Monday
      _toDow: 2, // Tuesday
    },
  }));

  assert(reply.text.startsWith('confirm_bulk_reschedule'));
  // Session set to AWAITING_CONFIRMATION with type bulk_reschedule_weekday.
  const sessUpd = recorded.updates.find((u) =>
    u.table === 'user_sessions' && u.patch.conversation_state === 'AWAITING_CONFIRMATION'
  );
  assertExists(sessUpd);
  // deno-lint-ignore no-explicit-any
  const pa = (sessUpd!.patch as any).context_data.pending_action;
  assertEquals(pa.type, 'bulk_reschedule_weekday');
  assertEquals(pa.candidates.length, 2);
});

// ─── 18. Unknown action → task_action_unknown ──────────────────────────

Deno.test("unknown actionType → task_action_unknown fallthrough", async () => {
  const { stub } = buildSupabaseStub({
    selectByTable: {
      // deno-lint-ignore no-explicit-any
      clerk_notes: { data: { id: 'task-1', summary: 'Something', completed: false } as any, error: null },
    },
  });
  const { deps } = baseDeps();
  const handler = makeTaskActionHandler(deps);
  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    quotedTaskCtx: { task_id: 'task-1', task_summary: 'Something', sent_at: new Date().toISOString() },
    // deno-lint-ignore no-explicit-any
    intentResult: { intent: 'TASK_ACTION', actionType: 'unsupported_thing' as any, actionTarget: 'it' },
  }));

  assertEquals(reply.text, 'task_action_unknown');
});
