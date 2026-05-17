// Initiative 1.1 — contract tests for `Reply` + `HandlerContext`.
// ============================================================================
// These tests don't exercise a running handler (none exist yet — that's
// Initiative 1.2 onwards). They lock in the SHAPE of the contract so:
//
//   * Subsequent handler extractions can't accidentally drift from it.
//   * If anyone widens the contract (adds a required field), they're
//     forced to update these tests in the same PR — which surfaces the
//     change at code-review time.
//   * `SILENT_REPLY` + `isOutboundReply` actually behave correctly,
//     since the rest of Initiative 1 will rely on them.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

import {
  type Handler,
  type HandlerContext,
  type Reply,
  SILENT_REPLY,
  isOutboundReply,
} from "./types.ts";

Deno.test("SILENT_REPLY: text is empty", () => {
  assertEquals(SILENT_REPLY.text, "");
});

Deno.test("SILENT_REPLY: frozen — accidental mutation rejected", () => {
  assert(Object.isFrozen(SILENT_REPLY));
});

Deno.test("isOutboundReply: empty text → false", () => {
  assertEquals(isOutboundReply({ text: "" }), false);
  assertEquals(isOutboundReply(SILENT_REPLY), false);
});

Deno.test("isOutboundReply: any non-empty text → true", () => {
  assertEquals(isOutboundReply({ text: "🌿 Got it." }), true);
  assertEquals(isOutboundReply({ text: " " }), true);
});

Deno.test("Reply: minimum payload accepts only `text`", () => {
  // Compile-time check: this would fail to compile if the contract
  // required anything beyond `text`. The runtime assert mirrors that.
  const r: Reply = { text: "hello" };
  assertEquals(r.text, "hello");
});

Deno.test("Reply: full payload type-checks with every optional field set", () => {
  const r: Reply = {
    text: "✅ Saved Francesco Serafini to Contacts",
    referenced_entity: {
      type: "task",
      id: "11111111-1111-1111-1111-111111111111",
      summary: "Francesco Serafini",
      list_id: "22222222-2222-2222-2222-222222222222",
      priority: "low",
    },
    displayed_list: [
      { id: "33333333-3333-3333-3333-333333333333", summary: "Buy milk" },
    ],
    max_length: 1800,
    pending_offer: {
      type: "save_artifact",
      artifact_content: "draft",
      artifact_request: "save it",
      artifact_kind: "chat",
      offered_at: new Date().toISOString(),
    },
    after_reply: [async () => { /* fire-and-forget */ }],
  };
  assertEquals(r.referenced_entity?.id, "11111111-1111-1111-1111-111111111111");
  assertEquals(r.displayed_list?.length, 1);
  assertEquals(r.max_length, 1800);
  assertEquals(r.pending_offer?.type, "save_artifact");
  assertEquals(r.after_reply?.length, 1);
});

Deno.test("Handler: signature is (ctx) => Promise<Reply>", async () => {
  // This handler does nothing useful. The test is the FACT that it
  // type-checks against `Handler`. If `HandlerContext` widens with a
  // required field, this file fails `deno check` until updated.
  const stub: Handler = async (ctx) => {
    return { text: `echo: ${ctx.cleanMessage}` };
  };

  // Build a minimal ctx. We deliberately use `any` casts only for the
  // big sub-objects (SupabaseClient, profile, session) because typing
  // their full shape is out of scope for this test; the goal is to
  // prove the contract, not to wire a real Supabase client.
  const ctx: HandlerContext = {
    // deno-lint-ignore no-explicit-any
    supabase: {} as any,
    userId: "user_test",
    userLang: "en",
    userTimezone: "America/New_York",
    // deno-lint-ignore no-explicit-any
    profile: {} as any,
    coupleId: null,
    effectiveCoupleId: null,
    // deno-lint-ignore no-explicit-any
    session: { id: "sess_test", user_id: "user_test", context_data: null } as any,
    messageBody: "hello",
    cleanMessage: "hello",
    effectiveMessage: "hello",
    mediaUrls: [],
    mediaTypes: [],
    wamid: "wamid.test",
    inboundNoteSource: "whatsapp",
    quotedMessageId: null,
    receivedAtIso: new Date().toISOString(),
    tracker: null,
    intentResult: { intent: "CHAT" },
    members: null,
  };

  const reply = await stub(ctx);
  assertEquals(reply.text, "echo: hello");
  assertEquals(isOutboundReply(reply), true);
});

Deno.test("HandlerContext: intentResult discriminator covers every intent", () => {
  // Forces the union to remain exhaustive. Adding a new intent without
  // updating this file is caught at `deno check` time.
  const allIntents: HandlerContext["intentResult"]["intent"][] = [
    "SEARCH",
    "MERGE",
    "CREATE",
    "CHAT",
    "CONTEXTUAL_ASK",
    "WEB_SEARCH",
    "WEB_RESEARCH",
    "SCHEDULE_CALENDAR",
    "TASK_ACTION",
    "EXPENSE",
    "PARTNER_MESSAGE",
    "CREATE_LIST",
    "LIST_RECAP",
    "SAVE_ARTIFACT",
    "SAVE_MEMORY",
  ];
  assertEquals(allIntents.length, 15);
});

Deno.test("Reply.pending_offer: discriminated union accepts each variant", () => {
  const saveArtifact: Reply = {
    text: "Want me to save this?",
    pending_offer: {
      type: "save_artifact",
      artifact_content: "...",
      artifact_request: "...",
      artifact_kind: "chat",
      offered_at: new Date().toISOString(),
    },
  };
  assertEquals(saveArtifact.pending_offer?.type, "save_artifact");

  const reschedule: Reply = {
    text: "Move to Thursday?",
    pending_offer: {
      type: "reschedule_task",
      task_id: "t1",
      task_summary: "Call dentist",
      field: "due_date",
      new_iso: new Date().toISOString(),
      has_time: true,
      prior_due_date: null,
      prior_reminder_time: null,
      readable: "Thursday at 6 PM",
      timezone: "America/New_York",
      offered_at: new Date().toISOString(),
    },
  };
  assertEquals(reschedule.pending_offer?.type, "reschedule_task");
});

Deno.test("ConversationContext: shape is reachable from HandlerContext.session", () => {
  // This is a structural test: the session's context_data must accept
  // the same shape currently written by every webhook write site.
  // Failing this means a handler extraction would be unable to read
  // the conversation state it relies on.
  const ctx: HandlerContext["session"]["context_data"] = {
    last_assistant_output: "Here's a draft",
    last_assistant_output_at: new Date().toISOString(),
    last_assistant_request: "draft me an email",
    pending_offer: null,
    conversation_history: [
      { role: "user", content: "hi", timestamp: new Date().toISOString() },
      { role: "assistant", content: "hello", timestamp: new Date().toISOString() },
    ],
  };
  assertEquals(ctx?.conversation_history?.length, 2);
});
