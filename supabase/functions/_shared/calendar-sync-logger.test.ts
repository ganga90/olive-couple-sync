// Tests for _shared/calendar-sync-logger.ts
// We mock the Supabase insert to verify shape + truncation, and to lock
// in the contract that failures don't throw.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  logCalendarSync,
  startSyncTimer,
} from "./calendar-sync-logger.ts";

function makeMockSupabase(captured: { table?: string; row?: Record<string, unknown> }, opts: { fail?: boolean; throw?: boolean } = {}) {
  return {
    from(table: string) {
      captured.table = table;
      return {
        insert(row: Record<string, unknown>) {
          captured.row = row;
          if (opts.throw) throw new Error("DB unreachable");
          return Promise.resolve(opts.fail ? { error: { message: "constraint violated" } } : { error: null });
        },
      };
    },
  } as never;
}

Deno.test("logCalendarSync: writes to olive_calendar_sync_log with expected shape", async () => {
  const captured: { table?: string; row?: Record<string, unknown> } = {};
  await logCalendarSync(makeMockSupabase(captured), {
    user_id: "user_abc",
    action: "update",
    sync_status: "updated",
    note_id: "note_1",
    connection_id: "conn_1",
    google_event_id: "g_1",
    http_status: 200,
    etag_conflict: false,
    latency_ms: 234,
    invoked_from: "ask-olive-stream",
  });
  assertEquals(captured.table, "olive_calendar_sync_log");
  assertEquals(captured.row?.user_id, "user_abc");
  assertEquals(captured.row?.action, "update");
  assertEquals(captured.row?.sync_status, "updated");
  assertEquals(captured.row?.latency_ms, 234);
});

Deno.test("logCalendarSync: truncates very long error messages", async () => {
  const captured: { row?: Record<string, unknown> } = {};
  const huge = "x".repeat(2000);
  await logCalendarSync(makeMockSupabase(captured), {
    user_id: "u",
    action: "update",
    sync_status: "google_api_error",
    error_message: huge,
  });
  const stored = captured.row?.error_message as string;
  assert(stored.length <= 500, `expected truncation, got ${stored.length}`);
});

Deno.test("logCalendarSync: insert failure is swallowed (does not throw)", async () => {
  const captured: { row?: Record<string, unknown> } = {};
  // Should not throw even though insert errored.
  await logCalendarSync(
    makeMockSupabase(captured, { fail: true }),
    { user_id: "u", action: "update", sync_status: "updated" },
  );
  // Confirm we tried — the test passes by virtue of not throwing.
  assertEquals(captured.row?.user_id, "u");
});

Deno.test("logCalendarSync: thrown DB error is swallowed", async () => {
  const captured: { row?: Record<string, unknown> } = {};
  await logCalendarSync(
    makeMockSupabase(captured, { throw: true }),
    { user_id: "u", action: "update", sync_status: "updated" },
  );
});

Deno.test("logCalendarSync: nullable fields default to null in row", async () => {
  const captured: { row?: Record<string, unknown> } = {};
  await logCalendarSync(makeMockSupabase(captured), {
    user_id: "u",
    action: "delete",
    sync_status: "deleted",
  });
  assertEquals(captured.row?.note_id, null);
  assertEquals(captured.row?.connection_id, null);
  assertEquals(captured.row?.google_event_id, null);
  assertEquals(captured.row?.http_status, null);
  assertEquals(captured.row?.etag_conflict, false);
});

Deno.test("startSyncTimer: returns elapsed ms via closure", async () => {
  const stop = startSyncTimer();
  await new Promise((r) => setTimeout(r, 20));
  const elapsed = stop();
  assert(elapsed >= 15 && elapsed < 200, `expected ~20ms, got ${elapsed}`);
});
