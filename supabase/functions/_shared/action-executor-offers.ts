// _shared/action-executor-offers.ts
//
// Once the user confirms a PendingOffer, this module commits the mutation:
//   - writes to clerk_notes (or deletes)
//   - propagates to Google Calendar (via calendar-update-event /
//     calendar-delete-event edge functions)
//   - returns a structured ExecutedAction so the caller can build an
//     undo stamp and a confirmation message that includes the diff
//
// We keep this separate from the planner so the offer→execute boundary
// is sharp and testable: a test can feed in a synthetic offer and check
// the resulting writes / responses without running the classifier.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type {
  BulkRescheduleOffer,
  DeleteTaskOffer,
  EditTaskOffer,
  RescheduleTaskOffer,
} from "./pending-offer.ts";
import type { LastAction } from "./web-session.ts";
import { recordReschedulePattern } from "./pattern-detector.ts";

// ─── Result types ──────────────────────────────────────────────────────

export type CalendarSyncReport = {
  status:
    | "updated"
    | "deleted"
    | "already_gone"
    | "not_connected"
    | "no_linked_event"
    | "etag_conflict"
    | "google_api_error"
    | "token_refresh_failed"
    | "invoke_failed"
    | "missing_input"
    | "skipped";
  message?: string;
  // Phase 2.1 — calendar edge functions surface these on a transient
  // failure that got enqueued for background retry. Lets the chat reply
  // distinguish "permanent failure, you should reconnect" from "transient
  // glitch, I'll catch up on my own."
  retry_enqueued?: boolean;
  retry_id?: string;
  // Phase 2.3 — populated when Google's sendUpdates notified attendees.
  attendees_notified?: boolean;
  attendee_count?: number;
};

export interface RescheduledResult {
  action: "task_rescheduled";
  task_id: string;
  task_summary: string;
  new_due_date: string | null;
  new_reminder_time: string | null;
  readable: string;
  prior_due_date: string | null;
  prior_reminder_time: string | null;
  calendar_sync: CalendarSyncReport;
  last_action: LastAction;
}

export interface DeletedResult {
  action: "task_deleted";
  task_id: string;
  task_summary: string;
  calendar_sync: CalendarSyncReport;
  last_action: LastAction;
}

export interface EditedResult {
  action: "task_edited";
  task_id: string;
  task_summary: string;
  changes: EditTaskOffer["changes"];
  calendar_sync: CalendarSyncReport;
  last_action: LastAction;
}

// Phase 3.2 — bulk reschedule. Records per-task outcomes so the
// confirmation reply can tell the user "moved 5 of 6 — 1 couldn't be
// saved" instead of pretending everything was perfect. Calendar sync
// outcomes are aggregated separately because the user cares about
// "did everything reach Google" as a single signal, not 6 separate
// suffixes.
export interface BulkRescheduledResult {
  action: "tasks_bulk_rescheduled";
  from_dow: number;
  to_dow: number;
  attempted: number;
  succeeded: number;
  failed: number;
  // Top-line aggregated calendar sync — 'all_synced' / 'partial' /
  // 'none_synced' / 'not_connected'. Drives the calendar suffix copy.
  calendar_aggregate: "all_synced" | "partial" | "none_synced" | "not_connected" | "no_linked_events";
  // Per-task outcomes for the confirmation message + telemetry.
  outcomes: Array<{
    task_id: string;
    task_summary: string;
    success: boolean;
    calendar_synced: boolean;
    error?: string;
  }>;
  last_action: LastAction;
}

export type ExecutedAction =
  | RescheduledResult
  | DeletedResult
  | EditedResult
  | BulkRescheduledResult;

// ─── Executors ─────────────────────────────────────────────────────────

interface ExecuteContext {
  supabase: SupabaseClient;
  userId: string;
  invokedFrom: string; // for analytics
}

export async function executeReschedule(
  ctx: ExecuteContext,
  offer: RescheduleTaskOffer,
): Promise<RescheduledResult | null> {
  const { supabase, userId } = ctx;

  // Build the clerk_notes update. We preserve the field semantics from
  // the broken-then-fixed handler: when has_time, store full ISO into
  // reminder_time and also stamp due_date (date portion). When date-only,
  // store just the date portion into due_date.
  const updateFields: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (offer.has_time) {
    updateFields.reminder_time = offer.new_iso;
    updateFields.due_date = offer.new_iso.split("T")[0];
  } else {
    updateFields.due_date = offer.new_iso.split("T")[0];
    // Clear any stale reminder_time so the calendar doesn't keep an old
    // time after a date-only reschedule.
    updateFields.reminder_time = null;
  }

  const { error } = await supabase
    .from("clerk_notes")
    .update(updateFields)
    .eq("id", offer.task_id);
  if (error) {
    console.error("[executeReschedule] DB update failed:", error);
    return null;
  }

  // Propagate to Google. Calendar sync errors don't block the DB write —
  // they flow back via calendar_sync.
  const calendarSync = await invokeCalendarUpdate(supabase, {
    user_id: userId,
    note_id: offer.task_id,
    patch: {
      start_time: offer.has_time ? offer.new_iso : updateFields.due_date as string,
      all_day: !offer.has_time,
      timezone: offer.timezone,
    },
    invoked_from: ctx.invokedFrom,
  });

  const last_action: LastAction = {
    kind: "reschedule_task",
    task_id: offer.task_id,
    task_summary: offer.task_summary,
    prior_due_date: offer.prior_due_date,
    prior_reminder_time: offer.prior_reminder_time,
    new_due_date: (updateFields.due_date as string) || null,
    new_reminder_time: (updateFields.reminder_time as string) || null,
    calendar_synced: calendarSync.status === "updated",
    executed_at: new Date().toISOString(),
  };

  // Phase 3.5 — pattern learning. Record the (prior, new) reschedule
  // so future offers can surface the user's habit. Non-blocking; errors
  // never affect the user-visible outcome.
  await recordReschedulePattern(supabase, {
    userId,
    priorIso: offer.prior_reminder_time || offer.prior_due_date,
    newIso: offer.new_iso,
    timezone: offer.timezone,
  });

  return {
    action: "task_rescheduled",
    task_id: offer.task_id,
    task_summary: offer.task_summary,
    new_due_date: (updateFields.due_date as string) || null,
    new_reminder_time: (updateFields.reminder_time as string) || null,
    readable: offer.readable,
    prior_due_date: offer.prior_due_date,
    prior_reminder_time: offer.prior_reminder_time,
    calendar_sync: calendarSync,
    last_action,
  };
}

export async function executeDelete(
  ctx: ExecuteContext,
  offer: DeleteTaskOffer,
): Promise<DeletedResult | null> {
  const { supabase, userId } = ctx;

  // Fetch the full row BEFORE delete so undo can re-insert it. Without
  // this, undo of a delete would silently fail — there'd be nothing to
  // restore.
  const { data: row } = await supabase
    .from("clerk_notes")
    .select("*")
    .eq("id", offer.task_id)
    .maybeSingle();

  // Look up linked Google event id BEFORE we delete the calendar event
  // (so the undo stamp knows what to re-create on Google if the user
  // changes their mind).
  let linkedGoogleEventId: string | null = null;
  const { data: cal } = await supabase
    .from("calendar_events")
    .select("google_event_id")
    .eq("note_id", offer.task_id)
    .maybeSingle();
  if (cal?.google_event_id) linkedGoogleEventId = cal.google_event_id;

  // Tear down Google event first. Errors are non-fatal and flow back via
  // calendar_sync.
  const calendarSync = await invokeCalendarDelete(supabase, {
    user_id: userId,
    note_id: offer.task_id,
    invoked_from: ctx.invokedFrom,
  });

  const { error } = await supabase
    .from("clerk_notes")
    .delete()
    .eq("id", offer.task_id);
  if (error) {
    console.error("[executeDelete] DB delete failed:", error);
    return null;
  }

  const last_action: LastAction = {
    kind: "delete_task",
    task_summary: offer.task_summary,
    restored_row: pickRestorableColumns(row ?? {}),
    google_event_id: linkedGoogleEventId,
    executed_at: new Date().toISOString(),
  };

  return {
    action: "task_deleted",
    task_id: offer.task_id,
    task_summary: offer.task_summary,
    calendar_sync: calendarSync,
    last_action,
  };
}

// Phase 3.2 — execute a confirmed bulk reschedule. Loops the
// pre-computed candidates from the offer, applies the same DB write +
// calendar sync as single-task reschedule (no re-derivation), and
// aggregates outcomes for the confirmation reply.
//
// Per-task failures DON'T abort the loop. A single Google 5xx on
// candidate 4-of-6 shouldn't prevent candidates 5 and 6 from going
// through. The aggregated calendar_aggregate signal tells the user
// "all 6 synced" / "5 of 6 synced — I'll keep trying on the others
// in the background" via the retry queue from Phase 2.1.
export async function executeBulkReschedule(
  ctx: ExecuteContext,
  offer: BulkRescheduleOffer,
): Promise<BulkRescheduledResult | null> {
  const { supabase, userId } = ctx;
  const outcomes: BulkRescheduledResult["outcomes"] = [];
  const undoEntries: Extract<LastAction, { kind: "bulk_reschedule_task" }>["entries"] = [];
  let calendarSyncedCount = 0;
  let calendarUnlinkedCount = 0;
  let calendarConnectedSeen = false;

  for (const cand of offer.candidates) {
    const updateFields: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (cand.has_time) {
      updateFields.reminder_time = cand.new_iso;
      updateFields.due_date = cand.new_iso.split("T")[0];
    } else {
      updateFields.due_date = cand.new_iso.split("T")[0];
      // Mirror single-task contract: clear stale reminder_time on
      // date-only shifts so Google doesn't keep an old time.
      updateFields.reminder_time = null;
    }

    const { error } = await supabase
      .from("clerk_notes")
      .update(updateFields)
      .eq("id", cand.task_id);

    if (error) {
      outcomes.push({
        task_id: cand.task_id,
        task_summary: cand.task_summary,
        success: false,
        calendar_synced: false,
        error: error.message,
      });
      continue;
    }

    // Propagate to Google. Errors flow back via calendar_sync; the
    // retry queue handles transient failures automatically. We don't
    // stop the loop on a calendar failure — the DB write already
    // succeeded for THIS task.
    const calendarSync = await invokeCalendarUpdate(supabase, {
      user_id: userId,
      note_id: cand.task_id,
      patch: {
        start_time: cand.has_time ? cand.new_iso : (updateFields.due_date as string),
        all_day: !cand.has_time,
        timezone: offer.timezone,
      },
      invoked_from: "bulk-reschedule",
    });
    const synced = calendarSync.status === "updated";
    if (synced) calendarSyncedCount++;
    if (calendarSync.status === "no_linked_event") calendarUnlinkedCount++;
    if (calendarSync.status !== "not_connected") calendarConnectedSeen = true;

    outcomes.push({
      task_id: cand.task_id,
      task_summary: cand.task_summary,
      success: true,
      calendar_synced: synced,
    });
    undoEntries.push({
      task_id: cand.task_id,
      task_summary: cand.task_summary,
      prior_due_date: cand.prior_due_date,
      prior_reminder_time: cand.prior_reminder_time,
      new_due_date: (updateFields.due_date as string) || null,
      new_reminder_time: (updateFields.reminder_time as string) || null,
      calendar_synced: synced,
    });

    // Phase 3.5 — record the (prior, new) pattern for THIS task. The
    // bulk operation will produce the same (from_dow, to_dow)
    // fingerprint for every candidate, so the pattern store sees
    // multiple reinforcements of the same shift — which is exactly
    // what surfaces the pattern next time. Errors swallow.
    await recordReschedulePattern(supabase, {
      userId,
      priorIso: cand.prior_reminder_time || cand.prior_due_date,
      newIso: cand.new_iso,
      timezone: offer.timezone,
    });
  }

  const succeeded = outcomes.filter((o) => o.success).length;
  const failed = outcomes.length - succeeded;

  // Aggregate calendar outcome for the suffix copy. Branches in
  // priority order: never-connected → not_connected; everything that
  // had a linked event reached Google → all_synced; some did, some
  // didn't → partial; nothing did → none_synced; nothing was linked
  // to begin with → no_linked_events.
  let calendarAggregate: BulkRescheduledResult["calendar_aggregate"];
  if (!calendarConnectedSeen) {
    calendarAggregate = "not_connected";
  } else if (succeeded === 0) {
    calendarAggregate = "none_synced";
  } else if (calendarUnlinkedCount === succeeded) {
    calendarAggregate = "no_linked_events";
  } else if (calendarSyncedCount === succeeded - calendarUnlinkedCount) {
    calendarAggregate = "all_synced";
  } else if (calendarSyncedCount === 0) {
    calendarAggregate = "none_synced";
  } else {
    calendarAggregate = "partial";
  }

  const last_action: LastAction = {
    kind: "bulk_reschedule_task",
    from_dow: offer.from_dow,
    to_dow: offer.to_dow,
    entries: undoEntries,
    executed_at: new Date().toISOString(),
  };

  return {
    action: "tasks_bulk_rescheduled",
    from_dow: offer.from_dow,
    to_dow: offer.to_dow,
    attempted: offer.candidates.length,
    succeeded,
    failed,
    calendar_aggregate: calendarAggregate,
    outcomes,
    last_action,
  };
}

export async function executeEdit(
  ctx: ExecuteContext,
  offer: EditTaskOffer,
): Promise<EditedResult | null> {
  const { supabase, userId } = ctx;

  // Refetch the row for the latest description (prior was best-effort from
  // the offer; we want the up-to-date version to capture in the undo).
  const { data: row } = await supabase
    .from("clerk_notes")
    .select("summary, original_text")
    .eq("id", offer.task_id)
    .maybeSingle();
  const priorSummary = row?.summary ?? offer.prior.summary;
  const priorDescription = row?.original_text ?? offer.prior.description;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (offer.changes.new_title !== undefined) update.summary = offer.changes.new_title;
  if (offer.changes.new_description !== undefined) update.original_text = offer.changes.new_description;
  // duration/location aren't columns on clerk_notes — they only land on
  // the calendar event. The DB write is skipped for those fields.

  if (Object.keys(update).length > 1) {
    const { error } = await supabase
      .from("clerk_notes")
      .update(update)
      .eq("id", offer.task_id);
    if (error) {
      console.error("[executeEdit] DB update failed:", error);
      return null;
    }
  }

  // Propagate to Google Calendar where applicable. title → summary,
  // location → location, description → description, duration → end_time
  // (re-derived from existing start_time + new duration).
  const calendarSync = await invokeCalendarUpdate(supabase, {
    user_id: userId,
    note_id: offer.task_id,
    patch: {
      title: offer.changes.new_title,
      description: offer.changes.new_description,
      location: offer.changes.new_location,
      duration_minutes: offer.changes.new_duration_minutes,
    },
    invoked_from: ctx.invokedFrom,
  });

  const last_action: LastAction = {
    kind: "edit_task",
    task_id: offer.task_id,
    task_summary: offer.task_summary,
    prior: { summary: priorSummary, description: priorDescription },
    new: {
      summary: offer.changes.new_title,
      description: offer.changes.new_description,
    },
    calendar_synced: calendarSync.status === "updated",
    executed_at: new Date().toISOString(),
  };

  return {
    action: "task_edited",
    task_id: offer.task_id,
    task_summary: offer.changes.new_title ?? offer.task_summary,
    changes: offer.changes,
    calendar_sync: calendarSync,
    last_action,
  };
}

// ─── Undo ──────────────────────────────────────────────────────────────

// Reverse a previously-stamped LastAction. We accept defeat on subtle
// edge cases (Google might've drifted): undo is best-effort but always
// reports what it actually did.
export async function executeUndo(
  ctx: ExecuteContext,
  last: LastAction,
): Promise<{ kind: LastAction["kind"]; reverted: boolean; detail?: string }> {
  const { supabase, userId } = ctx;

  switch (last.kind) {
    case "reschedule_task": {
      const update: Record<string, unknown> = {
        due_date: last.prior_due_date,
        reminder_time: last.prior_reminder_time,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("clerk_notes")
        .update(update)
        .eq("id", last.task_id);
      if (error) return { kind: "reschedule_task", reverted: false, detail: error.message };

      // Revert Google too, if it was synced last time. If it wasn't,
      // skip — we don't want undo to silently introduce a new event.
      if (last.calendar_synced) {
        const start = last.prior_reminder_time || last.prior_due_date;
        if (start) {
          await invokeCalendarUpdate(supabase, {
            user_id: userId,
            note_id: last.task_id,
            patch: {
              start_time: start,
              all_day: !last.prior_reminder_time,
            },
            invoked_from: `${ctx.invokedFrom}:undo`,
          });
        }
      }
      return { kind: "reschedule_task", reverted: true };
    }

    case "delete_task": {
      // Re-insert the row. We rely on the standard triggers (search
      // vectors, updated_at) to fill derived fields on insert.
      if (!last.restored_row || !last.restored_row.id) {
        return { kind: "delete_task", reverted: false, detail: "no_row_to_restore" };
      }
      const { error } = await supabase
        .from("clerk_notes")
        .insert(last.restored_row as never);
      if (error) return { kind: "delete_task", reverted: false, detail: error.message };
      // We deliberately do NOT recreate the Google event here. If the
      // user wants the event back, they can re-issue the original create
      // — auto-calendar-event will handle it. Recreating implicitly would
      // produce a fresh event ID and confuse the user's calendar history.
      return { kind: "delete_task", reverted: true };
    }

    case "edit_task": {
      const update: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (last.new.summary !== undefined) update.summary = last.prior.summary;
      if (last.new.description !== undefined) update.original_text = last.prior.description;
      if (Object.keys(update).length > 1) {
        const { error } = await supabase
          .from("clerk_notes")
          .update(update)
          .eq("id", last.task_id);
        if (error) return { kind: "edit_task", reverted: false, detail: error.message };
      }
      if (last.calendar_synced) {
        await invokeCalendarUpdate(supabase, {
          user_id: userId,
          note_id: last.task_id,
          patch: {
            title: last.new.summary !== undefined ? last.prior.summary : undefined,
            description: last.new.description !== undefined ? (last.prior.description ?? "") : undefined,
          },
          invoked_from: `${ctx.invokedFrom}:undo`,
        });
      }
      return { kind: "edit_task", reverted: true };
    }

    case "bulk_reschedule_task": {
      // Reverse every entry. Per-entry failures don't abort the loop;
      // we report a partial undo via the detail field so the user
      // knows that most-but-not-all came back.
      let reverted = 0;
      let failed = 0;
      for (const e of last.entries) {
        const updateFields: Record<string, unknown> = {
          due_date: e.prior_due_date,
          reminder_time: e.prior_reminder_time,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase
          .from("clerk_notes")
          .update(updateFields)
          .eq("id", e.task_id);
        if (error) {
          failed++;
          continue;
        }
        reverted++;
        // Roll Google back only when we synced it forward. If we
        // didn't, undoing on Google would mint nothing useful — and
        // could write a fresh event we never intended.
        if (e.calendar_synced) {
          const anchor = e.prior_reminder_time || e.prior_due_date;
          if (anchor) {
            await invokeCalendarUpdate(supabase, {
              user_id: userId,
              note_id: e.task_id,
              patch: {
                start_time: anchor,
                all_day: !e.prior_reminder_time,
              },
              invoked_from: `${ctx.invokedFrom}:undo`,
            });
          }
        }
      }
      if (reverted === 0) {
        return { kind: "bulk_reschedule_task", reverted: false, detail: `0 of ${last.entries.length} reverted` };
      }
      if (failed > 0) {
        return {
          kind: "bulk_reschedule_task",
          reverted: true,
          detail: `${reverted} of ${last.entries.length} restored (${failed} failed)`,
        };
      }
      return { kind: "bulk_reschedule_task", reverted: true };
    }
  }
}

// ─── Edge function invocations ─────────────────────────────────────────

async function invokeCalendarUpdate(
  supabase: SupabaseClient,
  body: {
    user_id: string;
    note_id?: string;
    google_event_id?: string;
    patch: Record<string, unknown>;
    invoked_from?: string;
  },
): Promise<CalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke("calendar-update-event", { body });
    if (error) return { status: "invoke_failed", message: error.message };
    return {
      status: (data?.sync_status as CalendarSyncReport["status"]) || "invoke_failed",
      message: data?.error,
      retry_enqueued: data?.retry_enqueued,
      retry_id: data?.retry_id,
      attendees_notified: data?.attendees_notified,
      attendee_count: data?.attendee_count,
    };
  } catch (e) {
    return { status: "invoke_failed", message: e instanceof Error ? e.message : String(e) };
  }
}

async function invokeCalendarDelete(
  supabase: SupabaseClient,
  body: { user_id: string; note_id?: string; google_event_id?: string; invoked_from?: string },
): Promise<CalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke("calendar-delete-event", { body });
    if (error) return { status: "invoke_failed", message: error.message };
    return {
      status: (data?.sync_status as CalendarSyncReport["status"]) || "invoke_failed",
      message: data?.error,
      retry_enqueued: data?.retry_enqueued,
      retry_id: data?.retry_id,
      attendees_notified: data?.attendees_notified,
      attendee_count: data?.attendee_count,
    };
  } catch (e) {
    return { status: "invoke_failed", message: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────

// Strip columns we don't want to copy on a delete-undo: search vectors,
// embeddings, big-blob fields that get regenerated by triggers. Keep
// only what the user expects to "come back" — summary, dates, list,
// priority, the works.
function pickRestorableColumns(row: Record<string, unknown>): Record<string, unknown> {
  const KEEP = [
    "id",
    "author_id",
    "space_id",
    "summary",
    "original_text",
    "due_date",
    "reminder_time",
    "priority",
    "list_id",
    "completed",
    "category",
    "is_sensitive",
    "created_at",
  ];
  const out: Record<string, unknown> = {};
  for (const k of KEEP) {
    if (k in row) out[k] = row[k];
  }
  return out;
}
