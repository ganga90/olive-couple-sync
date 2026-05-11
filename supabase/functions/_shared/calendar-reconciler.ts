// _shared/calendar-reconciler.ts
//
// Phase 2.2 — apply inbound Google Calendar changes to Olive's local
// mirror.
//
// Triggered by:
//   - calendar-watch-callback (push notification → reconcile in real time)
//   - calendar-watch-renew (after re-registering, do a sync to close
//     any gap during the brief window between channels)
//   - calendar-sync /fetch_events action (manual user trigger)
//
// All three go through the same primitive: pull changes with the
// stored sync_token, apply per-event reconciliation, persist the new
// token.
//
// Reconciliation semantics per event:
//   - Cancelled (status='cancelled') → DELETE the calendar_events
//     mirror row AND clear the linked clerk_notes due/reminder if any.
//     This is the bidirectional half — a user deleting the event on
//     Google removes the task's schedule on Olive.
//   - Edited (status='confirmed'/'tentative' + matching local row) →
//     UPDATE the mirror with new time/title/etc., and if there's a
//     linked clerk_notes row mirror time changes back to it so the
//     task view stays consistent with the calendar view.
//   - New (no local row by google_event_id) → INSERT into the mirror
//     as event_type='from_calendar' (not linked to any note). These
//     are events the user created in Google's UI that Olive should
//     be aware of for conflict detection (Phase 3.1) and read-only
//     surfacing.
//
// Token handling:
//   - When `listEventsIncremental` reports `needsFullResync`, we drop
//     our token and tell the caller. The caller's retry path (calendar
//     -sync /fetch_events with no token) handles the full refetch.
//   - Successful paginated fetches advance the token only on the
//     final page (Google returns nextSyncToken only at the end).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  ensureFreshAccessToken,
  listEventsIncremental,
  type CalendarConnection,
  type IncrementalEventsPage,
} from "./google-calendar.ts";
import { logCalendarSync } from "./calendar-sync-logger.ts";

export interface ReconcileResult {
  ok: boolean;
  events_received: number;
  events_updated: number;
  events_inserted: number;
  events_deleted: number;
  clerk_notes_updated: number;
  needs_full_resync: boolean;
  error?: string;
}

// Top-level entry point. Caller passes in the connection and we drive
// the rest. Always advances calendar_sync_state.sync_token on success
// — even when the page came back empty, because Google issues a fresh
// token on every reply.
export async function reconcileFromGoogle(
  supabase: SupabaseClient,
  connection: CalendarConnection,
  invokedFrom: string,
): Promise<ReconcileResult> {
  const tokenResult = await ensureFreshAccessToken(supabase, connection);
  if (!tokenResult.ok) {
    return zeroResult({ error: `token_refresh: ${tokenResult.message}` });
  }
  const accessToken = tokenResult.value;

  // Load the current sync token. First-time syncs have none — Google
  // returns a fresh token after a (potentially large) full window
  // fetch. We don't try to do that in this function; calendar-sync's
  // /fetch_events action handles the cold start. Here we just sync
  // incrementally when we have a token, and treat its absence as
  // "nothing to do" so a brand-new connection's first push isn't a
  // full sync via the hot path.
  const { data: syncState } = await supabase
    .from("calendar_sync_state")
    .select("sync_token")
    .eq("connection_id", connection.id)
    .maybeSingle();

  const startingToken = (syncState?.sync_token as string | null) ?? null;
  if (!startingToken) {
    // No baseline; nothing to reconcile incrementally. The next call
    // to /fetch_events (manual) will seed the token.
    return zeroResult({ needs_full_resync: true });
  }

  // Page through changes. Most pushes settle in one page (Google
  // bundles changes), but a long-deferred sync after a cron gap can
  // span pages. nextSyncToken only appears on the final page.
  const counts = {
    events_received: 0,
    events_updated: 0,
    events_inserted: 0,
    events_deleted: 0,
    clerk_notes_updated: 0,
  };
  let pageToken: string | undefined;
  let finalSyncToken: string | null = null;
  let needsFullResync = false;
  // Cap pages to avoid an infinite walk if Google returns malformed
  // pagination. 40 pages × 250 events = 10k events covered per push.
  for (let i = 0; i < 40; i++) {
    const result = await listEventsIncremental(accessToken, connection.primary_calendar_id, {
      syncToken: startingToken,
      pageToken,
    });
    if (!result.ok) {
      return zeroResult({ ...counts, error: `list: ${result.message}` });
    }
    const page = result.value;
    if (page.needsFullResync) {
      // Drop our token so the next /fetch_events does a full sync.
      await supabase
        .from("calendar_sync_state")
        .update({ sync_token: null, sync_status: "needs_full_resync", updated_at: new Date().toISOString() })
        .eq("connection_id", connection.id);
      needsFullResync = true;
      break;
    }

    counts.events_received += page.events.length;
    await applyChanges(supabase, connection, page, counts);

    if (page.nextSyncToken) {
      finalSyncToken = page.nextSyncToken;
      break; // final page
    }
    if (!page.nextPageToken) {
      // No nextSyncToken AND no nextPageToken — shouldn't happen, but
      // be defensive: bail without advancing the token.
      break;
    }
    pageToken = page.nextPageToken;
  }

  if (finalSyncToken) {
    await supabase
      .from("calendar_sync_state")
      .update({
        sync_token: finalSyncToken,
        last_sync_time: new Date().toISOString(),
        sync_status: "idle",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("connection_id", connection.id);
  }

  // Surface aggregated outcome in olive_calendar_sync_log. Use the
  // existing 'updated' status — the segmentation field is
  // invoked_from, which the caller passes through.
  await logCalendarSync(supabase, {
    user_id: connection.user_id ?? "",
    action: "update",
    sync_status: needsFullResync ? "google_api_error" : "updated",
    connection_id: connection.id,
    invoked_from: invokedFrom,
    metadata: { ...counts, needs_full_resync: needsFullResync },
  });

  return { ok: true, ...counts, needs_full_resync: needsFullResync };
}

// ─── Per-event reconciliation ────────────────────────────────────────

async function applyChanges(
  supabase: SupabaseClient,
  connection: CalendarConnection,
  page: IncrementalEventsPage,
  counts: {
    events_updated: number;
    events_inserted: number;
    events_deleted: number;
    clerk_notes_updated: number;
  },
): Promise<void> {
  // Pull existing mirror rows in one query keyed by google_event_id.
  // Per-event SELECTs would be quadratic with the page; one batched
  // read is O(page_size).
  const eventIds = page.events.map((e) => e.id);
  const { data: existing } = await supabase
    .from("calendar_events")
    .select("id, google_event_id, note_id, all_day")
    .eq("connection_id", connection.id)
    .in("google_event_id", eventIds);
  const existingByGid = new Map<string, { id: string; note_id: string | null; all_day: boolean | null }>();
  for (const row of (existing ?? []) as Array<Record<string, unknown>>) {
    existingByGid.set(row.google_event_id as string, {
      id: row.id as string,
      note_id: (row.note_id as string) ?? null,
      all_day: (row.all_day as boolean) ?? null,
    });
  }

  for (const ev of page.events) {
    const local = existingByGid.get(ev.id);
    // Cancelled — delete the mirror + clear linked task schedule.
    if (ev.status === "cancelled") {
      if (!local) continue; // never knew about it, nothing to do
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", local.id);
      if (!error) counts.events_deleted++;
      // Clear the linked task's schedule so the user's Olive view
      // doesn't keep a stale due_date for an event they cancelled
      // on Google. We don't delete the task — that would be too
      // aggressive; the user might still want it as a TODO.
      if (local.note_id) {
        const { error: noteErr } = await supabase
          .from("clerk_notes")
          .update({ due_date: null, reminder_time: null, updated_at: new Date().toISOString() })
          .eq("id", local.note_id);
        if (!noteErr) counts.clerk_notes_updated++;
      }
      continue;
    }

    // Insert / update path.
    const startIso = ev.start?.dateTime ?? ev.start?.date ?? null;
    const endIso = ev.end?.dateTime ?? ev.end?.date ?? null;
    if (!startIso) continue; // malformed
    const allDay = !ev.start?.dateTime;

    if (local) {
      const { error } = await supabase
        .from("calendar_events")
        .update({
          title: ev.summary ?? "Untitled event",
          description: ev.description ?? null,
          location: ev.location ?? null,
          start_time: startIso,
          end_time: endIso ?? startIso,
          all_day: allDay,
          etag: ev.etag ?? null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", local.id);
      if (!error) counts.events_updated++;
      // If this event is linked to an Olive task and its time
      // changed, push the new time back to clerk_notes so the task
      // view stays consistent with the calendar view. This is the
      // user-visible payoff of bidirectional sync: editing on Google
      // updates Olive.
      if (local.note_id && startIso) {
        const noteUpdate: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        if (allDay) {
          noteUpdate.due_date = startIso.split("T")[0];
          noteUpdate.reminder_time = null;
        } else {
          noteUpdate.reminder_time = startIso;
          noteUpdate.due_date = startIso.split("T")[0];
        }
        const { error: noteErr } = await supabase
          .from("clerk_notes")
          .update(noteUpdate)
          .eq("id", local.note_id);
        if (!noteErr) counts.clerk_notes_updated++;
      }
    } else {
      // New event — mirror as from_calendar (not linked to any note).
      const { error } = await supabase
        .from("calendar_events")
        .insert({
          connection_id: connection.id,
          google_event_id: ev.id,
          title: ev.summary ?? "Untitled event",
          description: ev.description ?? null,
          location: ev.location ?? null,
          start_time: startIso,
          end_time: endIso ?? startIso,
          all_day: allDay,
          event_type: "from_calendar",
          etag: ev.etag ?? null,
        });
      if (!error) counts.events_inserted++;
    }
  }
}

// ─── Internal ─────────────────────────────────────────────────────────

function zeroResult(overrides: Partial<ReconcileResult> = {}): ReconcileResult {
  return {
    ok: !overrides.error,
    events_received: 0,
    events_updated: 0,
    events_inserted: 0,
    events_deleted: 0,
    clerk_notes_updated: 0,
    needs_full_resync: false,
    ...overrides,
  };
}

// Exported for tests so callers can build a synthetic page and
// validate the per-event branch logic without DB mocking.
export const __FOR_TESTS = {
  applyChanges,
};
