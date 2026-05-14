/**
 * Tests for conversation-continuity helpers.
 *
 * These exercise the three production bugs reported May 13:
 *
 *   Bug 1: "Text Jacopo Amazon tomorrow" routed to partner Almu instead
 *          of being saved as a brain-dump task.
 *
 *   Bug 3: "Set it due for Friday at 5pm" after an AWAITING_CONFIRMATION
 *          set_due_date proposal failed to resolve "it" — the helper now
 *          refines the same pending proposal instead of cancelling.
 *
 * Bug 2 (calendar follow-up "And for Friday?") is exercised by the
 * date-scoped SEARCH branch in whatsapp-webhook + the classifier prompt
 * change; both are integration-level and not unit-tested here.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  detectMisroutedPartnerRelay,
  detectSetDueRefinement,
} from "./conversation-continuity.ts";

// ─── detectMisroutedPartnerRelay ────────────────────────────────────

Deno.test("detectMisroutedPartnerRelay: third-party name → downgrade (Bug 1)", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Text Jacopo Amazon tomorrow", "Almu", null),
    "Jacopo",
  );
});

Deno.test("detectMisroutedPartnerRelay: actual partner first-name → keep as relay", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Tell Almu to buy milk", "Almu", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: actual partner case-insensitive → keep", () => {
  assertEquals(
    detectMisroutedPartnerRelay("remind ALMU to call doctor", "Almu", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: 'my partner' generic ref → keep", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Tell my partner dinner is ready", "Almu", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: Spanish generic ref 'mi pareja' → keep", () => {
  assertEquals(
    detectMisroutedPartnerRelay("dile a mi pareja que venga", "Almu", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: not a relay shape → null (don't touch)", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Buy groceries tomorrow", "Almu", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: relay but partner unknown → still flags", () => {
  // When partner identity isn't resolved, flagging a third-party name as
  // misrouted is the safer default (bias to CREATE / brain-dump).
  assertEquals(
    detectMisroutedPartnerRelay("Text Jacopo about Amazon", null, null),
    "Jacopo",
  );
});

Deno.test("detectMisroutedPartnerRelay: partner full-name vs message uses first name → keep", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Remind Marco to call", "Marco Rossi", null),
    null,
  );
});

Deno.test("detectMisroutedPartnerRelay: target matches user's own name → keep (self-reminder)", () => {
  assertEquals(
    detectMisroutedPartnerRelay("Remind Giuseppe to call dentist", "Almu", "Giuseppe"),
    null,
  );
});

// ─── detectSetDueRefinement ─────────────────────────────────────────

const sampleSetDuePending = {
  type: "set_due_date" as const,
  task_id: "task-uuid-123",
  task_summary: "Book hotel for Mallorca",
  date: "2026-05-14T17:00:00.000Z", // tomorrow 5pm
  readable: "tomorrow at 5:00 PM",
  timezone: "America/New_York",
};

Deno.test("detectSetDueRefinement: 'Set it due for Friday at 5pm' → refines (Bug 3)", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "Set it due for Friday at 5pm",
    "America/New_York",
    "en",
  );
  // Must return a non-null refinement carrying the same task with a new date.
  if (!refined) throw new Error("Expected refinement, got null");
  assertEquals(refined.updated.task_id, "task-uuid-123");
  assertEquals(refined.updated.task_summary, "Book hotel for Mallorca");
  // Date should have changed from the original.
  if (refined.parsedDateIso === sampleSetDuePending.date) {
    throw new Error("Expected new parsed date, got original");
  }
});

Deno.test("detectSetDueRefinement: short 'Friday at 5pm' → refines (date-shaped short msg)", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "Friday at 5pm",
    "America/New_York",
    "en",
  );
  if (!refined) throw new Error("Expected refinement for short date-shaped msg");
});

Deno.test("detectSetDueRefinement: 'no, make it tomorrow' → refines", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "no, make it tomorrow",
    "America/New_York",
    "en",
  );
  if (!refined) throw new Error("Expected refinement for correction-style msg");
});

Deno.test("detectSetDueRefinement: unrelated chatter → null (don't re-target)", () => {
  // "How are you?" parses to nothing — don't try to re-target.
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "How are you?",
    "America/New_York",
    "en",
  );
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: a different task entirely → null (no date phrase)", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "Buy groceries when you can",
    "America/New_York",
    "en",
  );
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: pending is not set_due_date → null", () => {
  const refined = detectSetDueRefinement(
    { type: "assign", task_id: "x", task_summary: "x", target_user_id: "u", target_name: "Almu" },
    "Friday at 5pm",
    "America/New_York",
    "en",
  );
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: null pending → null", () => {
  const refined = detectSetDueRefinement(
    null,
    "Friday at 5pm",
    "America/New_York",
    "en",
  );
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: empty message → null", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "",
    "America/New_York",
    "en",
  );
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: long unrelated narrative with a stray date → null", () => {
  // A long message that happens to mention a day but isn't refining anything
  // — guarded by both gates (no refinement signal + length > 30).
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "I was thinking maybe Monday could work for that thing we discussed but I'm not sure yet",
    "America/New_York",
    "en",
  );
  // Even if a date parses, without a refinement signal AND being long,
  // the helper declines. This avoids re-targeting on stray dates buried
  // in conversational text.
  assertEquals(refined, null);
});

Deno.test("detectSetDueRefinement: Italian refinement 'sposta a venerdì alle 17' → refines", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "sposta a venerdì alle 17",
    "Europe/Rome",
    "it",
  );
  if (!refined) throw new Error("Expected refinement for Italian refinement msg");
});

Deno.test("detectSetDueRefinement: preserves task identity (focal entity unchanged)", () => {
  const refined = detectSetDueRefinement(
    sampleSetDuePending,
    "Friday at 5pm",
    "America/New_York",
    "en",
  );
  if (!refined) throw new Error("Expected refinement");
  // Critical: the task being refined is the SAME task, just a new date.
  assertEquals(refined.updated.task_id, sampleSetDuePending.task_id);
  assertEquals(refined.updated.task_summary, sampleSetDuePending.task_summary);
});
