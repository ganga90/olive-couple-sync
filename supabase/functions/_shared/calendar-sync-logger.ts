// _shared/calendar-sync-logger.ts
//
// Single writer for olive_calendar_sync_log. Every calendar mutation
// edge function calls logCalendarSync exactly once per attempt — including
// the "early returns" (not_connected, no_linked_event). Without those, the
// sync-success rate metric is biased upward because the easy paths never
// land in the table.
//
// Failures here are swallowed: a broken analytics insert must not cause
// the caller's calendar mutation to fail. We log to console in that case
// so the gap is visible during incident review.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type CalendarSyncAction = "create" | "update" | "delete";

export type CalendarSyncStatus =
  | "created"
  | "updated"
  | "deleted"
  | "already_gone"
  | "not_connected"
  | "no_linked_event"
  | "etag_conflict"
  | "google_api_error"
  | "token_refresh_failed"
  | "invoke_failed"
  | "missing_input";

export interface CalendarSyncLogEntry {
  user_id: string;
  action: CalendarSyncAction;
  sync_status: CalendarSyncStatus;
  note_id?: string | null;
  connection_id?: string | null;
  google_event_id?: string | null;
  http_status?: number | null;
  etag_conflict?: boolean;
  latency_ms?: number | null;
  invoked_from?: string | null;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Truncate at 500 chars — Google's error bodies can be long and there's no
// point storing the full thing in the DB. Full body is in console logs.
const MAX_ERR_LEN = 500;

export async function logCalendarSync(
  supabase: SupabaseClient,
  entry: CalendarSyncLogEntry,
): Promise<void> {
  try {
    const row = {
      user_id: entry.user_id,
      action: entry.action,
      sync_status: entry.sync_status,
      note_id: entry.note_id ?? null,
      connection_id: entry.connection_id ?? null,
      google_event_id: entry.google_event_id ?? null,
      http_status: entry.http_status ?? null,
      etag_conflict: entry.etag_conflict ?? false,
      latency_ms: entry.latency_ms ?? null,
      invoked_from: entry.invoked_from ?? null,
      error_message: entry.error_message
        ? entry.error_message.slice(0, MAX_ERR_LEN)
        : null,
      metadata: entry.metadata ?? null,
    };
    const { error } = await supabase.from("olive_calendar_sync_log").insert(row);
    if (error) {
      console.warn("[calendar-sync-logger] insert failed (non-fatal):", error.message);
    }
  } catch (err) {
    console.warn(
      "[calendar-sync-logger] threw (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Convenience timer. Usage:
//   const stop = startSyncTimer();
//   ...do work...
//   await logCalendarSync(supabase, { ..., latency_ms: stop() });
export function startSyncTimer(): () => number {
  const t0 = Date.now();
  return () => Date.now() - t0;
}
