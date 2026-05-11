// Tests for _shared/offer-copy.ts
// Pin the user-facing strings so a refactor doesn't silently change Olive's
// voice. These strings are what the LLM is instructed to surface verbatim,
// so any drift here propagates directly to the user.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildBulkRescheduleOffer,
  buildCalendarSuffix,
  buildConflictClause,
  buildDeleteOffer,
  buildDisambiguationOffer,
  buildEditOffer,
  buildPatternHintClause,
  buildRescheduleOffer,
  buildResultHint,
  buildUndoConfirmation,
} from "./offer-copy.ts";
import type { BulkRescheduleCandidate, BulkRescheduleOffer } from "./pending-offer.ts";
import type { ConflictSummary } from "./conflict-detector.ts";
import type { MatchedPattern } from "./pattern-detector.ts";
import type {
  DeleteTaskOffer,
  DisambiguationOffer,
  EditTaskOffer,
  RescheduleTaskOffer,
} from "./pending-offer.ts";
import type { ExecutedAction } from "./action-executor-offers.ts";

const tz = "America/New_York";

// ─── Offer prompts ─────────────────────────────────────────────────────

Deno.test("buildRescheduleOffer: shows diff when prior was set", () => {
  const offer: RescheduleTaskOffer = {
    type: "reschedule_task",
    task_id: "t1",
    task_summary: "Visit apartment",
    field: "reminder_time",
    new_iso: "2026-05-14T22:00:00.000Z", // Thu 6pm ET
    has_time: true,
    prior_due_date: "2026-05-12",
    prior_reminder_time: null,
    readable: "Thursday at 6:00 PM",
    timezone: tz,
    offered_at: new Date().toISOString(),
  };
  const out = buildRescheduleOffer(offer, { timezone: tz, lang: "en" });
  // Should mention both the task and call out a change
  assert(out.includes("Visit apartment"));
  assert(out.includes("→"));
  assert(out.includes("Confirm?"));
  assert(out.startsWith("🌿"));
});

Deno.test("buildRescheduleOffer: no prior → 'Set ... for' phrasing", () => {
  const offer: RescheduleTaskOffer = {
    type: "reschedule_task",
    task_id: "t1",
    task_summary: "Pick up groceries",
    field: "due_date",
    new_iso: "2026-05-14T13:00:00.000Z",
    has_time: false,
    prior_due_date: null,
    prior_reminder_time: null,
    readable: "Thursday",
    timezone: tz,
    offered_at: new Date().toISOString(),
  };
  const out = buildRescheduleOffer(offer, { timezone: tz, lang: "en" });
  assert(out.startsWith("🌿 Set"));
  assert(out.includes("Pick up groceries"));
  assert(out.includes("Confirm?"));
});

Deno.test("buildDeleteOffer: warns about linked calendar event", () => {
  const offer: DeleteTaskOffer = {
    type: "delete_task",
    task_id: "t1",
    task_summary: "Visit dentist",
    prior_due_date: null,
    prior_reminder_time: null,
    offered_at: new Date().toISOString(),
  };
  const out = buildDeleteOffer(offer);
  assert(out.includes("Delete"));
  assert(out.includes("Visit dentist"));
  assert(out.toLowerCase().includes("calendar"));
});

Deno.test("buildEditOffer: rename phrasing", () => {
  const offer: EditTaskOffer = {
    type: "edit_task",
    task_id: "t1",
    task_summary: "Old name",
    changes: { new_title: "New name" },
    prior: { summary: "Old name", description: null },
    offered_at: new Date().toISOString(),
  };
  const out = buildEditOffer(offer);
  assert(out.startsWith("🌿 Rename"));
  assert(out.includes("Old name"));
  assert(out.includes("New name"));
});

Deno.test("buildEditOffer: duration phrasing", () => {
  const offer: EditTaskOffer = {
    type: "edit_task",
    task_id: "t1",
    task_summary: "Standup",
    changes: { new_duration_minutes: 15 },
    prior: { summary: "Standup", description: null },
    offered_at: new Date().toISOString(),
  };
  const out = buildEditOffer(offer);
  assert(out.includes("15-minute"));
  assert(out.includes("Standup"));
});

Deno.test("buildDisambiguationOffer: numbered list with names", () => {
  const offer: DisambiguationOffer = {
    type: "disambiguate",
    pending_intent: { kind: "delete_task" },
    candidates: [
      { task_id: "a", summary: "Visit SoHo", due_date: null, reminder_time: null },
      { task_id: "b", summary: "Visit Brooklyn", due_date: "2026-05-14", reminder_time: null },
    ],
    original_message: "delete visit apartment",
    offered_at: new Date().toISOString(),
  };
  const out = buildDisambiguationOffer(offer);
  assert(out.includes("1. Visit SoHo"));
  assert(out.includes("2. Visit Brooklyn"));
  assert(out.includes("which one"));
});

// ─── Result hints ──────────────────────────────────────────────────────

Deno.test("buildResultHint: rescheduled with calendar success → includes 'synced'", () => {
  const r: ExecutedAction = {
    action: "task_rescheduled",
    task_id: "t1",
    task_summary: "Visit apartment",
    new_due_date: "2026-05-14",
    new_reminder_time: "2026-05-14T22:00:00.000Z",
    readable: "Thursday at 6 PM",
    prior_due_date: "2026-05-12",
    prior_reminder_time: null,
    calendar_sync: { status: "updated" },
    last_action: {} as never,
  };
  const out = buildResultHint(r, { timezone: tz, lang: "en" });
  assert(out.includes("synced"));
  assert(out.includes("undo"));
});

Deno.test("buildResultHint: rescheduled with calendar failure → honest copy", () => {
  const r: ExecutedAction = {
    action: "task_rescheduled",
    task_id: "t1",
    task_summary: "Visit apartment",
    new_due_date: "2026-05-14",
    new_reminder_time: "2026-05-14T22:00:00.000Z",
    readable: "Thursday at 6 PM",
    prior_due_date: "2026-05-12",
    prior_reminder_time: null,
    calendar_sync: { status: "google_api_error", message: "500" },
    last_action: {} as never,
  };
  const out = buildResultHint(r, { timezone: tz, lang: "en" });
  assert(out.toLowerCase().includes("couldn't reach google calendar"));
});

Deno.test("buildResultHint: deleted → 'bring it back' phrasing for undo", () => {
  const r: ExecutedAction = {
    action: "task_deleted",
    task_id: "t1",
    task_summary: "Visit apartment",
    calendar_sync: { status: "deleted" },
    last_action: {} as never,
  };
  const out = buildResultHint(r, { timezone: tz, lang: "en" });
  assert(out.includes("bring it back"));
});

// ─── Calendar suffix ──────────────────────────────────────────────────

Deno.test("buildCalendarSuffix: updated → mentions sync", () => {
  const out = buildCalendarSuffix({ status: "updated" });
  assert(out.includes("synced"));
});

Deno.test("buildCalendarSuffix: not_connected → empty (don't volunteer)", () => {
  assertEquals(buildCalendarSuffix({ status: "not_connected" }), "");
});

Deno.test("buildCalendarSuffix: no_linked_event → empty", () => {
  assertEquals(buildCalendarSuffix({ status: "no_linked_event" }), "");
});

Deno.test("buildCalendarSuffix: google_api_error → honest failure", () => {
  const out = buildCalendarSuffix({ status: "google_api_error" });
  assert(out.toLowerCase().includes("couldn't reach"));
});

// Phase 2.1 — softened failure copy when retry was queued.

Deno.test("buildCalendarSuffix: failure + retryEnqueued → 'I'll keep trying' copy", () => {
  const out = buildCalendarSuffix({ status: "google_api_error" }, { retryEnqueued: true });
  assert(out.toLowerCase().includes("keep trying") || out.toLowerCase().includes("background"));
  // Should NOT use the abandoned-feeling 'couldn't reach' phrasing.
  assert(!out.toLowerCase().includes("couldn't reach"));
});

Deno.test("buildCalendarSuffix: failure WITHOUT retry → permanent-feeling copy", () => {
  const out = buildCalendarSuffix({ status: "google_api_error" }, { retryEnqueued: false });
  assert(out.toLowerCase().includes("couldn't reach"));
});

// Phase 2.3 — attendee notification surfaced.

Deno.test("buildCalendarSuffix: updated + 1 attendee → 'notified 1 other person'", () => {
  const out = buildCalendarSuffix(
    { status: "updated" },
    { attendeesNotified: true, attendeeCount: 1 },
  );
  assert(out.includes("synced"));
  assert(out.includes("1 other person"));
});

Deno.test("buildCalendarSuffix: updated + 3 attendees → '3 other people'", () => {
  const out = buildCalendarSuffix(
    { status: "updated" },
    { attendeesNotified: true, attendeeCount: 3 },
  );
  assert(out.includes("3 other people"));
});

Deno.test("buildCalendarSuffix: deleted + attendees → 'cancelled for X people'", () => {
  const out = buildCalendarSuffix(
    { status: "deleted" },
    { attendeesNotified: true, attendeeCount: 4 },
  );
  assert(out.toLowerCase().includes("cancelled"));
  assert(out.includes("4"));
});

Deno.test("buildCalendarSuffix: attendeesNotified=false → no people clause", () => {
  const out = buildCalendarSuffix(
    { status: "updated" },
    { attendeesNotified: false, attendeeCount: 5 },
  );
  // We have a count but didn't notify (e.g. user changed only description) → no clause
  assert(!out.toLowerCase().includes("notified"));
  assert(!out.toLowerCase().includes("other people"));
});

// ─── Undo confirmation ─────────────────────────────────────────────────

Deno.test("buildUndoConfirmation: success on reschedule", () => {
  const out = buildUndoConfirmation(
    { kind: "reschedule_task", reverted: true },
    "Visit apartment",
  );
  assert(out.includes("Reverted"));
  assert(out.includes("Visit apartment"));
});

Deno.test("buildUndoConfirmation: success on delete uses 'brought back' voice", () => {
  const out = buildUndoConfirmation(
    { kind: "delete_task", reverted: true },
    "Visit apartment",
  );
  assert(out.toLowerCase().includes("back"));
});

Deno.test("buildUndoConfirmation: failure includes detail when available", () => {
  const out = buildUndoConfirmation(
    { kind: "reschedule_task", reverted: false, detail: "row not found" },
    "Visit apartment",
  );
  assert(out.toLowerCase().includes("couldn't"));
  assert(out.includes("row not found"));
});

// ─── Phase 3.1 — buildConflictClause ──────────────────────────────────

const ctxEn = { timezone: "America/New_York", lang: "en" as const };
const ctxEs = { timezone: "Europe/Madrid", lang: "es" as const };
const ctxIt = { timezone: "Europe/Rome", lang: "it" as const };

function timedConflict(title: string, startIso: string): ConflictSummary {
  return {
    id: "id",
    title,
    start_time: startIso,
    end_time: startIso,
    all_day: false,
    note_id: null,
    overlap_minutes: 30,
    severity: "overlap",
  };
}

function allDayConflict(title: string, startIso: string): ConflictSummary {
  return {
    id: "id",
    title,
    start_time: startIso,
    end_time: startIso,
    all_day: true,
    note_id: null,
    overlap_minutes: 60,
    severity: "overlap",
  };
}

Deno.test("buildConflictClause: empty/undefined → empty string", () => {
  assertEquals(buildConflictClause(undefined, ctxEn), "");
  assertEquals(buildConflictClause([], ctxEn), "");
});

Deno.test("buildConflictClause: 1 timed conflict (en) → 'Heads up' + title + time", () => {
  const out = buildConflictClause(
    [timedConflict("Dinner with Sara", "2026-05-14T22:30:00Z")],
    ctxEn,
  );
  assert(out.toLowerCase().includes("heads up"));
  assert(out.includes("Dinner with Sara"));
  // Should include some time form
  assert(/\d{1,2}:\d{2}|\d{1,2}\s*(am|pm)/i.test(out), `expected time in: ${out}`);
});

Deno.test("buildConflictClause: 1 all-day conflict (en) → 'on that day' phrasing", () => {
  const out = buildConflictClause(
    [allDayConflict("Off-site planning", "2026-05-14T00:00:00Z")],
    ctxEn,
  );
  assert(out.includes("Off-site planning"));
  assert(out.toLowerCase().includes("that day"));
});

Deno.test("buildConflictClause: 2 conflicts (en) → 'X things on your calendar then'", () => {
  const out = buildConflictClause(
    [
      timedConflict("Dinner", "2026-05-14T22:30:00Z"),
      timedConflict("Gym", "2026-05-14T23:45:00Z"),
    ],
    ctxEn,
  );
  assert(out.includes("2 things"));
  assert(out.includes("Dinner"));
  assert(out.includes("Gym"));
  assert(out.includes(" and "));
});

Deno.test("buildConflictClause: 4 conflicts (en) → summarized count, not enumerated", () => {
  const conflicts = ["A", "B", "C", "D"].map((t) => timedConflict(t, "2026-05-14T22:00:00Z"));
  const out = buildConflictClause(conflicts, ctxEn);
  assert(out.includes("4 events"));
  // Should NOT enumerate individual titles — would be too long
  assert(!out.includes("A,") && !out.includes("D"), `unexpected enumeration: ${out}`);
});

Deno.test("buildConflictClause: 1 conflict (es) → 'Aviso' lead", () => {
  const out = buildConflictClause(
    [timedConflict("Cena con Sara", "2026-05-14T22:30:00Z")],
    ctxEs,
  );
  assert(out.includes("Aviso"));
  assert(out.includes("Cena con Sara"));
});

Deno.test("buildConflictClause: 1 conflict (it) → 'Attenzione' lead", () => {
  const out = buildConflictClause(
    [timedConflict("Cena con Sara", "2026-05-14T22:30:00Z")],
    ctxIt,
  );
  assert(out.includes("Attenzione"));
});

Deno.test("buildConflictClause: 3 conflicts (es) → uses 'y' connector", () => {
  const out = buildConflictClause(
    [
      timedConflict("A", "2026-05-14T22:00:00Z"),
      timedConflict("B", "2026-05-14T22:30:00Z"),
      timedConflict("C", "2026-05-14T23:00:00Z"),
    ],
    ctxEs,
  );
  assert(out.includes(" y "));
});

Deno.test("buildConflictClause: 3 conflicts (it) → uses 'e' connector", () => {
  const out = buildConflictClause(
    [
      timedConflict("A", "2026-05-14T22:00:00Z"),
      timedConflict("B", "2026-05-14T22:30:00Z"),
      timedConflict("C", "2026-05-14T23:00:00Z"),
    ],
    ctxIt,
  );
  assert(out.includes(" e "));
});

// ─── Phase 3.1 — buildRescheduleOffer integration ─────────────────────

Deno.test("buildRescheduleOffer: clean schedule → no conflict clause", () => {
  const out = buildRescheduleOffer(
    {
      type: "reschedule_task",
      task_id: "t1",
      task_summary: "Visit apartment",
      field: "reminder_time",
      new_iso: "2026-05-14T22:00:00Z",
      has_time: true,
      prior_due_date: null,
      prior_reminder_time: null,
      readable: "Thursday at 6:00 PM",
      timezone: "America/New_York",
      conflicts: [],
      offered_at: new Date().toISOString(),
    },
    ctxEn,
  );
  assert(!out.toLowerCase().includes("heads up"));
  assert(out.includes("Confirm?"));
});

Deno.test("buildRescheduleOffer: conflict present → includes 'Heads up' clause", () => {
  const out = buildRescheduleOffer(
    {
      type: "reschedule_task",
      task_id: "t1",
      task_summary: "Visit apartment",
      field: "reminder_time",
      new_iso: "2026-05-14T22:00:00Z",
      has_time: true,
      prior_due_date: null,
      prior_reminder_time: null,
      readable: "Thursday at 6:00 PM",
      timezone: "America/New_York",
      conflicts: [timedConflict("Dinner with Sara", "2026-05-14T22:30:00Z")],
      offered_at: new Date().toISOString(),
    },
    ctxEn,
  );
  assert(out.toLowerCase().includes("heads up"));
  assert(out.includes("Dinner with Sara"));
  assert(out.includes("Confirm?"));
});

// ─── Phase 3.5 — buildPatternHintClause ──────────────────────────────

function shift(from: number, to: number, count = 5, total = 8): MatchedPattern {
  return {
    pattern_type: "weekday_shift",
    pattern_data: { from_dow: from, to_dow: to },
    count,
    confidence: count / total,
    last_seen_at: new Date().toISOString(),
  };
}

Deno.test("buildPatternHintClause: empty / undefined → empty", () => {
  assertEquals(buildPatternHintClause(undefined, ctxEn), "");
  assertEquals(buildPatternHintClause([], ctxEn), "");
});

Deno.test("buildPatternHintClause: Tue→Thu hint (en)", () => {
  const out = buildPatternHintClause([shift(2, 4)], ctxEn);
  assert(out.toLowerCase().includes("tuesday"));
  assert(out.toLowerCase().includes("thursday"));
  // Soft "by the way" leadin, not urgent "heads up"
  assert(out.toLowerCase().includes("by the way"));
});

Deno.test("buildPatternHintClause: Tue→Thu hint (es) uses lowercase day names + 'martes'/'jueves'", () => {
  const out = buildPatternHintClause([shift(2, 4)], ctxEs);
  assert(out.toLowerCase().includes("martes"));
  assert(out.includes("jueves"));
  assert(out.toLowerCase().includes("sueles mover"));
});

Deno.test("buildPatternHintClause: Tue→Thu hint (it) uses lowercase day names", () => {
  const out = buildPatternHintClause([shift(2, 4)], ctxIt);
  assert(out.includes("martedì"));
  assert(out.includes("giovedì"));
  assert(out.toLowerCase().includes("sposti"));
});

Deno.test("buildPatternHintClause: malformed pattern_data → empty", () => {
  const malformed: MatchedPattern = {
    pattern_type: "weekday_shift",
    pattern_data: { /* missing from_dow / to_dow */ },
    count: 5,
    confidence: 0.8,
    last_seen_at: new Date().toISOString(),
  };
  assertEquals(buildPatternHintClause([malformed], ctxEn), "");
});

Deno.test("buildPatternHintClause: out-of-range day-of-week → empty (fail safe)", () => {
  assertEquals(buildPatternHintClause([shift(2, 9)], ctxEn), "");
});

Deno.test("buildRescheduleOffer: pattern hint surfaces in reschedule offer", () => {
  const out = buildRescheduleOffer(
    {
      type: "reschedule_task",
      task_id: "t1",
      task_summary: "Visit apartment",
      field: "reminder_time",
      new_iso: "2026-05-14T22:00:00Z",
      has_time: true,
      prior_due_date: null,
      prior_reminder_time: null,
      readable: "Thursday at 6:00 PM",
      timezone: "America/New_York",
      conflicts: [],
      pattern_hints: [shift(2, 4)],
      offered_at: new Date().toISOString(),
    },
    ctxEn,
  );
  assert(out.toLowerCase().includes("tuesday"));
  assert(out.toLowerCase().includes("thursday"));
  // Conflict still absent
  assert(!out.toLowerCase().includes("heads up"));
});

// ─── Phase 3.2 — buildBulkRescheduleOffer ────────────────────────────

function bulkCand(id: string, summary: string): BulkRescheduleCandidate {
  return {
    task_id: id,
    task_summary: summary,
    prior_due_date: null,
    prior_reminder_time: "2026-05-12T22:00:00Z",
    new_iso: "2026-05-14T22:00:00Z",
    field: "reminder_time",
    has_time: true,
  };
}

function bulkOffer(cands: BulkRescheduleCandidate[], fromDow = 2, toDow = 4): BulkRescheduleOffer {
  return {
    type: "bulk_reschedule_weekday",
    from_dow: fromDow,
    to_dow: toDow,
    timezone: "America/New_York",
    candidates: cands,
    original_message: "move all my Tuesday tasks to Thursday",
    offered_at: new Date().toISOString(),
  };
}

Deno.test("buildBulkRescheduleOffer: 1 task (en) → singular phrasing", () => {
  const out = buildBulkRescheduleOffer(bulkOffer([bulkCand("a", "Visit apartment")]), ctxEn);
  assert(out.includes("1 task"));
  assert(out.toLowerCase().includes("tuesday"));
  assert(out.toLowerCase().includes("thursday"));
  assert(out.includes("Visit apartment"));
  assert(out.includes("Confirm?"));
});

Deno.test("buildBulkRescheduleOffer: 3 tasks (en) → plural + bullet list", () => {
  const out = buildBulkRescheduleOffer(
    bulkOffer([
      bulkCand("a", "Visit apartment"),
      bulkCand("b", "Call dentist"),
      bulkCand("c", "Pick up dry cleaning"),
    ]),
    ctxEn,
  );
  assert(out.includes("3 tasks"));
  assert(out.includes("• Visit apartment"));
  assert(out.includes("• Call dentist"));
  assert(out.includes("• Pick up dry cleaning"));
  // No "and N more" tail for ≤5 tasks
  assert(!out.toLowerCase().includes("more"));
});

Deno.test("buildBulkRescheduleOffer: 8 tasks → shows 5, summarizes the rest", () => {
  const cands: BulkRescheduleCandidate[] = [];
  for (let i = 0; i < 8; i++) cands.push(bulkCand(`t${i}`, `Task ${i}`));
  const out = buildBulkRescheduleOffer(bulkOffer(cands), ctxEn);
  assert(out.includes("8 tasks"));
  assert(out.includes("Task 0"));
  assert(out.includes("Task 4"));
  // Task 5 and beyond should NOT be listed individually
  assert(!out.includes("• Task 5"));
  assert(out.toLowerCase().includes("3 more"));
});

Deno.test("buildBulkRescheduleOffer: es localization", () => {
  const out = buildBulkRescheduleOffer(bulkOffer([bulkCand("a", "Visita apartamento")]), ctxEs);
  assert(out.includes("martes"));
  assert(out.includes("jueves"));
  // "Mover N tarea de martes a jueves"
  assert(out.toLowerCase().includes("mover"));
  assert(out.includes("¿Confirmar?"));
});

Deno.test("buildBulkRescheduleOffer: it localization", () => {
  const out = buildBulkRescheduleOffer(bulkOffer([bulkCand("a", "Visita appartamento")]), ctxIt);
  assert(out.includes("martedì"));
  assert(out.includes("giovedì"));
  assert(out.includes("Confermare?"));
});

// ─── Phase 3.2 — buildResultHint for bulk ─────────────────────────────

Deno.test("buildResultHint: bulk all-success + all-synced → 'and synced'", () => {
  const out = buildResultHint(
    {
      action: "tasks_bulk_rescheduled",
      from_dow: 2,
      to_dow: 4,
      attempted: 3,
      succeeded: 3,
      failed: 0,
      calendar_aggregate: "all_synced",
      outcomes: [],
      last_action: {} as never,
    },
    ctxEn,
  );
  assert(out.includes("Moved 3 tasks"));
  assert(out.toLowerCase().includes("thursday"));
  assert(out.toLowerCase().includes("synced"));
  assert(out.includes("undo"));
});

Deno.test("buildResultHint: bulk partial-failure mentions 'X of N'", () => {
  const out = buildResultHint(
    {
      action: "tasks_bulk_rescheduled",
      from_dow: 2,
      to_dow: 4,
      attempted: 5,
      succeeded: 3,
      failed: 2,
      calendar_aggregate: "partial",
      outcomes: [],
      last_action: {} as never,
    },
    ctxEn,
  );
  assert(out.includes("3 of 5"));
  assert(out.toLowerCase().includes("couldn't"));
  // Partial calendar suffix should mention background retry
  assert(out.toLowerCase().includes("keep trying") || out.toLowerCase().includes("background"));
});

Deno.test("buildResultHint: bulk none-synced + connected → honest copy", () => {
  const out = buildResultHint(
    {
      action: "tasks_bulk_rescheduled",
      from_dow: 2,
      to_dow: 4,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      calendar_aggregate: "none_synced",
      outcomes: [],
      last_action: {} as never,
    },
    ctxEn,
  );
  assert(out.toLowerCase().includes("couldn't reach"));
});

Deno.test("buildResultHint: bulk not_connected → no calendar suffix", () => {
  const out = buildResultHint(
    {
      action: "tasks_bulk_rescheduled",
      from_dow: 2,
      to_dow: 4,
      attempted: 2,
      succeeded: 2,
      failed: 0,
      calendar_aggregate: "not_connected",
      outcomes: [],
      last_action: {} as never,
    },
    ctxEn,
  );
  // No "synced" / "couldn't reach" — user has no calendar to mention
  assert(!out.toLowerCase().includes("synced"));
  assert(!out.toLowerCase().includes("couldn't reach"));
});

// ─── Phase 3.2 — buildUndoConfirmation for bulk ───────────────────────

Deno.test("buildUndoConfirmation: bulk uses count summary", () => {
  const out = buildUndoConfirmation({ kind: "bulk_reschedule_task", reverted: true }, "5");
  assert(out.toLowerCase().includes("reverted"));
  assert(out.includes("5 tasks"));
});

Deno.test("buildUndoConfirmation: bulk count=1 uses singular", () => {
  const out = buildUndoConfirmation({ kind: "bulk_reschedule_task", reverted: true }, "1");
  assert(out.includes("1 task)"));
});

Deno.test("buildRescheduleOffer: conflict + pattern both surface, conflict first", () => {
  const out = buildRescheduleOffer(
    {
      type: "reschedule_task",
      task_id: "t1",
      task_summary: "Visit apartment",
      field: "reminder_time",
      new_iso: "2026-05-14T22:00:00Z",
      has_time: true,
      prior_due_date: null,
      prior_reminder_time: null,
      readable: "Thursday at 6:00 PM",
      timezone: "America/New_York",
      conflicts: [timedConflict("Dinner with Sara", "2026-05-14T22:30:00Z")],
      pattern_hints: [shift(2, 4)],
      offered_at: new Date().toISOString(),
    },
    ctxEn,
  );
  // Both must appear in the same string
  const headsUpIdx = out.toLowerCase().indexOf("heads up");
  const bywayIdx = out.toLowerCase().indexOf("by the way");
  assert(headsUpIdx >= 0);
  assert(bywayIdx >= 0);
  // Conflict (urgent) reads before pattern (soft)
  assert(headsUpIdx < bywayIdx, "conflict clause should come before pattern hint");
});
