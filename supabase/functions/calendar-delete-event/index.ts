// calendar-delete-event
// ─────────────────────────────────────────────────────────────────────
// Removes a Google Calendar event for the caller and drops the local
// `calendar_events` mirror. Created so that deleting a task in Ask Olive
// also removes the calendar reminder — previously the FK was nulled on
// note delete and the user was left with a ghost event on Google.
//
// Idempotent: 404 from Google is treated as a successful terminal state
// (the event is already gone). Local mirror is removed regardless.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  deleteGoogleEvent,
  ensureFreshAccessToken,
  findLinkedEventByNoteId,
  getActiveCalendarConnection,
  getGoogleEvent,
  markConnectionHealthy,
  markConnectionUnhealthy,
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

interface DeleteRequest {
  user_id: string;
  note_id?: string;
  google_event_id?: string;
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

  let userId = "";
  let noteId: string | null = null;
  let googleEventId: string | null = null;
  let connectionId: string | null = null;
  let invokedFrom: string | null = null;
  let originalBody: Record<string, unknown> | null = null;

  async function exit(
    status: CalendarSyncStatus,
    httpStatus: number,
    payload: Record<string, unknown>,
    extra: {
      google_status?: number;
      error?: string;
      // L2 (2026-05-12): Google's Retry-After in ms; threaded into the
      // retry queue when set.
      retry_after_ms?: number;
    } = {},
  ): Promise<Response> {
    await logCalendarSync(supabase, {
      user_id: userId,
      action: "delete",
      sync_status: status,
      note_id: noteId,
      connection_id: connectionId,
      google_event_id: googleEventId,
      http_status: extra.google_status ?? null,
      latency_ms: stop(),
      invoked_from: invokedFrom,
      error_message: extra.error ?? null,
    });

    // Phase 2.1 + L3 (2026-05-12): enqueue retry on transient failures.
    // See identical logic in calendar-update-event for the rationale on
    // each guard and the enqueue_failed escape hatch.
    if (
      shouldRetry(status) &&
      invokedFrom !== "calendar-sync-retry" &&
      userId &&
      originalBody
    ) {
      const enq = await enqueueRetry(supabase, {
        user_id: userId,
        note_id: noteId,
        action: "delete",
        payload: { ...originalBody, invoked_from: undefined },
        initial_failure_status: status,
        initial_http_status: extra.google_status ?? null,
        initial_error: extra.error ?? null,
        retry_after_ms: extra.retry_after_ms,
      });
      if (enq.enqueued) {
        (payload as Record<string, unknown>).retry_enqueued = true;
        (payload as Record<string, unknown>).retry_id = enq.id;
      } else {
        // L3: surface the dead-end state instead of letting the chat
        // reply pretend a retry is queued.
        (payload as Record<string, unknown>).retry_enqueued = false;
        (payload as Record<string, unknown>).enqueue_failed = true;
        (payload as Record<string, unknown>).enqueue_failure_reason = enq.reason ?? "unknown";
        await logCalendarSync(supabase, {
          user_id: userId,
          action: "delete",
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
    const body = (await req.json()) as DeleteRequest;
    originalBody = body as unknown as Record<string, unknown>;
    const { user_id, note_id, google_event_id, invoked_from } = body;
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
      });
    }

    const connection = await getActiveCalendarConnection(supabase, user_id);
    if (!connection) {
      return exit("not_connected", 200, {
        success: true,
        synced_to_google: false,
        sync_status: "not_connected",
      });
    }
    connectionId = connection.id;

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

    const tokenResult = await ensureFreshAccessToken(supabase, connection);
    if (!tokenResult.ok) {
      console.error("[calendar-delete-event] token refresh failed:", tokenResult.message);
      return exit("token_refresh_failed", 200, {
        success: false,
        synced_to_google: false,
        sync_status: "token_refresh_failed",
        error: tokenResult.message,
      }, { error: tokenResult.message });
    }

    // Phase 2.3 — pre-check attendees so cancellations notify the people
    // on the meeting. Cancelling a meeting silently is the worst case
    // of "moved without telling" — always surface to attendees if
    // there are any.
    let sendUpdates: SendUpdatesPolicy | undefined;
    let attendeeCount = 0;
    const peek = await getGoogleEvent(
      tokenResult.value,
      connection.primary_calendar_id,
      linked.google_event_id,
    );
    if (peek.ok && peek.value.attendees && peek.value.attendees.length > 0) {
      attendeeCount = peek.value.attendees.length;
      sendUpdates = "all";
    }

    const deleteResult = await deleteGoogleEvent(
      tokenResult.value,
      connection.primary_calendar_id,
      linked.google_event_id,
      { sendUpdates },
    );

    if (!deleteResult.ok) {
      console.error(
        "[calendar-delete-event] Google DELETE failed:",
        deleteResult.reason,
        deleteResult.status,
        deleteResult.message,
      );

      // L2 (2026-05-12): branch on classifier — same logic as
      // calendar-update-event. Note that event_not_found CANNOT happen
      // here: deleteGoogleEvent maps 404/410 to ok+alreadyGone=true and
      // never returns a reason of "event_not_found". So we only handle
      // auth_expired / scope_insufficient / rate_limited /
      // google_unavailable / catch-all.
      switch (deleteResult.reason) {
        case "auth_expired":
        case "scope_insufficient":
          // PR 2B: persist health state on the connection row. Same
          // rationale as the equivalent branch in calendar-update-event.
          await markConnectionUnhealthy(
            supabase,
            connection.id,
            deleteResult.reason,
            deleteResult.message,
          );
          return exit("needs_reconnect", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "needs_reconnect",
            needs_reconnect: true,
            reconnect_reason: deleteResult.reason,
            error: deleteResult.message,
          }, {
            google_status: deleteResult.status,
            error: deleteResult.message,
          });

        case "rate_limited":
          return exit("rate_limited", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "rate_limited",
            retry_after_ms: deleteResult.retry_after_ms,
            error: deleteResult.message,
          }, {
            google_status: deleteResult.status,
            error: deleteResult.message,
            retry_after_ms: deleteResult.retry_after_ms,
          });

        case "google_unavailable":
          return exit("google_unavailable", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "google_unavailable",
            error: deleteResult.message,
          }, {
            google_status: deleteResult.status,
            error: deleteResult.message,
          });

        case "google_api_error":
        default:
          return exit("google_api_error", 200, {
            success: false,
            synced_to_google: false,
            sync_status: "google_api_error",
            error: deleteResult.message,
          }, {
            google_status: deleteResult.status,
            error: deleteResult.message,
          });
      }
    }

    const { error: mirrorErr } = await supabase
      .from("calendar_events")
      .delete()
      .eq("id", linked.id);

    if (mirrorErr) {
      console.warn("[calendar-delete-event] local mirror delete failed:", mirrorErr);
    }

    // PR 2B: clear any stale health flag on the connection. We got
    // through the auth + the API call, so this connection is
    // demonstrably good. No-op when already healthy.
    await markConnectionHealthy(supabase, connection.id);

    const status: CalendarSyncStatus = deleteResult.value.alreadyGone ? "already_gone" : "deleted";
    return exit(status, 200, {
      success: true,
      synced_to_google: true,
      sync_status: status,
      attendees_notified: sendUpdates === "all" && !deleteResult.value.alreadyGone,
      attendee_count: attendeeCount,
    });
  } catch (error: unknown) {
    console.error("[calendar-delete-event] Unhandled error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return exit("google_api_error", 500, {
      success: false,
      synced_to_google: false,
      sync_status: "google_api_error",
      error: msg,
    }, { error: msg });
  }
});
