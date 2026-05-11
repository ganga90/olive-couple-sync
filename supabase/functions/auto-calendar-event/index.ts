// auto-calendar-event
// ─────────────────────────────────────────────────────────────────────
// Fires from process-note when a freshly captured note has due_date or
// reminder_time and the user has auto_add_to_calendar enabled. Migrated
// to use _shared/google-calendar.ts so the OAuth refresh + Google API
// contract stays in lockstep with create/update/delete endpoints.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildEventTiming,
  createGoogleEvent,
  ensureFreshAccessToken,
  getActiveCalendarConnection,
  type GoogleEventPatch,
} from "../_shared/google-calendar.ts";
import { logCalendarSync, startSyncTimer } from "../_shared/calendar-sync-logger.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, notes } = await req.json();

    if (!user_id || !notes || !Array.isArray(notes)) {
      return json({ success: false, error: "Missing user_id or notes array" }, 400);
    }

    const calendarWorthy = notes.filter((n: any) => n.due_date || n.reminder_time);
    if (calendarWorthy.length === 0) {
      return json({ success: true, created: 0, message: "No calendar-worthy notes" });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const connection = await getActiveCalendarConnection(supabase, user_id);
    if (!connection || !connection.auto_add_to_calendar) {
      return json({ success: true, created: 0, message: "Auto-add disabled or no connection" });
    }

    let userTimezone = "UTC";
    try {
      const { data: profile } = await supabase
        .from("clerk_profiles")
        .select("timezone")
        .eq("id", user_id)
        .single();
      userTimezone = profile?.timezone || "UTC";
    } catch {
      /* keep UTC */
    }

    console.log(
      "[auto-calendar-event] Creating",
      calendarWorthy.length,
      "events for user",
      user_id,
      "tz:",
      userTimezone,
    );

    const tokenResult = await ensureFreshAccessToken(supabase, connection);
    if (!tokenResult.ok) {
      console.error("[auto-calendar-event] token refresh failed:", tokenResult.message);
      return json({ success: false, error: tokenResult.message || "Token refresh failed" }, 500);
    }
    const accessToken = tokenResult.value;

    let createdCount = 0;
    let skippedCount = 0;

    for (const note of calendarWorthy) {
      const noteTimer = startSyncTimer();
      try {
        // Prefer reminder_time (full timestamp) over due_date (date only).
        // The previous heuristic — `hours===12 → all-day` — false-positived
        // any legitimate noon meeting. We now infer from the input shape:
        // a string of length <= 10 means date-only, anything else is timed.
        const startTime: string = note.reminder_time || note.due_date;
        const isAllDay = typeof startTime === "string" && startTime.length <= 10;

        if (note.id) {
          const { data: existing } = await supabase
            .from("calendar_events")
            .select("id")
            .eq("connection_id", connection.id)
            .eq("note_id", note.id)
            .limit(1);

          if (existing && existing.length > 0) {
            console.log("[auto-calendar-event] ⏭️ Skipped (already exists):", note.summary);
            skippedCount++;
            // No log row: duplicate-skip isn't a sync event, just a no-op.
            // Counting it here would inflate the analytics table.
            continue;
          }
        }

        const timing = buildEventTiming(startTime, {
          allDay: isAllDay,
          timeZone: userTimezone,
        });

        const event: GoogleEventPatch = {
          summary: note.summary || "Olive reminder",
          description: note.original_text || "",
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

        const createResult = await createGoogleEvent(
          accessToken,
          connection.primary_calendar_id,
          event,
        );
        if (!createResult.ok) {
          console.error("[auto-calendar-event] Failed:", createResult.status, createResult.message);
          await logCalendarSync(supabase, {
            user_id,
            action: "create",
            sync_status: "google_api_error",
            note_id: note.id ?? null,
            connection_id: connection.id,
            http_status: createResult.status ?? null,
            latency_ms: noteTimer(),
            invoked_from: "auto-calendar-event",
            error_message: createResult.message,
          });
          continue;
        }
        const googleEvent = createResult.value;
        console.log("[auto-calendar-event] ✅ Created:", googleEvent.id, "-", note.summary);
        createdCount++;
        await logCalendarSync(supabase, {
          user_id,
          action: "create",
          sync_status: "created",
          note_id: note.id ?? null,
          connection_id: connection.id,
          google_event_id: googleEvent.id,
          latency_ms: noteTimer(),
          invoked_from: "auto-calendar-event",
        });

        await supabase.from("calendar_events").insert({
          connection_id: connection.id,
          google_event_id: googleEvent.id,
          title: note.summary || "Olive reminder",
          description: note.original_text || "",
          start_time: googleEvent.start.dateTime || googleEvent.start.date,
          end_time: googleEvent.end.dateTime || googleEvent.end.date,
          all_day: !googleEvent.start.dateTime,
          event_type: "from_note",
          note_id: note.id || null,
          etag: googleEvent.etag,
          timezone: userTimezone,
        });
      } catch (err) {
        console.error("[auto-calendar-event] Error for:", note.summary, err);
      }
    }

    return json({ success: true, created: createdCount, skipped: skippedCount });
  } catch (error: unknown) {
    console.error("[auto-calendar-event] Error:", error);
    return json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
