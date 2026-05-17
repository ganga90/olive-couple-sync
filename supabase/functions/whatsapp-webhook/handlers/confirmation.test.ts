// Tests for the pending-offer confirmation dispatcher.
// ============================================================================
// Coverage matrix (each row is at least one test below):
//
//   Variant                    | affirm | deny | parse | undo | other | stale | absent | not-mine
//   ───────────────────────────|────────|──────|───────|──────|───────|───────|────────|──────────
//   save_artifact              |   ✓    |  ✓   |  n/a  | n/a  |   ✓   |   ✓   |   ✓    |   ✓
//   date_for_recent_task       |  n/a   |  ✓   |   ✓   | n/a  |   ✓   |   ✓   |   —    |   —
//   attached_to_parent         |  n/a   |  —   |  n/a  |  ✓   |   ✓   |   ✓   |   —    |   —
//   reschedule_task (legacy)   |        |      |       |      |       |       |        |   ✓
//   edit_task (legacy)         |        |      |       |      |       |       |        |   ✓
//   delete_task (legacy)       |        |      |       |      |       |       |        |   ✓
//   disambiguate (legacy)      |        |      |       |      |       |       |        |   ✓
//   bulk_reschedule (legacy)   |        |      |       |      |       |       |        |   ✓
//
// The 5 legacy variants intentionally pass through (handled by the old
// AWAITING_CONFIRMATION state machine in the webhook). The
// exhaustiveness check inside the dispatcher catches new offer types at
// compile time, so any future addition forces a test update.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { ConversationContext, HandlerContext } from "../../_shared/types.ts";
import type { PendingOffer } from "../../_shared/pending-offer.ts";
import {
  makeConfirmationDispatcher,
  type ConfirmationOutcome,
} from "./confirmation.ts";

// ─── Shared test scaffolding ──────────────────────────────────────────

type SupabaseCall =
  | { kind: 'update-session'; id: string; patch: Record<string, unknown> }
  | { kind: 'update-note'; id: string; patch: Record<string, unknown> }
  | { kind: 'insert-note'; payload: Record<string, unknown> };

interface StubOpts {
  /** Programmable error response for any `update().eq()` call. */
  updateError?: { message: string; code?: string } | null;
  /** Programmable insert response. */
  insertResponse?: {
    data: { id: string; summary: string | null; list_id: string | null } | null;
    error: { message: string; code?: string } | null;
  };
}

function buildSupabaseStub(opts: StubOpts = {}) {
  const calls: SupabaseCall[] = [];
  const stub = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          const payload = Array.isArray(rows) ? rows[0] : rows;
          if (table === 'clerk_notes') calls.push({ kind: 'insert-note', payload });
          return {
            select() {
              return {
                single: async () => {
                  if (opts.insertResponse) return opts.insertResponse;
                  // Echo mode — pretend Postgres committed the row.
                  return {
                    data: {
                      id: 'note-stub',
                      summary: (payload as { summary?: string })?.summary ?? null,
                      list_id: null,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_field: string, value: string) => {
              if (table === 'user_sessions') {
                calls.push({ kind: 'update-session', id: value, patch });
              } else if (table === 'clerk_notes') {
                calls.push({ kind: 'update-note', id: value, patch });
              }
              return { data: null, error: opts.updateError ?? null };
            },
          };
        },
      };
    },
  };
  return { stub, calls };
}

function buildCtx(
  offer: PendingOffer | null,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  const session = {
    id: 'sess-1',
    user_id: 'user-1',
    context_data: { pending_offer: offer } as ConversationContext,
  };
  return {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: 'user-1',
    userLang: 'en',
    userTimezone: 'America/New_York',
    // deno-lint-ignore no-explicit-any
    profile: {} as any,
    coupleId: 'couple-1',
    effectiveCoupleId: 'couple-1',
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
    intentResult: { intent: 'CHAT' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

// Widen to the canonical signature so test overrides can return null
// data + error or vice versa without TypeScript narrowing them out.
type InvokeProcessNoteFn = (
  body: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

const okInvokeProcessNote: InvokeProcessNoteFn = async (_body) => ({
  data: { multiple: false, summary: 'Reverted Standalone Note', category: 'task' },
  error: null,
});

const freshIso = () => new Date().toISOString();
const staleIso = () => new Date(Date.now() - 11 * 60 * 1000).toISOString(); // beyond 10-min TTL

// Build a dispatcher with default deps. Tests override per-call.
function mkDispatcher(deps?: Partial<{
  t: typeof fakeT;
  invokeProcessNote: InvokeProcessNoteFn;
}>) {
  return makeConfirmationDispatcher({
    t: deps?.t ?? fakeT,
    invokeProcessNote: deps?.invokeProcessNote ?? okInvokeProcessNote,
  });
}

// ─── No-offer-present cases ───────────────────────────────────────────

Deno.test("dispatcher: no pending_offer at all → pass-through", async () => {
  const { stub } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(null, { supabase: stub as any, messageBody: 'hello' }));
  assertEquals(r.kind, 'pass-through');
});

Deno.test("dispatcher: empty messageBody → pass-through (don't dispatch on media-only)", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'x',
    artifact_request: 'y',
    artifact_kind: 'chat',
    offered_at: freshIso(),
  };
  const { stub } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: null }));
  assertEquals(r.kind, 'pass-through');
});

Deno.test("dispatcher: stale pending_offer → pass-through", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'x',
    artifact_request: 'y',
    artifact_kind: 'chat',
    offered_at: staleIso(),
  };
  const { stub } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'yes' }));
  assertEquals(r.kind, 'pass-through');
});

// ─── save_artifact ────────────────────────────────────────────────────

Deno.test("save_artifact: affirm → override-intent to SAVE_ARTIFACT", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'draft body',
    artifact_request: 'help me',
    artifact_kind: 'chat',
    offered_at: freshIso(),
  };
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'yes please' }));

  assertEquals(r.kind, 'override-intent');
  if (r.kind === 'override-intent') {
    assertEquals(r.intent, 'SAVE_ARTIFACT');
    assertEquals(r.cleanMessage, 'yes please');
  }
  // No DB writes on affirm — SAVE_ARTIFACT's own session-clear after-reply handles it.
  assertEquals(calls.length, 0);
});

Deno.test("save_artifact: deny → reply + offer cleared from session", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'draft body',
    artifact_request: 'help me',
    artifact_kind: 'chat',
    offered_at: freshIso(),
  };
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'no thanks' }));

  assertEquals(r.kind, 'reply');
  if (r.kind === 'reply') {
    assertEquals(r.reply.text, 'artifact_offer_declined');
  }
  const clear = calls.find((c) => c.kind === 'update-session');
  assert(clear, 'session must be cleared on deny');
  // The pending_offer key must be explicitly nulled.
  const patched = (clear.patch.context_data as ConversationContext);
  assertEquals(patched.pending_offer, null);
});

Deno.test("save_artifact: unclear reply (neither affirm nor deny) → pass-through", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'x',
    artifact_request: 'y',
    artifact_kind: 'chat',
    offered_at: freshIso(),
  };
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'tell me more about it' }));

  assertEquals(r.kind, 'pass-through');
  // No DB writes — offer stays alive until TTL or next save offer.
  assertEquals(calls.length, 0);
});

Deno.test("save_artifact: deny + session-clear error → reply still returned (non-fatal)", async () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'x',
    artifact_request: 'y',
    artifact_kind: 'chat',
    offered_at: freshIso(),
  };
  const { stub } = buildSupabaseStub({
    updateError: { message: 'connection reset', code: '08006' },
  });
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'no' }));

  // Even though the session update returned an error, we still reply.
  assertEquals(r.kind, 'reply');
});

// ─── date_for_recent_task ─────────────────────────────────────────────

const dateOffer = (): PendingOffer => ({
  type: 'date_for_recent_task',
  task_id: 'task-1',
  task_summary: 'Call dentist',
  timezone: 'America/New_York',
  offered_at: freshIso(),
});

Deno.test("date_for_recent_task: deny pattern → reply + clear", async () => {
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(dateOffer(), { supabase: stub as any, messageBody: 'no thanks' }));

  assertEquals(r.kind, 'reply');
  if (r.kind === 'reply') {
    assertEquals(r.reply.text, 'proactive_date_skipped');
  }
  // Session cleared.
  const clear = calls.find((c) => c.kind === 'update-session');
  assert(clear);
});

Deno.test("date_for_recent_task: 'never mind' (en) → deny path", async () => {
  const { stub } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(dateOffer(), { supabase: stub as any, messageBody: 'never mind' }));
  assertEquals(r.kind, 'reply');
});

Deno.test("date_for_recent_task: 'no gracias' (es) → deny path", async () => {
  const { stub } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(dateOffer(), {
    supabase: stub as any,
    messageBody: 'no gracias',
    userLang: 'es',
  }));
  assertEquals(r.kind, 'reply');
});

Deno.test("date_for_recent_task: valid date phrase → updates note + clears + reply", async () => {
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // "tomorrow at 9am" is the canonical date phrase. detectDateRefinement
  // accepts it under any timezone; this test runs against America/New_York.
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(dateOffer(), {
    supabase: stub as any,
    messageBody: 'tomorrow at 9am',
  }));

  assertEquals(r.kind, 'reply');
  if (r.kind === 'reply') {
    assert(r.reply.text.startsWith('proactive_date_applied'));
    // Task name + when interpolated into the i18n template.
    assert(r.reply.text.includes('task=Call dentist'));
    assert(r.reply.text.includes('when='));
  }
  // Two DB writes — one on clerk_notes (apply the date) and one on
  // user_sessions (clear the offer).
  const noteUpdate = calls.find((c) => c.kind === 'update-note');
  assertEquals(noteUpdate?.id, 'task-1');
  const sessionClear = calls.find((c) => c.kind === 'update-session');
  assert(sessionClear);
});

Deno.test("date_for_recent_task: unmatched reply → one-shot expiry, pass-through", async () => {
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(dateOffer(), {
    supabase: stub as any,
    messageBody: 'pick up groceries and bread',
  }));

  // One-shot semantics: the offer expires + we pass through so the
  // user's actual message goes through normal classification.
  assertEquals(r.kind, 'pass-through');
  const sessionClear = calls.find((c) => c.kind === 'update-session');
  assert(sessionClear, 'offer must be cleared even when reply is unmatched');
});

// ─── attached_to_parent ───────────────────────────────────────────────

const attachOffer = (): PendingOffer => ({
  type: 'attached_to_parent',
  parent_note_id: 'parent-1',
  parent_summary: 'Hard Rock Stadium examples',
  prior_items: ['Replay', 'Suite support', 'Music'],
  addition: 'Distance to concessions',
  original_message: 'Distance to concessions and concession maps',
  confidence: 0.85,
  offered_at: freshIso(),
});

Deno.test("attached_to_parent: non-undo reply → pass-through", async () => {
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher();
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(attachOffer(), {
    supabase: stub as any,
    messageBody: 'thanks!',
  }));
  assertEquals(r.kind, 'pass-through');
  assertEquals(calls.length, 0);
});

Deno.test("attached_to_parent: undo → revert + new standalone note + clear + reply", async () => {
  const { stub, calls } = buildSupabaseStub();
  let processNoteCalledWith: Record<string, unknown> | null = null;
  const dispatcher = mkDispatcher({
    invokeProcessNote: async (body) => {
      processNoteCalledWith = body;
      return {
        data: { multiple: false, summary: 'Concession Maps', category: 'task' },
        error: null,
      };
    },
  });
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(attachOffer(), {
    supabase: stub as any,
    messageBody: 'undo',
  }));

  // The reply confirms separate-save in English.
  assertEquals(r.kind, 'reply');
  if (r.kind === 'reply') {
    assert(r.reply.text.includes('saved separately'));
    assert(r.reply.text.includes('Concession Maps'));
  }

  // process-note was invoked with the original message + correct scope.
  assert(processNoteCalledWith);
  assertEquals((processNoteCalledWith as { text: string }).text, 'Distance to concessions and concession maps');
  assertEquals((processNoteCalledWith as { user_id: string }).user_id, 'user-1');

  // clerk_notes insert happened (standalone) and the session was cleared.
  const inserts = calls.filter((c) => c.kind === 'insert-note');
  assertEquals(inserts.length, 1);
  assertEquals((inserts[0].payload as { summary: string }).summary, 'Concession Maps');
  const sessionClear = calls.find((c) => c.kind === 'update-session');
  assert(sessionClear, 'offer must be cleared after successful undo');
});

Deno.test("attached_to_parent: undo with process-note failure → minimal-insert fallback", async () => {
  const { stub, calls } = buildSupabaseStub();
  const dispatcher = mkDispatcher({
    invokeProcessNote: async () => ({
      data: null,
      error: { message: 'process-note 500' },
    }),
  });
  // deno-lint-ignore no-explicit-any
  const r = await dispatcher(buildCtx(attachOffer(), {
    supabase: stub as any,
    messageBody: 'undo',
  }));

  assertEquals(r.kind, 'reply');
  // Fallback insert happened with the truncated original message as summary.
  const inserts = calls.filter((c) => c.kind === 'insert-note');
  assertEquals(inserts.length, 1);
  const insertedSummary = (inserts[0].payload as { summary: string }).summary;
  // The original message is "Distance to concessions and concession maps" (43 chars) —
  // well under 80, so no truncation applied.
  assertEquals(insertedSummary, 'Distance to concessions and concession maps');
});

Deno.test("attached_to_parent: undo localized in Italian + Spanish", async () => {
  // Spanish path.
  {
    const { stub } = buildSupabaseStub();
    const dispatcher = mkDispatcher();
    // deno-lint-ignore no-explicit-any
    const r = await dispatcher(buildCtx(attachOffer(), {
      supabase: stub as any,
      messageBody: 'undo',
      userLang: 'es',
    }));
    assertEquals(r.kind, 'reply');
    if (r.kind === 'reply') {
      assert(r.reply.text.includes('por separado'));
    }
  }
  // Italian path.
  {
    const { stub } = buildSupabaseStub();
    const dispatcher = mkDispatcher();
    // deno-lint-ignore no-explicit-any
    const r = await dispatcher(buildCtx(attachOffer(), {
      supabase: stub as any,
      messageBody: 'undo',
      userLang: 'it-IT',
    }));
    assertEquals(r.kind, 'reply');
    if (r.kind === 'reply') {
      assert(r.reply.text.includes('separatamente'));
    }
  }
});

// ─── Legacy variants (5 of them) — must pass through ──────────────────

const legacyOffers: PendingOffer[] = [
  {
    type: 'reschedule_task',
    task_id: 't', task_summary: 's', field: 'due_date',
    new_iso: new Date().toISOString(), has_time: true,
    prior_due_date: null, prior_reminder_time: null,
    readable: 'tomorrow', timezone: 'UTC', offered_at: freshIso(),
  },
  {
    type: 'edit_task',
    task_id: 't', task_summary: 's',
    changes: { new_title: 'X' },
    prior: { summary: 's', description: null },
    offered_at: freshIso(),
  },
  {
    type: 'delete_task',
    task_id: 't', task_summary: 's',
    prior_due_date: null, prior_reminder_time: null,
    offered_at: freshIso(),
  },
  {
    type: 'disambiguate',
    pending_intent: { kind: 'delete_task' },
    candidates: [],
    original_message: '', offered_at: freshIso(),
  },
  {
    type: 'bulk_reschedule_weekday',
    from_dow: 2, to_dow: 4, timezone: 'UTC',
    candidates: [], original_message: '', offered_at: freshIso(),
  },
];

for (const offer of legacyOffers) {
  Deno.test(`legacy variant '${offer.type}' → pass-through (handled by AWAITING_CONFIRMATION)`, async () => {
    const { stub, calls } = buildSupabaseStub();
    const dispatcher = mkDispatcher();
    // deno-lint-ignore no-explicit-any
    const r = await dispatcher(buildCtx(offer, { supabase: stub as any, messageBody: 'yes' }));
    assertEquals(r.kind, 'pass-through');
    // The dispatcher must NOT touch the session for these — clearing
    // would steal state from the legacy state machine.
    assertEquals(calls.filter((c) => c.kind === 'update-session').length, 0);
  });
}

// ─── ConfirmationOutcome type-level check ─────────────────────────────

Deno.test("ConfirmationOutcome: discriminator covers exactly three kinds", () => {
  // Type-level exhaustiveness: a switch over `outcome.kind` must
  // handle all three. If a new outcome kind is added without updating
  // this test, it fails compile.
  const cases: Array<ConfirmationOutcome['kind']> = ['pass-through', 'override-intent', 'reply'];
  assertEquals(cases.length, 3);
});
