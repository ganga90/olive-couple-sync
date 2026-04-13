/**
 * Google Calendar Scheduling Skill
 * =================================
 * Books events on the user's Google Calendar using their OAuth connection.
 *
 * Reuses the exact token refresh pattern from `calendar-create-event/index.ts`:
 * - Looks up user's calendar_connections via Supabase service-role client
 * - Refreshes OAuth token if expiring in < 5 minutes
 * - Creates event via Google Calendar API
 * - Stores event in local calendar_events table
 *
 * Required environment variables:
 * - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for DB access)
 * - GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET (for token refresh)
 *
 * Graceful fallback: If user hasn't connected calendar → clear error message.
 */

import type { IOliveSkill } from "./types.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export const scheduleEventSkill: IOliveSkill = {
  name: "schedule_event",
  description:
    "Books an event or meeting on the user's Google Calendar. Use when the user wants to schedule, book, or add something to their calendar with a specific date and time. Requires a summary/title, start time, and end time in ISO-8601 format.",
  parameters: {
    type: "OBJECT",
    properties: {
      summary: {
        type: "STRING",
        description: "Event title/summary (e.g., 'Dentist appointment', 'Team standup')",
      },
      start_time: {
        type: "STRING",
        description:
          "Event start in ISO-8601 format (e.g., '2025-03-15T14:00:00Z'). Must include date and time.",
      },
      end_time: {
        type: "STRING",
        description:
          "Event end in ISO-8601 format (e.g., '2025-03-15T15:00:00Z'). If unknown, default to 1 hour after start.",
      },
      description: {
        type: "STRING",
        description: "Optional event description or notes",
      },
      location: {
        type: "STRING",
        description: "Optional event location or address",
      },
    },
    required: ["summary", "start_time", "end_time"],
  },

  execute: async (args: Record<string, any>, userId: string): Promise<string> => {
    const { summary, start_time, end_time, description, location } = args;

    // ── Input Validation ──────────────────────────────────────
    if (!summary || typeof summary !== "string" || summary.trim().length === 0) {
      return "Error: Event summary/title is required. What should I name this event?";
    }

    if (!start_time || typeof start_time !== "string") {
      return "Error: Start time is required in ISO-8601 format (e.g., '2025-03-15T14:00:00Z').";
    }

    if (!end_time || typeof end_time !== "string") {
      return "Error: End time is required in ISO-8601 format (e.g., '2025-03-15T15:00:00Z').";
    }

    // Validate date parsing
    const startDate = new Date(start_time);
    const endDate = new Date(end_time);
    if (isNaN(startDate.getTime())) {
      return `Error: Invalid start time format: "${start_time}". Please use ISO-8601 format.`;
    }
    if (isNaN(endDate.getTime())) {
      return `Error: Invalid end time format: "${end_time}". Please use ISO-8601 format.`;
    }
    if (endDate <= startDate) {
      return "Error: End time must be after start time.";
    }

    if (!userId || userId.length === 0) {
      return "Error: User authentication required to access calendar.";
    }

    // ── Environment Variables ─────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const clientId = Deno.env.get("GOOGLE_CALENDAR_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CALENDAR_CLIENT_SECRET");

    if (!supabaseUrl || !supabaseKey) {
      console.error("[schedule_event] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return "Error: Calendar service configuration is incomplete. Please contact support.";
    }

    if (!clientId || !clientSecret) {
      console.error("[schedule_event] Missing GOOGLE_CALENDAR_CLIENT_ID or GOOGLE_CALENDAR_CLIENT_SECRET");
      return "Error: Google Calendar credentials are not configured. Please contact support.";
    }

    try {
      const supabase = createClient(supabaseUrl, supabaseKey);

      // ── Look Up Calendar Connection ───────────────────────
      const { data: connection, error: connError } = await supabase
        .from("calendar_connections")
        .select("*")
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();

      if (connError) {
        console.error("[schedule_event] DB error:", connError);
        return "Error: Could not check calendar connection. Please try again.";
      }

      if (!connection) {
        return "Error: No Google Calendar connected. Please connect your Google Calendar in Olive Settings first, then try again.";
      }

      console.log(`[schedule_event] Found calendar for user ${userId.substring(0, 8)}: ${connection.google_email}`);

      // ── Refresh OAuth Token if Needed (5-min buffer) ──────
      let accessToken = connection.access_token;
      const tokenExpiry = new Date(connection.token_expiry).getTime();

      if (tokenExpiry - Date.now() < 5 * 60 * 1000) {
        console.log("[schedule_event] Refreshing OAuth token...");

        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: connection.refresh_token,
            grant_type: "refresh_token",
          }),
        });

        if (!tokenResponse.ok) {
          const errText = await tokenResponse.text();
          console.error("[schedule_event] Token refresh failed:", errText);

          // Mark connection as inactive
          await supabase
            .from("calendar_connections")
            .update({ is_active: false, error_message: "Token refresh failed" })
            .eq("id", connection.id);

          return "Error: Your Google Calendar connection has expired. Please reconnect in Olive Settings.";
        }

        const newTokens = await tokenResponse.json();
        accessToken = newTokens.access_token;

        // Update stored token
        await supabase
          .from("calendar_connections")
          .update({
            access_token: accessToken,
            token_expiry: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
          })
          .eq("id", connection.id);

        console.log("[schedule_event] OAuth token refreshed successfully");
      }

      // ── Build Google Calendar Event ───────────────────────
      const event: Record<string, any> = {
        summary: summary.trim(),
        start: { dateTime: startDate.toISOString(), timeZone: "UTC" },
        end: { dateTime: endDate.toISOString(), timeZone: "UTC" },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "popup", minutes: 30 },
            { method: "email", minutes: 1440 }, // 24 hours
          ],
        },
      };

      if (description && typeof description === "string" && description.trim().length > 0) {
        event.description = description.trim();
      }

      if (location && typeof location === "string" && location.trim().length > 0) {
        event.location = location.trim();
      }

      console.log(`[schedule_event] Creating: "${summary}" from ${start_time} to ${end_time}`);

      // ── Create Event in Google Calendar ────────────────────
      const createResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(connection.primary_calendar_id)}/events`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(event),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error(`[schedule_event] Google Calendar API error (HTTP ${createResponse.status}):`, errorText);
        if (createResponse.status === 401) {
          return "Error: Calendar authentication failed. Please reconnect your Google Calendar in Olive Settings.";
        }
        return `Error: Failed to create calendar event (HTTP ${createResponse.status}). Please try again.`;
      }

      const googleEvent = await createResponse.json();
      console.log(`[schedule_event] Created Google event: ${googleEvent.id}`);

      // ── Store in Local Database ────────────────────────────
      try {
        await supabase.from("calendar_events").insert({
          connection_id: connection.id,
          google_event_id: googleEvent.id,
          title: summary.trim(),
          description: description || null,
          location: location || null,
          start_time: googleEvent.start.dateTime || googleEvent.start.date,
          end_time: googleEvent.end.dateTime || googleEvent.end.date,
          all_day: false,
          event_type: "manual",
          etag: googleEvent.etag,
        });
      } catch (saveErr) {
        console.warn("[schedule_event] Failed to save event locally (non-fatal):", saveErr);
      }

      // ── Format Success Response ────────────────────────────
      const eventLink = googleEvent.htmlLink || "";
      const formattedStart = startDate.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });
      const formattedEnd = endDate.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      let result = `Successfully created calendar event!\n\n`;
      result += `**${summary}**\n`;
      result += `${formattedStart} — ${formattedEnd}\n`;
      if (location) result += `Location: ${location}\n`;
      if (eventLink) result += `\nCalendar link: ${eventLink}`;

      return result;
    } catch (e: any) {
      console.error("[schedule_event] Unexpected error:", e);
      return `Error: Failed to schedule event: ${e.message || "Unknown error"}. Please try again.`;
    }
  },
};
