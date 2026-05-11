// Tests for _shared/web-session.ts — pure pieces only.
// Storage round-trips (getOrCreateSession / storePendingAction etc.) need
// a live Supabase client and are covered by integration tests, not here.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isLastActionUndoable,
  looksLikeUndoCommand,
  UNDO_TTL_MS,
  type LastAction,
} from "./web-session.ts";

// ─── isLastActionUndoable ─────────────────────────────────────────────

Deno.test("isLastActionUndoable: fresh action (1 min ago) → true", () => {
  const last: LastAction = {
    kind: "reschedule_task",
    task_id: "t1",
    task_summary: "x",
    prior_due_date: null,
    prior_reminder_time: null,
    new_due_date: null,
    new_reminder_time: null,
    calendar_synced: false,
    executed_at: new Date(Date.now() - 60_000).toISOString(),
  };
  assertEquals(isLastActionUndoable(last), true);
});

Deno.test("isLastActionUndoable: stale action (10 min ago) → false", () => {
  const last: LastAction = {
    kind: "reschedule_task",
    task_id: "t1",
    task_summary: "x",
    prior_due_date: null,
    prior_reminder_time: null,
    new_due_date: null,
    new_reminder_time: null,
    calendar_synced: false,
    executed_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
  assertEquals(isLastActionUndoable(last), false);
});

Deno.test("isLastActionUndoable: null / undefined → false", () => {
  assertEquals(isLastActionUndoable(null), false);
  assertEquals(isLastActionUndoable(undefined), false);
});

Deno.test("isLastActionUndoable: malformed executed_at → false", () => {
  const last = {
    kind: "delete_task",
    task_summary: "x",
    restored_row: {},
    google_event_id: null,
    executed_at: "garbage",
  } as LastAction;
  assertEquals(isLastActionUndoable(last), false);
});

Deno.test("isLastActionUndoable: TTL constant matches contract", () => {
  // Pin this so a future refactor doesn't silently lengthen the window
  // without thinking about the UX implications.
  assertEquals(UNDO_TTL_MS, 5 * 60 * 1000);
});

// ─── looksLikeUndoCommand ─────────────────────────────────────────────

Deno.test("looksLikeUndoCommand: en variants", () => {
  for (const s of ["undo", "undo that", "undo it", "Undo", "  undo!  ", "revert", "go back", "wait no"]) {
    assertEquals(looksLikeUndoCommand(s), true, `expected match for "${s}"`);
  }
});

Deno.test("looksLikeUndoCommand: es / it variants", () => {
  for (const s of ["deshacer", "deshazlo", "annulla", "torna indietro", "aspetta no", "espera no"]) {
    assertEquals(looksLikeUndoCommand(s), true, `expected match for "${s}"`);
  }
});

Deno.test("looksLikeUndoCommand: non-undo phrases → false", () => {
  for (const s of ["yes", "no", "change it to Friday", "what's on my list", "undo my entire life"]) {
    assertEquals(looksLikeUndoCommand(s), false, `expected NO match for "${s}"`);
  }
});

Deno.test("looksLikeUndoCommand: empty / null → false", () => {
  assertEquals(looksLikeUndoCommand(""), false);
  assertEquals(looksLikeUndoCommand(null), false);
  assertEquals(looksLikeUndoCommand(undefined), false);
});

Deno.test("looksLikeUndoCommand: very long input → false (avoid scanning paragraphs)", () => {
  assertEquals(looksLikeUndoCommand("undo this whole project and start fresh from yesterday afternoon"), false);
});
