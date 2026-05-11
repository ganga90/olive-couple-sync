// Tests for _shared/calendar-reconciler.ts
//
// We test the per-event branch logic (cancelled / edited / new) against
// a mock Supabase that records insert/update/delete calls. The
// orchestration around pagination + sync_token rotation is exercised
// implicitly by the top-level reconcileFromGoogle flow when callers
// integration-test it; here we pin the per-event semantics so the
// bidirectional contract can't silently regress.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { __FOR_TESTS } from "./calendar-reconciler.ts";
import type { CalendarConnection, IncrementalEventsPage } from "./google-calendar.ts";

const { applyChanges } = __FOR_TESTS;

// ─── Mock supabase ────────────────────────────────────────────────────

interface DBState {
  events: Array<{ id: string; google_event_id: string; note_id: string | null; all_day: boolean | null }>;
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  updates: Array<{ table: string; id: string; patch: Record<string, unknown> }>;
  deletes: Array<{ table: string; id: string }>;
  // For the chained SELECT...IN query used to batch-fetch existing
  // calendar_events rows by google_event_id.
  selectFilter?: { col: string; values: string[] };
}

function makeMockSupabase(state: DBState) {
  const eventsTable = "calendar_events";
  const notesTable = "clerk_notes";
  return {
    from(table: string) {
      return {
        // Used by applyChanges in the batched lookup at the top.
        select(_cols: string) {
          return {
            eq(_col: string, _val: unknown) {
              return {
                in(col: string, values: string[]) {
                  state.selectFilter = { col, values };
                  // Return events whose google_event_id is in `values`
                  const matched = state.events.filter((e) => values.includes(e.google_event_id));
                  return Promise.resolve({ data: matched, error: null });
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, id: string) {
              state.updates.push({ table, id, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
        delete() {
          return {
            eq(_col: string, id: string) {
              state.deletes.push({ table, id });
              return Promise.resolve({ error: null });
            },
          };
        },
        insert(row: Record<string, unknown>) {
          state.inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as never;
}

function freshState(events: DBState["events"] = []): DBState {
  return { events, inserts: [], updates: [], deletes: [] };
}

const conn: CalendarConnection = {
  id: "conn-1",
  user_id: "u1",
  access_token: "a",
  refresh_token: "r",
  token_expiry: new Date(Date.now() + 3600_000).toISOString(),
  primary_calendar_id: "primary",
};

// Helper to build the smallest valid page shape.
function page(events: IncrementalEventsPage["events"]): IncrementalEventsPage {
  return { events, nextSyncToken: "after", nextPageToken: null, needsFullResync: false };
}

// ─── Cancelled events ────────────────────────────────────────────────

Deno.test("applyChanges: cancelled event with mirror row → DELETE the mirror", async () => {
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: null, all_day: false },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([{ id: "g-1", status: "cancelled" }]),
    counts,
  );
  assertEquals(counts.events_deleted, 1);
  assertEquals(state.deletes.length, 1);
  assertEquals(state.deletes[0].table, "calendar_events");
  assertEquals(state.deletes[0].id, "local-1");
});

Deno.test("applyChanges: cancelled event with linked note → also clears clerk_notes due/reminder", async () => {
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: "note-7", all_day: false },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([{ id: "g-1", status: "cancelled" }]),
    counts,
  );
  assertEquals(counts.events_deleted, 1);
  assertEquals(counts.clerk_notes_updated, 1);
  const noteUpdate = state.updates.find((u) => u.table === "clerk_notes");
  assert(noteUpdate);
  assertEquals(noteUpdate!.patch.due_date, null);
  assertEquals(noteUpdate!.patch.reminder_time, null);
  assertEquals(noteUpdate!.id, "note-7");
});

Deno.test("applyChanges: cancelled event we never knew about → no-op (no delete, no error)", async () => {
  const state = freshState([]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([{ id: "g-unknown", status: "cancelled" }]),
    counts,
  );
  assertEquals(counts.events_deleted, 0);
  assertEquals(state.deletes.length, 0);
});

// ─── Edited events ───────────────────────────────────────────────────

Deno.test("applyChanges: edited timed event → UPDATE mirror with new start/end/title", async () => {
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: null, all_day: false },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([
      {
        id: "g-1",
        status: "confirmed",
        summary: "Dinner rescheduled",
        start: { dateTime: "2026-05-14T22:30:00Z" },
        end: { dateTime: "2026-05-14T23:30:00Z" },
        etag: "v2",
      },
    ]),
    counts,
  );
  assertEquals(counts.events_updated, 1);
  const upd = state.updates.find((u) => u.table === "calendar_events");
  assert(upd);
  assertEquals(upd!.id, "local-1");
  assertEquals(upd!.patch.title, "Dinner rescheduled");
  assertEquals(upd!.patch.start_time, "2026-05-14T22:30:00Z");
  assertEquals(upd!.patch.all_day, false);
});

Deno.test("applyChanges: edited event linked to a note → also updates clerk_notes time", async () => {
  // Bidirectional sync's payoff: user moves the event on Google's
  // UI, Olive's task view follows.
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: "note-7", all_day: false },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([
      {
        id: "g-1",
        status: "confirmed",
        summary: "Moved",
        start: { dateTime: "2026-05-14T22:30:00Z" },
        end: { dateTime: "2026-05-14T23:30:00Z" },
      },
    ]),
    counts,
  );
  assertEquals(counts.clerk_notes_updated, 1);
  const noteUpdate = state.updates.find((u) => u.table === "clerk_notes");
  assert(noteUpdate);
  assertEquals(noteUpdate!.patch.reminder_time, "2026-05-14T22:30:00Z");
  assertEquals(noteUpdate!.patch.due_date, "2026-05-14");
});

Deno.test("applyChanges: edited all-day event linked to note → due_date set, reminder_time cleared", async () => {
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: "note-7", all_day: true },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([
      {
        id: "g-1",
        status: "confirmed",
        summary: "All-day",
        start: { date: "2026-05-14" }, // date-only = all-day
        end: { date: "2026-05-15" },
      },
    ]),
    counts,
  );
  const noteUpdate = state.updates.find((u) => u.table === "clerk_notes");
  assert(noteUpdate);
  assertEquals(noteUpdate!.patch.reminder_time, null);
  assertEquals(noteUpdate!.patch.due_date, "2026-05-14");
});

// ─── New events ──────────────────────────────────────────────────────

Deno.test("applyChanges: new event (no local mirror) → INSERT as 'from_calendar'", async () => {
  const state = freshState([]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([
      {
        id: "g-new",
        status: "confirmed",
        summary: "External event",
        start: { dateTime: "2026-05-14T18:00:00Z" },
        end: { dateTime: "2026-05-14T19:00:00Z" },
      },
    ]),
    counts,
  );
  assertEquals(counts.events_inserted, 1);
  const ins = state.inserts.find((i) => i.table === "calendar_events");
  assert(ins);
  assertEquals(ins!.row.google_event_id, "g-new");
  assertEquals(ins!.row.event_type, "from_calendar");
  assertEquals(ins!.row.all_day, false);
});

Deno.test("applyChanges: malformed event (no start) → skipped silently, not inserted", async () => {
  const state = freshState([]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([{ id: "g-bad", status: "confirmed" /* no start */ }]),
    counts,
  );
  assertEquals(counts.events_inserted, 0);
  assertEquals(state.inserts.length, 0);
});

// ─── Batched lookup behavior ──────────────────────────────────────────

Deno.test("applyChanges: pulls existing rows in ONE query keyed by google_event_id (not per-event)", async () => {
  const state = freshState([
    { id: "local-1", google_event_id: "g-1", note_id: null, all_day: false },
    { id: "local-2", google_event_id: "g-2", note_id: null, all_day: false },
  ]);
  const counts = { events_updated: 0, events_inserted: 0, events_deleted: 0, clerk_notes_updated: 0 };
  await applyChanges(
    makeMockSupabase(state),
    conn,
    page([
      { id: "g-1", status: "confirmed", summary: "A", start: { dateTime: "2026-05-14T18:00:00Z" } },
      { id: "g-2", status: "confirmed", summary: "B", start: { dateTime: "2026-05-14T19:00:00Z" } },
      { id: "g-3", status: "confirmed", summary: "C (new)", start: { dateTime: "2026-05-14T20:00:00Z" } },
    ]),
    counts,
  );
  // One batched SELECT...IN at the top of applyChanges
  assertEquals(state.selectFilter?.col, "google_event_id");
  assertEquals(state.selectFilter?.values.sort(), ["g-1", "g-2", "g-3"]);
  // Two updates (g-1, g-2 exist) and one insert (g-3 new)
  assertEquals(counts.events_updated, 2);
  assertEquals(counts.events_inserted, 1);
});
