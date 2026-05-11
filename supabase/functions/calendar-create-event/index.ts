// calendar-create-event
// ─────────────────────────────────────────────────────────────────────
// Creates a Google Calendar event for the caller and mirrors it into
// `calendar_events`. Migrated to use _shared/google-calendar.ts so the
// OAuth refresh + API contract is consistent with update/delete paths.
// Every exit logs to olive_calendar_sync_log for observability parity.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildEventTiming,
  createGoogleEvent,
  ensureFreshAccessToken,
  getActiveCalendarConnection,
  type GoogleEventPatch,
} from "../_shared/google-calendar.ts";
import {
  logCalendarSync,
  startSyncTimer,
  type CalendarSyncStatus,
} from "../_shared/calendar-sync-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
  let connectionId: string | null = null;
  let googleEventId: string | null = null;
  let invokedFrom: string | null = null;

  async function exit(
    status: CalendarSyncStatus,
    httpStatus: number,
    payload: Record<string, unknown>,
    extra: { google_status?: number; error?: string } = {},
  ): Promise<Response> {
    await logCalendarSync(supabase, {
      user_id: userId,
      action: "create",
      sync_status: status,
      note_id: noteId,
      connection_id: connectionId,
      google_event_id: googleEventId,
      http_status: extra.google_status ?? null,
      latency_ms: stop(),
      invoked_from: invokedFrom,
      error_message: extra.error ?? null,
    });
    return new Response(JSON.stringify(payload), {
      status: httpStatus,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const {
      user_id,
      note_id,
      title,
      description,
      start_time,
      end_time,
      all_day,
      location,
      timezone,
      invoked_from,
    } = await req.json();
    userId = user_id ?? "";
    noteId = note_id ?? null;
    invokedFrom = invoked_from ?? null;

    if (!user_id || !title || !start_time) {
      return exit("missing_input", 400, {
        success: false,
        error: "Missing required fields: user_id, title, start_time",
      }, { error: "missing required fields" });
    }

    const connection = await getActiveCalendarConnection(supabase, user_id);
    if (!connection) {
      return exit("not_connected", 200, { success: false, error: "No calendar connected" });
    }
    connectionId = connection.id;

    const tokenResult = await ensureFreshAccessToken(supabase, connection);
    if (!tokenResult.ok) {
      return exit("token_refresh_failed", 500, {
        success: false,
        error: tokenResult.message || "Token refresh failed",
      }, { error: tokenResult.message });
    }

    const userTimezone = timezone || "UTC";
    const timing = buildEventTiming(start_time, { allDay: all_day, timeZone: userTimezone });

    const event: GoogleEventPatch = {
      summary: title,
      description: description || "",
      start: timing.start,
      end: timing.end,
      reminders: {
        useDefault: false,
        overrides: [
          { method: "popup", minutes: 30 },
          { method: "popup", minutes: 1440 },
        ],
      },
    };
    if (location) event.location = location;

    // Honor explicit end_time override (legacy contract)
    if (end_time) {
      event.end = timing.isAllDay
        ? { date: new Date(end_time).toISOString().split("T")[0] }
        : { dateTime: new Date(end_time).toISOString(), timeZone: userTimezone };
    }

    console.log("[calendar-create-event] Creating event:", title, "tz:", userTimezone);

    const createResult = await createGoogleEvent(
      tokenResult.value,
      connection.primary_calendar_id,
      event,
    );
    if (!createResult.ok) {
      console.error("[calendar-create-event] Failed:", createResult.status, createResult.message);
      return exit("google_api_error", 500, {
        success: false,
        error: "Failed to create calendar event",
      }, { google_status: createResult.status, error: createResult.message });
    }
    const googleEvent = createResult.value;
    googleEventId = googleEvent.id;
    console.log("[calendar-create-event] Created Google event:", googleEvent.id);

    const { data: savedEvent, error: saveError } = await supabase
      .from("calendar_events")
      .insert({
        connection_id: connection.id,
        google_event_id: googleEvent.id,
        title,
        description,
        location,
        start_time: googleEvent.start.dateTime || googleEvent.start.date,
        end_time: googleEvent.end.dateTime || googleEvent.end.date,
        all_day: !googleEvent.start.dateTime,
        event_type: note_id ? "from_note" : "manual",
        note_id,
        etag: googleEvent.etag,
        timezone: userTimezone,
      })
      .select()
      .single();

    if (saveError) {
      console.warn("[calendar-create-event] Failed to save to local DB:", saveError);
    }

    return exit("created", 200, {
      success: true,
      event: {
        id: savedEvent?.id || googleEvent.id,
        google_event_id: googleEvent.id,
        title,
        start_time: googleEvent.start.dateTime || googleEvent.start.date,
        end_time: googleEvent.end.dateTime || googleEvent.end.date,
        html_link: googleEvent.htmlLink,
      },
    });
  } catch (error: unknown) {
    console.error("[calendar-create-event] Error:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return exit("google_api_error", 500, { success: false, error: msg }, { error: msg });
  }
});
