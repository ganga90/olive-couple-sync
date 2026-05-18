// Tests for the SAVE_ARTIFACT handler.
// ============================================================================
// Goal: every behavior change the SAVE_ARTIFACT block used to have inside
// the monolithic webhook is now provable from an isolated test.
//
// We mock `ctx.supabase` with a hand-rolled stub because the handler's
// surface against Supabase is small (insert into clerk_notes, optional
// select on clerk_lists, optional update on clerk_notes for embedding,
// optional update on user_sessions). The stub records calls and
// programs responses per test.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import type { HandlerContext, ConversationContext } from "../../_shared/types.ts";
import type { PendingOffer } from "../../_shared/pending-offer.ts";
import { makeSaveArtifactHandler, readArtifactFromSession } from "./save-artifact.ts";

// ─── Test scaffolding ──────────────────────────────────────────────────

type SupabaseCall =
  | { kind: 'insert-note'; payload: Record<string, unknown> }
  | { kind: 'select-list-by-id'; id: string }
  | { kind: 'select-lists-by-scope'; userId: string; coupleId: string | null }
  | { kind: 'update-note-embedding'; id: string }
  | { kind: 'update-session-clear'; id: string };

interface StubOptions {
  /** Sequenced responses for `insertNote` calls. First call gets entry [0],
   *  second gets [1], etc. Defaults to a single success entry. */
  insertResponses?: Array<{
    data: { id: string; summary: string | null; list_id: string | null } | null;
    error: { message: string; code?: string; details?: string } | null;
  }>;
  /** Lists returned for the "save it in <list>" resolution query. */
  listsForMention?: Array<{ id: string; name: string; couple_id: string | null }>;
  /** List name returned by the post-save lookup. */
  listNameForId?: Record<string, string>;
}

function buildSupabaseStub(opts: StubOptions = {}) {
  const calls: SupabaseCall[] = [];
  let insertIdx = 0;
  const insertResponses = opts.insertResponses;
  let lastInsertPayload: Record<string, unknown> | null = null;

  // Build a chainable stub that matches the surface of the Supabase
  // query builder enough to fool the handler. Each method records its
  // call into `calls` and returns the appropriate response.
  //
  // When `insertResponses` is undefined we default to an echo: return
  // the inserted row as if Postgres committed it. That matches real
  // behavior (`.insert(...).select().single()` returns the new row).
  const stub = {
    from(table: string) {
      return {
        insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
          const payload = Array.isArray(rows) ? rows[0] : rows;
          if (table === 'clerk_notes') {
            calls.push({ kind: 'insert-note', payload });
            lastInsertPayload = payload;
          }
          return {
            select() {
              return {
                single: async () => {
                  if (table !== 'clerk_notes') return { data: null, error: null };
                  if (insertResponses) {
                    const resp = insertResponses[insertIdx] ?? insertResponses[insertResponses.length - 1];
                    insertIdx++;
                    return resp;
                  }
                  // Echo mode — pretend Postgres committed the row.
                  return {
                    data: {
                      id: `note-${insertIdx++}`,
                      summary: (lastInsertPayload as { summary?: string })?.summary ?? null,
                      list_id: (lastInsertPayload as { list_id?: string })?.list_id ?? null,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },

        select(_fields: string) {
          return {
            or(filter: string) {
              // "save it in <list>" mention path → SELECT from clerk_lists.
              calls.push({
                kind: 'select-lists-by-scope',
                userId: (filter.match(/author_id\.eq\.([^,]+)/) || [])[1] || 'unknown',
                coupleId: (filter.match(/couple_id\.eq\.([^,]+)/) || [])[1] || null,
              });
              return Promise.resolve({ data: opts.listsForMention ?? [], error: null });
            },
            eq(field: string, value: string) {
              return {
                single: async () => {
                  if (table === 'clerk_lists' && field === 'id') {
                    calls.push({ kind: 'select-list-by-id', id: value });
                    const name = opts.listNameForId?.[value];
                    return { data: name ? { name } : null, error: null };
                  }
                  return { data: null, error: null };
                },
              };
            },
          };
        },

        update(patch: Record<string, unknown>) {
          return {
            eq: async (_field: string, value: string) => {
              if (table === 'clerk_notes' && 'embedding' in patch) {
                calls.push({ kind: 'update-note-embedding', id: value });
              } else if (table === 'user_sessions' && 'context_data' in patch) {
                calls.push({ kind: 'update-session-clear', id: value });
              }
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };

  return { stub, calls };
}

function buildCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  const session = overrides.session ?? {
    id: 'sess-1',
    user_id: 'user-1',
    context_data: {
      last_assistant_output: 'Some email draft content here.',
      last_assistant_output_at: new Date().toISOString(),
      last_assistant_request: 'What email draft could I write?',
    } as ConversationContext,
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
    messageBody: 'save it',
    cleanMessage: 'save it',
    effectiveMessage: 'save it',
    mediaUrls: [],
    mediaTypes: [],
    wamid: 'wamid-1',
    inboundNoteSource: 'whatsapp',
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: 'SAVE_ARTIFACT' },
    members: null,
    ...overrides,
  };
}

const fakeT = (key: string, _lang: string, vars?: Record<string, string>) => {
  if (!vars) return key;
  return key + '|' + Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',');
};

const okCallAI = async () =>
  JSON.stringify({
    title: 'Email Draft About Dinner',
    category: 'personal',
    tags: ['dinner', 'draft'],
  });

const okEmbedding = async () => [0.1, 0.2, 0.3];

// Run async after_reply callbacks the way the router would.
async function runAfterReply(after_reply?: Array<() => Promise<void>>) {
  if (!after_reply) return;
  for (const cb of after_reply) await cb();
}

// ─── readArtifactFromSession ──────────────────────────────────────────

Deno.test("readArtifactFromSession: prefers fresh pending_offer over last_assistant_*", () => {
  const offer: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'OFFER CONTENT',
    artifact_request: 'OFFER REQUEST',
    artifact_kind: 'web_search',
    offered_at: new Date().toISOString(),
  };
  const result = readArtifactFromSession({
    pending_offer: offer,
    last_assistant_output: 'STALE',
    last_assistant_request: 'STALE',
  });
  assertEquals(result?.content, 'OFFER CONTENT');
  assertEquals(result?.request, 'OFFER REQUEST');
});

Deno.test("readArtifactFromSession: stale pending_offer ignored, falls back to last_assistant_*", () => {
  const expired: PendingOffer = {
    type: 'save_artifact',
    artifact_content: 'EXPIRED',
    artifact_request: 'EXPIRED',
    artifact_kind: 'chat',
    offered_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(), // 11 min ago — beyond TTL
  };
  const result = readArtifactFromSession({
    pending_offer: expired,
    last_assistant_output: 'CURRENT',
    last_assistant_request: 'CURRENT',
  });
  assertEquals(result?.content, 'CURRENT');
});

Deno.test("readArtifactFromSession: no artifact anywhere → null", () => {
  const result = readArtifactFromSession({});
  assertEquals(result, null);
});

// ─── makeSaveArtifactHandler ──────────────────────────────────────────

Deno.test("happy path: AI succeeds, insert succeeds → reply + entity + after-reply callbacks", async () => {
  const { stub, calls } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // Reply text comes from t() with vars filled in. Smart routing flag is off
  // here AND no list was resolved → handler uses the dedicated `artifact_saved_no_list`
  // copy (cleaner than `artifact_saved` with an empty `{list}` slot).
  assert(reply.text.startsWith('artifact_saved_no_list|title=Email Draft About Dinner'));
  // referenced_entity points at the inserted note for the router to persist.
  assert(reply.referenced_entity?.id?.startsWith('note-'));
  assertEquals(reply.referenced_entity?.summary, 'Email Draft About Dinner');
  // After-reply callbacks scheduled, not yet run.
  assertEquals(reply.after_reply?.length, 2);
  // Insert happened with the AI-derived classification.
  const insertCall = calls.find((c) => c.kind === 'insert-note');
  assert(insertCall);
  assertEquals((insertCall.payload as { summary: string }).summary, 'Email Draft About Dinner');
  assertEquals((insertCall.payload as { category: string }).category, 'personal');
});

Deno.test("AI throws → save still proceeds with deterministic title", async () => {
  const { stub, calls } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: async () => {
      throw new Error('Gemini timeout');
    },
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // The save happened — the cascade-failure bug is gone.
  const insertCall = calls.find((c) => c.kind === 'insert-note');
  assert(insertCall);
  // Title fell back to deterministic extraction from the request.
  const summary = (insertCall.payload as { summary: string }).summary;
  assert(summary.length > 0);
  assert(!summary.toLowerCase().includes('saved draft'));
  assertEquals(reply.text.includes('artifact_saved'), true);
});

Deno.test("AI returns malformed JSON → fallback runs, save proceeds", async () => {
  const { stub, calls } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: async () => 'not-json-at-all',
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  await handler(buildCtx({ supabase: stub as any }));

  const insertCall = calls.find((c) => c.kind === 'insert-note');
  assert(insertCall);
  // Tag suffix always present — invariant the classifier guarantees.
  const tags = (insertCall.payload as { tags: string[] }).tags;
  assertEquals(tags.at(-1), 'olive-draft');
});

Deno.test("artifact missing → returns artifact_none, no insert attempted", async () => {
  const { stub, calls } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    session: {
      id: 'sess-1',
      user_id: 'user-1',
      context_data: {} as ConversationContext, // no artifact at all
    },
  }));

  assertEquals(reply.text, 'artifact_none');
  assertEquals(calls.length, 0);
});

Deno.test("first insert fails → minimal-payload retry, user's content survives", async () => {
  const { stub, calls } = buildSupabaseStub({
    insertResponses: [
      // First call — FK violation on space_id.
      {
        data: null,
        error: {
          message: 'insert or update on table "clerk_notes" violates foreign key constraint "clerk_notes_space_id_fkey"',
          code: '23503',
          details: 'Key (space_id)=(deadbeef-...) is not present in table "olive_spaces".',
        },
      },
      // Retry — success in personal scope.
      {
        data: { id: 'note-retry', summary: 'Email Draft About Dinner', list_id: null },
        error: null,
      },
    ],
  });

  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // TWO insert attempts.
  const inserts = calls.filter((c) => c.kind === 'insert-note');
  assertEquals(inserts.length, 2);
  // Second attempt is personal scope (couple_id null, no list_id).
  assertEquals((inserts[1].payload as { couple_id: unknown }).couple_id, null);
  // Reply still confirms a save — user never sees an error.
  assertEquals(reply.text.includes('artifact_saved'), true);
  assertEquals(reply.referenced_entity?.id, 'note-retry');
});

Deno.test("both inserts fail → artifact_save_error, no referenced_entity", async () => {
  const { stub } = buildSupabaseStub({
    insertResponses: [
      { data: null, error: { message: 'first fail', code: '23503' } },
      { data: null, error: { message: 'retry fail', code: '23503' } },
    ],
  });

  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  assertEquals(reply.text, 'artifact_save_error');
  assertEquals(reply.referenced_entity, undefined);
  assertEquals(reply.after_reply, undefined);
});

Deno.test("list mention resolves → inserts with matched list_id + inherits list's couple_id", async () => {
  const { stub, calls } = buildSupabaseStub({
    listsForMention: [
      { id: 'list-travel', name: 'Travel', couple_id: 'shared-couple' },
      { id: 'list-personal', name: 'Personal', couple_id: null },
    ],
    listNameForId: { 'list-travel': 'Travel' },
    insertResponses: [
      {
        data: { id: 'note-in-travel', summary: 'Mallorca Trip Idea', list_id: 'list-travel' },
        error: null,
      },
    ],
  });

  const handler = makeSaveArtifactHandler({
    callAI: async () => JSON.stringify({
      title: 'Mallorca Trip Idea',
      category: 'travel',
      tags: ['mallorca'],
    }),
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  const reply = await handler(buildCtx({
    // deno-lint-ignore no-explicit-any
    supabase: stub as any,
    messageBody: 'save it in Travel',
  }));

  const insertCall = calls.find((c) => c.kind === 'insert-note')!;
  assertEquals((insertCall.payload as { list_id: string }).list_id, 'list-travel');
  // List name interpolated into the confirmation copy.
  assert(reply.text.includes('list=') && reply.text.includes('Travel'));
});

Deno.test("after-reply: embedding generation runs against the saved note id", async () => {
  const { stub, calls } = buildSupabaseStub({
    insertResponses: [
      {
        data: { id: 'note-emb', summary: 'X', list_id: null },
        error: null,
      },
    ],
  });

  let embedCalledWith = '';
  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: async (txt) => {
      embedCalledWith = txt;
      return [0.5];
    },
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  await runAfterReply(reply.after_reply);

  // Embedding includes title + first chunk of content.
  assert(embedCalledWith.startsWith('Email Draft About Dinner'));
  // Update against the right note id.
  const updateCall = calls.find((c) => c.kind === 'update-note-embedding');
  assertEquals(updateCall?.id, 'note-emb');
});

Deno.test("after-reply: embedding failure is non-blocking", async () => {
  const { stub } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: async () => {
      throw new Error('embedding service down');
    },
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  // The throw must NOT escape — it's wrapped in try/catch inside the callback.
  await runAfterReply(reply.after_reply);
  // Reaching here means the throw was swallowed. Pass.
  assert(true);
});

Deno.test("after-reply: session clear resets last_assistant_* + pending_offer", async () => {
  const { stub, calls } = buildSupabaseStub();
  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));
  await runAfterReply(reply.after_reply);

  const sessionClear = calls.find((c) => c.kind === 'update-session-clear');
  assertEquals(sessionClear?.id, 'sess-1');
});

// ─── Smart-save routing (OLIVE_SMART_SAVE_ROUTING flag) ───────────────
//
// When the flag is on, the handler fetches the user's existing lists,
// passes them to the classifier, and uses the AI-suggested target list
// via the shared `resolveSaveTargetList` resolver. When the flag is off,
// behavior is identical to the pre-flag path. These tests verify both
// modes and the three confirmation-copy branches.

interface SmartStubOptions {
  /** Lists returned by the smart-routing fetch (clerk_lists order/limit). */
  existingLists?: Array<{ id: string; name: string; couple_id: string | null }>;
  /** Response when the resolver INSERTs a new list. */
  newListInsertResponse?: { data: { id: string; name: string } | null; error: unknown };
  /** Note insert response. */
  noteInsertResponse?: {
    data: { id: string; summary: string | null; list_id: string | null } | null;
    error: { message: string; code?: string } | null;
  };
}

function buildSmartStub(opts: SmartStubOptions = {}) {
  const calls: Array<{ kind: string; payload?: unknown }> = [];

  // deno-lint-ignore no-explicit-any
  const stub: any = {
    from(table: string) {
      return {
        insert(rows: Array<Record<string, unknown>> | Record<string, unknown>) {
          const row = Array.isArray(rows) ? rows[0] : rows;
          if (table === 'clerk_notes') {
            calls.push({ kind: 'insert-note', payload: row });
            return {
              select: () => ({
                single: async () =>
                  opts.noteInsertResponse ?? {
                    data: {
                      id: 'note-smart-1',
                      summary: (row as { summary?: string }).summary ?? null,
                      list_id: (row as { list_id?: string | null }).list_id ?? null,
                    },
                    error: null,
                  },
              }),
            };
          }
          if (table === 'clerk_lists') {
            calls.push({ kind: 'insert-list', payload: row });
            return {
              select: () => ({
                single: async () =>
                  opts.newListInsertResponse ?? {
                    data: { id: 'new-list-99', name: (row as { name: string }).name },
                    error: null,
                  },
              }),
            };
          }
          return { select: () => ({ single: async () => ({ data: null, error: null }) }) };
        },

        select(_cols: string) {
          const chain: Record<string, unknown> = {
            // Smart-routing fetch goes .select().or().order().limit() and awaits.
            or() { return chain; },
            order() { return chain; },
            limit() { return chain; },
            ilike() { return chain; },
            eq() {
              return {
                single: async () => ({ data: null, error: null }),
              };
            },
            // The await on the chain itself.
            then(resolve: (v: unknown) => void) {
              if (table === 'clerk_lists') {
                calls.push({ kind: 'fetch-lists' });
                resolve({ data: opts.existingLists ?? [], error: null });
              } else {
                resolve({ data: null, error: null });
              }
            },
            single: async () => ({ data: null, error: null }),
          };
          return chain;
        },

        update(patch: Record<string, unknown>) {
          return {
            eq: async (_field: string, value: string) => {
              if (table === 'user_sessions' && 'context_data' in patch) {
                calls.push({ kind: 'update-session-clear', payload: value });
              }
              return { data: null, error: null };
            },
          };
        },
      };
    },
  };

  return { stub, calls };
}

Deno.test("smart routing OFF: behavior identical to pre-flag (no lists fetched, no_list copy)", async () => {
  Deno.env.delete('OLIVE_SMART_SAVE_ROUTING');
  const { stub, calls } = buildSmartStub({
    existingLists: [{ id: 'l1', name: 'Travel', couple_id: null }],
  });

  const handler = makeSaveArtifactHandler({
    callAI: okCallAI,
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // No fetch-lists call when flag is off.
  assertEquals(calls.filter((c) => c.kind === 'fetch-lists').length, 0);
  // Default copy when no list resolved.
  assert(reply.text.startsWith('artifact_saved_no_list'));
});

Deno.test("smart routing ON + AI matches existing list → artifact_saved copy with list interpolated", async () => {
  Deno.env.set('OLIVE_SMART_SAVE_ROUTING', '1');
  const { stub, calls } = buildSmartStub({
    existingLists: [{ id: 'l-mallorca', name: 'Mallorca Trip', couple_id: 'couple-1' }],
  });

  const handler = makeSaveArtifactHandler({
    callAI: async () => JSON.stringify({
      title: 'Calatrava Hotel',
      category: 'travel',
      tags: ['hotel'],
      target_list_name: 'Mallorca Trip',
      is_new_list: false,
      confidence: 'high',
    }),
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // Smart routing fetched lists.
  assert(calls.some((c) => c.kind === 'fetch-lists'));
  // Note inserted with the matched list_id.
  const insertCall = calls.find((c) => c.kind === 'insert-note');
  assertEquals((insertCall!.payload as { list_id: string }).list_id, 'l-mallorca');
  // No new list created.
  assert(!calls.some((c) => c.kind === 'insert-list'));
  // Copy uses the existing-list variant ("in your *X* list").
  assert(reply.text.startsWith('artifact_saved|'));
  assert(reply.text.includes('Mallorca Trip'));
});

Deno.test("smart routing ON + AI proposes new list (high conf) → INSERT clerk_lists + artifact_saved_new_list copy", async () => {
  Deno.env.set('OLIVE_SMART_SAVE_ROUTING', '1');
  const { stub, calls } = buildSmartStub({
    existingLists: [],   // No existing lists.
  });

  const handler = makeSaveArtifactHandler({
    callAI: async () => JSON.stringify({
      title: 'Best Sushi in Tokyo',
      category: 'travel',
      tags: ['sushi'],
      target_list_name: 'Tokyo Trip',
      is_new_list: true,
      confidence: 'high',
    }),
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // New list was inserted via the resolver.
  const listInsert = calls.find((c) => c.kind === 'insert-list');
  assert(listInsert);
  assertEquals((listInsert!.payload as { name: string }).name, 'Tokyo Trip');
  assertEquals((listInsert!.payload as { is_manual: boolean }).is_manual, false);
  // Note inserted with the new list_id.
  const noteInsert = calls.find((c) => c.kind === 'insert-note');
  assertEquals((noteInsert!.payload as { list_id: string }).list_id, 'new-list-99');
  // Copy uses the new-list variant.
  assert(reply.text.startsWith('artifact_saved_new_list|'));
  assert(reply.text.includes('Tokyo Trip'));
});

Deno.test("smart routing ON + AI confidence=low → resolver returns null → no_list copy", async () => {
  Deno.env.set('OLIVE_SMART_SAVE_ROUTING', '1');
  const { stub, calls } = buildSmartStub({
    existingLists: [{ id: 'l-books', name: 'Books', couple_id: null }],
  });

  const handler = makeSaveArtifactHandler({
    callAI: async () => JSON.stringify({
      title: 'Random Quote',
      category: 'general',
      tags: ['quote'],
      target_list_name: null,
      is_new_list: false,
      confidence: 'low',
    }),
    generateEmbedding: okEmbedding,
    t: fakeT,
    promptVersion: 'wa-test',
  });

  // deno-lint-ignore no-explicit-any
  const reply = await handler(buildCtx({ supabase: stub as any }));

  // No new list created.
  assert(!calls.some((c) => c.kind === 'insert-list'));
  // Note inserted with null list_id.
  const noteInsert = calls.find((c) => c.kind === 'insert-note');
  assertEquals((noteInsert!.payload as { list_id: string | null }).list_id, undefined);
  // No-list copy.
  assert(reply.text.startsWith('artifact_saved_no_list'));
  // Cleanup so subsequent tests don't inherit the flag.
  Deno.env.delete('OLIVE_SMART_SAVE_ROUTING');
});
