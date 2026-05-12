// calendar-update-event
// ─────────────────────────────────────────────────────────────────────
// Patches an existing Google Calendar event for the caller's user, and
// keeps the local `calendar_events` mirror row in sync. Closes the
// long-standing bug where rescheduling via Ask Olive only updated
// clerk_notes; the chat happily confirmed an edit that never reached
// Google.
//
// Every exit path logs to olive_calendar_sync_log via the shared logger
// so sync-success-rate is measurable without guessing from console logs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildEventTiming,
  ensureFreshAccessToken,
  findLinkedEventByNoteId,
  getActiveCalendarConnection,
  getGoogleEvent,
  patchGoogleEvent,
  type CalendarConnection,
  type GoogleEventPatch,
  type LinkedCalendarEvent,
  type SendUpdatesPolicy,
} from "../_shared/google-calendar.ts";
import {
  logCalendarSync,
  startSyncTimer,
  type CalendarSyncStatus,
} from "../_shared/calendar-sync-logger.ts";
import { enqueueRetry, shouldRetry } from "../_shared/calendar-retry-queue.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface UpdateRequest {
  user_id: string;
  note_id?: string;
  google_event_id?: string;
  patch: {
    title?: string;
    description?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    all_day?: boolean;
    timezone?: string;
    duration_minutes?: number;
  };
  // last-write-wins by default; set false to surface etag conflicts.
  force?: boolean;
  // Where the call originated — for analytics segmentation.
  invoked_from?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stop = startSyncTimer();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Pre-declare these so the central exit helper can log them even on
  // early returns (missing_input, not_connected, etc).
  let userId = "";
  let noteId: string | null = null;
  let googleEventId: string | null = null;
  let connectionId: string | null = null;
  let invokedFrom: string | null = null;
  // Original request body — captured at the top of `try` so the exit
  // helper can re-enqueue the EXACT same payload when a transient
  // failure surfaces. Re-deriving from in-scope vars wouldn't reliably
  // round-trip the caller's intent (e.g. force flag, optional fields).
  let originalBody: Record<string, unknown> | null = null;

  // Single exit point for every response. Always logs to
  // olive_calendar_sync_log so we never miss an outcome — and now also
  // enqueues a retry on transient failures so the user's calendar
  // catches up without their having to retry by hand.
  async function exit(
    status: CalendarSyncStatus,
    httpStatus: number,
    payload: Record<string, unknown>,
    extra: {
      etag_conflict?: boolean;
      google_status?: number;
      error?: string;
      // L2 (2026-05-12): Google's Retry-After hint. Passed through to
      // enqueueRetry so the next-attempt time honors it instead of
      // using the default 30s backoff (which would just trip the same
      // rate limit again).
      retry_after_ms?: number;
    } = {},
  ): Promise<Response> {
    await logCalendarSync(supabase, {
      user_id: userId,
      action: "update",
      sync_status: status,
      note_id: noteId,
      connection_id: connectionId,
      google_event_id: googleEventId,
      http_status: extra.google_status ?? null,
      etag_conflict: extra.etag_conflict ?? false,
      latency_ms: stop(),
      invoked_from: invokedFrom,
      error_message: extra.error ?? null,
    });

    // Phase 2.1: enqueue retry on transient failures. Two guards:
    //   1. The status itself must be retryable (shouldRetry filters out
    //      missing_input / not_connected / no_linked_event / etag_conflict
    //      and, after L2, needs_reconnect / already_gone).
    //   2. The caller must NOT be the retry worker itself — without this
    //      check, every failed retry would enqueue a fresh row on top of
    //      the one already being worked, causing exponential queue growth.
    if (
      shouldRetry(status) &&
      invokedFrom !== "calendar-sync-retry" &&
      userId &&
      originalBody
    ) {
      const enq = await enqueueRetry(supabase, {
        user_id: userId,
        note_id: noteId,
        action: "update",
        // Strip invoked_from so the retry worker's invocation tags
        // analytics correctly (the worker sets its own invoked_from).
        payload: { ...originalBody, invoked_from: undefined },
        initial_failure_status: status,
        initial_http_status: extra.google_status ?? null,
        initial_error: extra.error ?? null,
        // L2: when Google gave us a Retry-After (only for rate_limited
        // today), the queue's first attempt waits that long instead of
        // the default 30s. Defending the same rate limit by trying
        // again in 30s would just re-trip it.
        retry_after_ms: extra.retry_after_ms,
      });
      if (enq.enqueued) {
        // Reflect the enqueue in the response so callers can tell the
        // user "I'll retry" instead of just "it failed."
        (payload as Record<string, unknown>).retry_enqueued = true;
        (payload as Record<string, unknown>).retry_id = enq.id;
      } else {
        // L3 (2026-05-12): enqueue actually failed despite shouldRetry
        // saying yes. This is the case where the user-facing copy used
        // to dead-end on "but I couldn't reach Google Calendar this
        // time" with no recourse — the retry queue silently rejected
        // the row and the chat reply had no way to know.
        //
        // We DON'T overwrite payload.sync_status because that would
        // lose the original Google reason in analytics. Instead we
        // surface enqueue_failed as a separate signal AND write a
        // second log row so this state is visible in
        // olive_calendar_sync_log.
        (payload as Record<string, unknown>).retry_enqueued = false;
        (payload as Record<string, unknown>).enqueue_failed = true;
        (payload as Record<string, unknown>).enqueue_failure_reason = enq.reason ?? "unknown";
        await logCalendarSync(supabase, {
          user_id: userId,
          action: "update",
          sync_status: "enqueue_failed",
          note_id: noteId,
          connection_id: connectionId,
          google_event_id: googleEventId,
          http_status: null,
          latency_ms: 0,
          invoked_from: invokedFrom,
          error_message: `enqueue_failed (origin=${status}): ${enq.reason ?? "unknown"}`,
          metadata: { origin_sync_status: status },
        });
      }
    }

    return new Response(JSON.stringify(payload), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as UpdateRequest;
    originalBody = body as unknown as Record<string, unknown>;
    const { user_id, note_id, google_event_id, patch, force = true, invoked_from } = body;
    userId = user_id;
    noteId = note_id ?? null;
    googleEventId = google_event_id ?? null;
    invokedFrom = invoked_from ?? null;

    if (!user_id || (!note_id && !google_event_id)) {
      return exit("missing_input", 200, {
        success: false,
        synced_to_google: false,
        sync_status: "missing_input",
        error: "user_id and one of {note_id, google_event_id} are required",
      }, { error: "missing user_id or target" });
    }
    if (!patch || Object.keys(patch).length === 0) {
      return exit("missing_input", 200, {
        success: false,
        synced_to_google: false,
        sync_status: "missing_input",
        error: "patch is required",
      }, { error: "empty patch" });
    }

    // ── Resolve connection ──
    const connection: CalendarConnection | null = await getActiveCalendarConnection(supabase, user_id);
    if (!connection) {
      return exit("not_connected", 200, {
        success: true,
        synced_to_google: false,
        sync_status: "not_connected",
      });
    }
    connectionId = connection.id;

    // ── Resolve linked Google event ──
    let linked: LinkedCalendarEvent | null = null;
    if (note_id) {
      linked = await findLinkedEventByNoteId(supabase, note_id, connection.id);
    } else if (google_event_id) {
      const { data } = await supabase
        .from("calendar_events")
        .select(
          "id, connection_id, google_event_id, etag, title, start_time, end_time, all_day, timezone, note_id",
        )
        .eq("connection_id", connection.id)
        .eq("google_event_id", google_event_id)
        .maybeSingle();
      linked = (data as LinkedCalendarEvent) ?? null;
    }

    if (!linked) {
      return exit("no_linked_event", 200, {
        success: true,
        synced_to_google: false,
        sync_status: "no_linked_event",
      });
    }
    googleEventId = linked.google_event_id;

    // ── Refresh OAuth token if needed ──
    const tokenResult = await ensureFreshAccessToken(supabase, connection);
    if (!tokenResult.ok) {
      console.error("[calendar-update-event] token refresh failed:", tokenResult.message);
      return exit("token_refresh_failed", 200, {
        success: false,
        synced_to_google: false,
        sync_status: "token_refresh_failed",
        error: tokenResult.message,
      }, { error: tokenResult.message });
    }
    const accessToken = tokenResult.value;

    // ── Build Google PATCH body ──
    const googlePatch: GoogleEventPatch = {};
    if (patch.title !== undefined) googlePatch.summary = patch.title;
    if (patch.description !== undefined) googlePatch.description = patch.description;
    if (patch.location !== undefined) googlePatch.location = patch.location;

    let newStartIso: string | undefined;
    let newEndIso: string | undefined;
    let newAllDay: boolean | undefined;
    const eventTz = patch.timezone || linked.timezone || "UTC";

    if (patch.start_time) {
      const timing = buildEventTiming(patch.start_time, {
        allDay: patch.all_day,
        timeZone: eventTz,
        durationMinutes: patch.duration_minutes,
      });
      googlePatch.start = timing.start;
      if (patch.end_time) {
        googlePatch.end = timing.isAllDay
          ? { date: new Date(patch.end_time).toISOString().split("T")[0] }
          : { dateTime: new Date(patch.end_time).toISOString(), timeZone: eventTz };
      } else {
        googlePatch.end = timing.end;
      }
      newStartIso = googlePatch.start.dateTime ?? googlePatch.start.date;
      newEndIso = googlePatch.end.dateTime ?? googlePatch.end.date;
      newAllDay = timing.isAllDay;
    } else if (patch.end_time) {
      googlePatch.end = linked.all_day
        ? { date: new Date(patch.end_time).toISOString().split("T")[0] }
        : { dateTime: new Date(patch.end_time).toISOString(), timeZone: eventTz };
      newEndIso = googlePatch.end.dateTime ?? googlePatch.end.date;
    }

    // Phase 2.3 — pre-check attendees so we can pass sendUpdates=all
    // when the event has people on it. We only fetch when the change
    // is materially user-visible to attendees: time / title / location /
    // duration. Description-only or notes-only edits don't notify by
    // default. Cheap one-shot read; result feeds the patch URL below.
    let sendUpdates: SendUpdatesPolicy | undefined;
    let attendeeCount = 0;
    const userVisibleChange =
      patch.start_time !== undefined ||
      patch.end_time !== undefined ||
      patch.title !== undefined ||
      patch.location !== undefined ||
      patch.duration_minutes !== undefined;
    if (userVisibleChange) {
      const peek = await getGoogleEvent(accessToken, connection.primary_calendar_id, linked.google_event_id);
      if (peek.ok && peek.value.attendees && peek.value.attendees.length > 0) {
        attendeeCount = peek.value.attendees.length;
        sendUpdates = "all";
      }
    }

    console.log(
      "[calendar-update-event] patching",
      linked.google_event_id,
      JSON.stringify({ ...googlePatch, description: googlePatch.description ? "<set>" : undefined }),
      sendUpdates ? `sendUpdates=${sendUpdates} (attendees=${attendeeCount})` : "",
    );

    // ── Call Google ──
    const patchResult = await patchGoogleEvent(
      accessToken,
      connection.primary_calendar_id,
      linked.google_event_id,
      googlePatch,
      {
        etag: force ? undefined : linked.etag ?? undefined,
        sendUpdates,
      },
    );

    if (!patchResult.ok) {
      console.error(
        "[calendar-update-event] Google PATCH failed:",
        patchResult.reason,
        patchResult.status,
        patchResult.message,
      );

      // L2 (2026-05-12): branch on classifier. Each reason maps to a
      // distinct sync_status that callers downstream (retry queue,
      // offer-copy, eventual UI surface) use to pick the right next
      // action. Centralizing this here keeps the policy out of the
      // helpers and out of the chat layer.
      switch (patchResult.reason) {
        case "etag_conflict":
          return exit("etag_conflict", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "etag_conflict",
            error: patchResult.message,
          }, {
            etag_conflict: true,
            google_status: patchResult.status,
            error: patchResult.message,
          });

        case "event_not_found": {
          // The Google event we were going to PATCH is gone. The local
          // mirror is now misleading — calendar-update-event would loop
          // forever returning event_not_found if a future invocation
          // saw the same stale link. Drop the link.
          const { error: unlinkErr } = await supabase
            .from("calendar_events")
            .delete()
            .eq("id", linked.id);
          if (unlinkErr) {
            console.warn(
              "[calendar-update-event] unlink stale mirror failed (non-fatal):",
              unlinkErr.message,
            );
          }
          // Success-shaped from the user's perspective: their Olive
          // task moved, the Google event was already gone.
          return exit("already_gone", 200, {
            success: true,
            synced_to_google: false,
            sync_status: "already_gone",
          }, {
            google_status: patchResult.status,
            error: patchResult.message,
          });
        }

        case "auth_expired":
        case "scope_insufficient":
          // Permanent (until user reconnects). shouldRetry must NOT
          // include needs_reconnect — otherwise the retry queue would
          // grind through five 30s/2m/10m/1h/6h retries that all 401
          // identically. The user-facing copy + (Phase 2B) the UI banner
          // are what get the user to act.
          return exit("needs_reconnect", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "needs_reconnect",
            needs_reconnect: true,
            reconnect_reason: patchResult.reason,
            error: patchResult.message,
          }, {
            google_status: patchResult.status,
            error: patchResult.message,
          });

        case "rate_limited":
          // Transient. The exit() helper enqueues a retry; we pass
          // retry_after_ms through so it can honor Google's hint instead
          // of using the default 30s backoff (which would just trip the
          // same limit again).
          return exit("rate_limited", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "rate_limited",
            retry_after_ms: patchResult.retry_after_ms,
            error: patchResult.message,
          }, {
            google_status: patchResult.status,
            error: patchResult.message,
            retry_after_ms: patchResult.retry_after_ms,
          });

        case "google_unavailable":
          // 5xx: transient, exponential backoff. exit() will enqueue.
          return exit("google_unavailable", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "google_unavailable",
            error: patchResult.message,
          }, {
            google_status: patchResult.status,
            error: patchResult.message,
          });

        case "google_api_error":
        default:
          // Unclassified 4xx. Retryable in case it's actually transient
          // (e.g. a race between two of our PATCH attempts); abandons
          // after the backoff schedule if not.
          return exit("google_api_error", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "google_api_error",
            error: patchResult.message,
          }, {
            google_status: patchResult.status,
            error: patchResult.message,
          });
      }
    }

    const googleEvent = patchResult.value;

    // ── Mirror to local calendar_events ──
    const localUpdate: Record<string, unknown> = {
      etag: googleEvent.etag ?? null,
      last_synced_at: new Date().toISOString(),
    };
    if (patch.title !== undefined) localUpdate.title = patch.title;
    if (patch.description !== undefined) localUpdate.description = patch.description;
    if (patch.location !== undefined) localUpdate.location = patch.location;
    if (newStartIso) localUpdate.start_time = newStartIso;
    if (newEndIso) localUpdate.end_time = newEndIso;
    if (newAllDay !== undefined) localUpdate.all_day = newAllDay;
    if (patch.timezone) localUpdate.timezone = patch.timezone;

    const { error: mirrorErr } = await supabase
      .from("calendar_events")
      .update(localUpdate)
      .eq("id", linked.id);

    if (mirrorErr) {
      console.warn("[calendar-update-event] local mirror update failed:", mirrorErr);
    }

    return exit("updated", 200, {
      success: true,
      synced_to_google: true,
      sync_status: "updated",
      // Phase 2.3 — surface attendee state so callers can append
      // "I'll let them know" to the user-facing reply when applicable.
      attendees_notified: sendUpdates === "all",
      attendee_count: attendeeCount,
      event: {
        id: linked.id,
        google_event_id: googleEvent.id,
        start_time: newStartIso ?? linked.start_time,
        end_time: newEndIso ?? linked.end_time,
        html_link: googleEvent.htmlLink,
      },
    });
  } catch (error: unknown) {
    console.error("[calendar-update-event] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return exit("google_api_error", 500, {
      success: false,
      synced_to_google: false,
      sync_status: "google_api_error",
      error: msg,
    }, { error: msg });
  }
});
