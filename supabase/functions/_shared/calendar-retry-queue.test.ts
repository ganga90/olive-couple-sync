// Tests for _shared/calendar-retry-queue.ts
//
// We test the pure decision functions (shouldRetry) and the integration
// behavior of enqueueRetry / markFailedOrAbandon against a mock Supabase
// client. The atomic claim RPC (claimNextBatch) is exercised via a
// stubbed .rpc() call — its real correctness lives in postgres and is
// covered by a separate migration test plan.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __FOR_TESTS,
  enqueueRetry,
  claimNextBatch,
  markFailedOrAbandon,
  markSucceeded,
  shouldRetry,
  type CalendarSyncQueueRow,
} from "./calendar-retry-queue.ts";

// ─── shouldRetry ──────────────────────────────────────────────────────

Deno.test("shouldRetry: transient statuses → true", () => {
  for (const s of ["google_api_error", "token_refresh_failed", "invoke_failed"]) {
    assertEquals(shouldRetry(s), true, `expected retry for ${s}`);
  }
});

Deno.test("shouldRetry: terminal statuses → false", () => {
  for (const s of ["updated", "deleted", "created", "already_gone", "not_connected", "no_linked_event", "etag_conflict", "missing_input"]) {
    assertEquals(shouldRetry(s), false, `expected NO retry for ${s}`);
  }
});

Deno.test("shouldRetry: unknown status → false (fail safe)", () => {
  assertEquals(shouldRetry("zorblax"), false);
});

// ─── Backoff schedule contract ────────────────────────────────────────

Deno.test("BACKOFF_SCHEDULE_SEC: monotonically increases", () => {
  const s = __FOR_TESTS.BACKOFF_SCHEDULE_SEC;
  for (let i = 1; i < s.length; i++) {
    assert(s[i] > s[i - 1], `backoff non-monotonic at index ${i}: ${s[i]} ≤ ${s[i - 1]}`);
  }
});

Deno.test("BACKOFF_SCHEDULE_SEC: first retry < 1 minute (fast catch-up)", () => {
  // Tuned so transient hiccups feel automatic, not abandoned.
  assert(__FOR_TESTS.BACKOFF_SCHEDULE_SEC[0] < 60, `first backoff too slow: ${__FOR_TESTS.BACKOFF_SCHEDULE_SEC[0]}s`);
});

Deno.test("MAX_ATTEMPTS: matches schedule length + 1 (initial try)", () => {
  assertEquals(__FOR_TESTS.MAX_ATTEMPTS, __FOR_TESTS.BACKOFF_SCHEDULE_SEC.length + 1);
});

// ─── Mock supabase ────────────────────────────────────────────────────

interface MockState {
  inserts: Array<Record<string, unknown>>;
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  rpcReturn?: unknown;
  insertError?: { message: string };
}

function makeMock(state: MockState) {
  return {
    from(_table: string) {
      return {
        insert(row: Record<string, unknown>) {
          state.inserts.push(row);
          // The real call chain is .insert().select().single(). The
          // error has to surface at .single() so we keep the chain
          // shape regardless of success/failure.
          const errSnapshot = state.insertError;
          return {
            select(_cols: string) {
              return {
                single() {
                  return errSnapshot
                    ? Promise.resolve({ data: null, error: errSnapshot })
                    : Promise.resolve({ data: { id: "mock-id-1" }, error: null });
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(_col: string, val: string) {
              state.updates.push({ id: val, patch });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    rpc(fn: string, args: Record<string, unknown>) {
      state.rpcCalls.push({ fn, args });
      return Promise.resolve({ data: state.rpcReturn ?? [], error: null });
    },
  } as never;
}

function freshState(): MockState {
  return { inserts: [], updates: [], rpcCalls: [] };
}

// ─── enqueueRetry ─────────────────────────────────────────────────────

Deno.test("enqueueRetry: transient failure → inserts row with future next_attempt_at", async () => {
  const state = freshState();
  const r = await enqueueRetry(makeMock(state), {
    user_id: "u1",
    note_id: "n1",
    action: "update",
    payload: { user_id: "u1", note_id: "n1", patch: { title: "x" } },
    initial_failure_status: "google_api_error",
    initial_http_status: 503,
    initial_error: "Service Unavailable",
  });
  assertEquals(r.enqueued, true);
  assertEquals(state.inserts.length, 1);
  const row = state.inserts[0];
  assertEquals(row.user_id, "u1");
  assertEquals(row.action, "update");
  assertEquals(row.status, "pending");
  // next_attempt_at should be in the future
  const next = new Date(row.next_attempt_at as string).getTime();
  assert(next > Date.now(), "next_attempt_at not in future");
  assert(next < Date.now() + 60_000, "first retry too far in future");
  // Metadata captures the original failure reason
  const meta = row.metadata as Record<string, unknown>;
  assertEquals(meta.initial_failure_status, "google_api_error");
  assertEquals(meta.initial_http_status, 503);
});

Deno.test("enqueueRetry: non-transient status → no insert", async () => {
  const state = freshState();
  const r = await enqueueRetry(makeMock(state), {
    user_id: "u1",
    action: "update",
    payload: {},
    initial_failure_status: "etag_conflict",
  });
  assertEquals(r.enqueued, false);
  assertEquals(r.reason, "non_transient_status");
  assertEquals(state.inserts.length, 0);
});

Deno.test("enqueueRetry: not_connected → no insert (terminal product state)", async () => {
  const state = freshState();
  const r = await enqueueRetry(makeMock(state), {
    user_id: "u1",
    action: "delete",
    payload: {},
    initial_failure_status: "not_connected",
  });
  assertEquals(r.enqueued, false);
  assertEquals(state.inserts.length, 0);
});

Deno.test("enqueueRetry: insert failure is swallowed", async () => {
  const state = freshState();
  state.insertError = { message: "constraint violated" };
  const r = await enqueueRetry(makeMock(state), {
    user_id: "u1",
    action: "update",
    payload: {},
    initial_failure_status: "google_api_error",
  });
  // Doesn't throw, but reports not enqueued
  assertEquals(r.enqueued, false);
  assert(r.reason?.includes("constraint"));
});

// ─── claimNextBatch ───────────────────────────────────────────────────

Deno.test("claimNextBatch: calls the SECURITY DEFINER RPC with limit", async () => {
  const state = freshState();
  state.rpcReturn = [];
  await claimNextBatch(makeMock(state), 10);
  assertEquals(state.rpcCalls.length, 1);
  assertEquals(state.rpcCalls[0].fn, "olive_claim_calendar_sync_jobs");
  assertEquals(state.rpcCalls[0].args.p_limit, 10);
});

Deno.test("claimNextBatch: empty queue → []", async () => {
  const state = freshState();
  state.rpcReturn = null;
  const rows = await claimNextBatch(makeMock(state), 10);
  assertEquals(rows.length, 0);
});

// ─── markSucceeded ────────────────────────────────────────────────────

Deno.test("markSucceeded: writes status='succeeded' and clears last_error", async () => {
  const state = freshState();
  await markSucceeded(makeMock(state), "row-id-1", { final_status: "updated" });
  assertEquals(state.updates.length, 1);
  assertEquals(state.updates[0].id, "row-id-1");
  assertEquals(state.updates[0].patch.status, "succeeded");
  assertEquals(state.updates[0].patch.last_error, null);
});

// ─── markFailedOrAbandon ──────────────────────────────────────────────

function makeRow(overrides: Partial<CalendarSyncQueueRow> = {}): CalendarSyncQueueRow {
  return {
    id: "row-1",
    user_id: "u1",
    note_id: "n1",
    action: "update",
    payload: {},
    status: "in_flight",
    attempts: 1,
    last_attempt_at: new Date().toISOString(),
    next_attempt_at: new Date().toISOString(),
    last_error: null,
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

Deno.test("markFailedOrAbandon: transient + under cap → schedules retry", async () => {
  const state = freshState();
  const row = makeRow({ attempts: 1 });
  const dec = await markFailedOrAbandon(makeMock(state), row, {
    sync_status: "google_api_error",
    error: "503",
  });
  assertEquals(dec.retrying, true);
  const upd = state.updates[0].patch;
  assertEquals(upd.status, "pending");
  // next_attempt_at should be the SECOND backoff (attempts=1 → idx 0… wait)
  // attempts is incremented by the claim RPC before this; row.attempts=1 means
  // we just used the FIRST retry. Next idx = attempts-1 = 0 → 30s.
  // Actually attempts was incremented to N AFTER the just-finished attempt;
  // row.attempts=1 means the just-done attempt was the first retry.
  // So backoffIdx = attempts-1 = 0 → BACKOFF_SCHEDULE_SEC[0] = 30s
  const next = new Date(upd.next_attempt_at as string).getTime();
  assert(next > Date.now(), "next_attempt_at must be in future");
  assert(next < Date.now() + 5 * 60_000, "next_attempt_at unreasonably far");
});

Deno.test("markFailedOrAbandon: non-transient on retry → abandons immediately", async () => {
  const state = freshState();
  const row = makeRow({ attempts: 1 });
  const dec = await markFailedOrAbandon(makeMock(state), row, {
    sync_status: "etag_conflict",
  });
  assertEquals(dec.retrying, false);
  assertEquals(state.updates[0].patch.status, "abandoned");
});

Deno.test("markFailedOrAbandon: max attempts exceeded → abandons", async () => {
  const state = freshState();
  const row = makeRow({ attempts: __FOR_TESTS.MAX_ATTEMPTS });
  const dec = await markFailedOrAbandon(makeMock(state), row, {
    sync_status: "google_api_error",
    error: "still failing",
  });
  assertEquals(dec.retrying, false);
  assertEquals(state.updates[0].patch.status, "abandoned");
});

Deno.test("markFailedOrAbandon: backoff index clamps at last value", async () => {
  // A row with attempts already at schedule length should still produce
  // a reschedule using the last value (NOT abandon, that's a separate
  // path in markFailedOrAbandon).
  const state = freshState();
  const row = makeRow({ attempts: __FOR_TESTS.BACKOFF_SCHEDULE_SEC.length });
  const dec = await markFailedOrAbandon(makeMock(state), row, {
    sync_status: "google_api_error",
  });
  assertEquals(dec.retrying, true);
});
