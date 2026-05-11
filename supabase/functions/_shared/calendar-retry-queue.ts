// _shared/calendar-retry-queue.ts
//
// Phase 2.1 — durable retry for failed Google Calendar syncs.
//
// The contract is narrow on purpose:
//
//   - enqueueRetry: called by calendar-update-event / calendar-delete-
//     event when a transient failure surfaces. Idempotent in spirit:
//     two near-simultaneous failures for the same note will produce two
//     queue rows; that's fine — the second retry sees "already up to
//     date" semantics from Google and reports `updated` again.
//   - claimNextBatch: called by the worker (calendar-sync-retry edge
//     function) every cron tick. Atomic via the SECURITY-DEFINER RPC
//     in the migration. SKIP LOCKED prevents double-pickup under
//     concurrent invocations.
//   - markSucceeded / markFailed: terminal-state writers. markFailed
//     decides whether to schedule a retry (within the backoff schedule)
//     or abandon (after MAX_ATTEMPTS).
//
// The backoff schedule is deliberately aggressive on the first few
// retries (30s, 2m, 10m) because most "transient" Google errors clear
// up fast — and users expect their calendar to catch up minutes, not
// hours, after a hiccup.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type CalendarSyncQueueAction = "create" | "update" | "delete";

export interface CalendarSyncQueueRow {
  id: string;
  user_id: string;
  note_id: string | null;
  action: CalendarSyncQueueAction;
  payload: Record<string, unknown>;
  status: "pending" | "in_flight" | "succeeded" | "failed" | "abandoned";
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Schedule: minutes between attempts after each failure. Index is the
// "retry-number-about-to-fire". So the FIRST retry happens 30s after
// the original failure, the SECOND retry 2 minutes after the first, etc.
// Length is the abandon threshold — exhaust the array → status='abandoned'.
const BACKOFF_SCHEDULE_SEC = [30, 120, 600, 3600, 21600]; // 30s, 2m, 10m, 1h, 6h
const MAX_ATTEMPTS = BACKOFF_SCHEDULE_SEC.length + 1; // initial + 5 retries

// Statuses we consider transient and retry-worthy. Everything else is a
// permanent state: missing input is a caller bug, not_connected /
// no_linked_event are terminal product states ("there's nothing to
// sync"), etag_conflict means the user edited externally and our last-
// write-wins fallback is the right answer (we don't want to re-fight
// the conflict five times). missing_input cannot be retried — re-issuing
// the same broken request will produce the same broken response.
const RETRYABLE_STATUSES = new Set([
  "google_api_error",
  "token_refresh_failed",
  "invoke_failed",
]);

export function shouldRetry(syncStatus: string): boolean {
  return RETRYABLE_STATUSES.has(syncStatus);
}

// ─── Enqueue ──────────────────────────────────────────────────────────

export interface EnqueueArgs {
  user_id: string;
  note_id?: string | null;
  action: CalendarSyncQueueAction;
  payload: Record<string, unknown>;
  // What just happened — the original sync_status — so the worker can
  // see the cause for analytics segmentation.
  initial_failure_status: string;
  initial_http_status?: number | null;
  initial_error?: string | null;
}

export async function enqueueRetry(
  supabase: SupabaseClient,
  args: EnqueueArgs,
): Promise<{ enqueued: boolean; id?: string; reason?: string }> {
  if (!shouldRetry(args.initial_failure_status)) {
    return { enqueued: false, reason: "non_transient_status" };
  }
  try {
    const { data, error } = await supabase
      .from("olive_calendar_sync_queue")
      .insert({
        user_id: args.user_id,
        note_id: args.note_id ?? null,
        action: args.action,
        payload: args.payload,
        status: "pending",
        // First retry fires after the initial backoff window.
        next_attempt_at: new Date(Date.now() + BACKOFF_SCHEDULE_SEC[0] * 1000).toISOString(),
        last_error: args.initial_error ?? null,
        metadata: {
          initial_failure_status: args.initial_failure_status,
          initial_http_status: args.initial_http_status ?? null,
        },
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[calendar-retry-queue] enqueue failed (non-fatal):", error.message);
      return { enqueued: false, reason: error.message };
    }
    return { enqueued: true, id: data?.id };
  } catch (err) {
    console.warn(
      "[calendar-retry-queue] enqueue threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
    return { enqueued: false, reason: "exception" };
  }
}

// ─── Worker-side ──────────────────────────────────────────────────────

// Atomically claim up to N due rows. Uses the SECURITY DEFINER RPC
// declared in the migration so that two concurrent worker invocations
// don't fight over the same row.
export async function claimNextBatch(
  supabase: SupabaseClient,
  limit: number,
): Promise<CalendarSyncQueueRow[]> {
  const { data, error } = await supabase.rpc("olive_claim_calendar_sync_jobs", {
    p_limit: limit,
  });
  if (error) {
    console.warn("[calendar-retry-queue] claim failed:", error.message);
    return [];
  }
  return (data as CalendarSyncQueueRow[]) || [];
}

export async function markSucceeded(
  supabase: SupabaseClient,
  id: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await supabase
    .from("olive_calendar_sync_queue")
    .update({
      status: "succeeded",
      last_error: null,
      metadata: metadata ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Decide whether a freshly-failed claim retries or abandons. The
// `attempts` count was already incremented by the claim RPC, so a row
// reaching MAX_ATTEMPTS means we've exhausted the schedule.
export async function markFailedOrAbandon(
  supabase: SupabaseClient,
  row: CalendarSyncQueueRow,
  failure: { sync_status: string; error?: string | null; http_status?: number | null },
): Promise<{ retrying: boolean; nextAttemptAt?: string }> {
  // Non-transient failure on a retry path → abandon immediately. We
  // shouldn't keep trying when the answer is "this won't ever work."
  if (!shouldRetry(failure.sync_status)) {
    await abandon(supabase, row.id, failure);
    return { retrying: false };
  }

  // Out of attempts → abandon.
  if (row.attempts >= MAX_ATTEMPTS) {
    await abandon(supabase, row.id, failure);
    return { retrying: false };
  }

  // Backoff index is `attempts - 1` because attempts already includes
  // the just-completed attempt. So row.attempts=1 (just made first
  // retry) → next backoff is BACKOFF_SCHEDULE_SEC[1] (2m). When
  // attempts=N (=length), we've used the last backoff; the abandon
  // check above caught that case.
  const backoffIdx = Math.max(0, Math.min(row.attempts - 1, BACKOFF_SCHEDULE_SEC.length - 1));
  const nextSec = BACKOFF_SCHEDULE_SEC[backoffIdx];
  const nextAt = new Date(Date.now() + nextSec * 1000).toISOString();

  await supabase
    .from("olive_calendar_sync_queue")
    .update({
      status: "pending",
      next_attempt_at: nextAt,
      last_error: failure.error ?? null,
      metadata: {
        ...(row.metadata ?? {}),
        last_failure_status: failure.sync_status,
        last_http_status: failure.http_status ?? null,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  return { retrying: true, nextAttemptAt: nextAt };
}

async function abandon(
  supabase: SupabaseClient,
  id: string,
  failure: { sync_status: string; error?: string | null; http_status?: number | null },
): Promise<void> {
  await supabase
    .from("olive_calendar_sync_queue")
    .update({
      status: "abandoned",
      last_error: failure.error ?? null,
      metadata: {
        last_failure_status: failure.sync_status,
        last_http_status: failure.http_status ?? null,
        abandoned_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// ─── Test exports ─────────────────────────────────────────────────────
// Exported only for unit tests; production callers should not depend on
// these specific values. If we tune the schedule, tests update along with it.
export const __FOR_TESTS = {
  BACKOFF_SCHEDULE_SEC,
  MAX_ATTEMPTS,
  RETRYABLE_STATUSES,
};
