// _shared/whatsapp-calendar-sync.ts
//
// Thin wrappers around calendar-update-event / calendar-delete-event for
// the WhatsApp webhook. The webhook code is dense and the integration
// points (inside the AWAITING_CONFIRMATION dispatch) are deep in nested
// branches; keeping the invocations one-line keeps the patch surgical.
//
// Calendar sync errors NEVER block the DB mutation that already happened
// or the user-facing reply. They flow back as a sync report which the
// caller folds into the reply text (so WhatsApp obeys the same
// honest-reporting contract as the web confirmation copy).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type WhatsAppCalendarSyncStatus =
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

export interface WhatsAppCalendarSyncReport {
  status: WhatsAppCalendarSyncStatus;
  message?: string;
  // Phase 2.1 — set by the calendar edge function when a transient
  // failure was queued for background retry. WhatsApp's user-facing
  // suffix uses this to soften the failure copy.
  retry_enqueued?: boolean;
  retry_id?: string;
  // Phase 2.3 — set when Google's sendUpdates notified attendees.
  attendees_notified?: boolean;
  attendee_count?: number;
}

export async function whatsappCalendarUpdate(
  supabase: SupabaseClient,
  args: {
    user_id: string;
    note_id: string;
    start_time?: string;
    all_day?: boolean;
    timezone: string;
    title?: string;
    location?: string;
    description?: string;
    duration_minutes?: number;
  },
): Promise<WhatsAppCalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke("calendar-update-event", {
      body: {
        user_id: args.user_id,
        note_id: args.note_id,
        invoked_from: "whatsapp-webhook",
        patch: {
          start_time: args.start_time,
          all_day: args.all_day,
          timezone: args.timezone,
          title: args.title,
          location: args.location,
          description: args.description,
          duration_minutes: args.duration_minutes,
        },
      },
    });
    if (error) return { status: "invoke_failed", message: error.message };
    return {
      status: (data?.sync_status as WhatsAppCalendarSyncStatus) || "invoke_failed",
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

export async function whatsappCalendarDelete(
  supabase: SupabaseClient,
  args: { user_id: string; note_id: string },
): Promise<WhatsAppCalendarSyncReport> {
  try {
    const { data, error } = await supabase.functions.invoke("calendar-delete-event", {
      body: {
        user_id: args.user_id,
        note_id: args.note_id,
        invoked_from: "whatsapp-webhook",
      },
    });
    if (error) return { status: "invoke_failed", message: error.message };
    return {
      status: (data?.sync_status as WhatsAppCalendarSyncStatus) || "invoke_failed",
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

// ─── Localized suffix for the reply ──────────────────────────────────
//
// WhatsApp's voice already uses emojis and t()-templated strings. We
// match that house style here. Empty string when nothing's worth
// volunteering (not_connected, no_linked_event) so the user doesn't see
// confusing "but Google Calendar..." messages when they don't even have
// a calendar connection.
//
// Phase 2 extensions:
//   - When the failure was queued for retry, soften the failure copy.
//   - When attendees got notified, mention them.

export function buildWhatsAppCalendarSuffix(
  sync: WhatsAppCalendarSyncReport,
  lang: string,
): string {
  const shortLang = (lang || "en").split("-")[0];
  switch (sync.status) {
    case "updated": {
      const base = shortLang === "es"
        ? " 📅 También sincronizado con Google Calendar."
        : shortLang === "it"
        ? " 📅 Sincronizzato anche con Google Calendar."
        : " 📅 Synced to your Google Calendar.";
      if (sync.attendees_notified && (sync.attendee_count ?? 0) > 0) {
        return base + " " + attendeesNotifiedClause(sync.attendee_count!, shortLang, "moved");
      }
      return base;
    }
    case "deleted": {
      const base = shortLang === "es"
        ? " 📅 También eliminado de Google Calendar."
        : shortLang === "it"
        ? " 📅 Rimosso anche da Google Calendar."
        : " 📅 Also removed from your Google Calendar.";
      if (sync.attendees_notified && (sync.attendee_count ?? 0) > 0) {
        return base + " " + attendeesNotifiedClause(sync.attendee_count!, shortLang, "cancelled");
      }
      return base;
    }
    case "already_gone":
    case "not_connected":
    case "no_linked_event":
    case "missing_input":
    case "skipped":
      return "";
    case "etag_conflict":
    case "google_api_error":
    case "token_refresh_failed":
    case "invoke_failed":
      if (sync.retry_enqueued) {
        return shortLang === "es"
          ? " ⚠️ Google Calendar no respondió — seguiré intentándolo en segundo plano."
          : shortLang === "it"
          ? " ⚠️ Google Calendar non ha risposto — continuerò a riprovare in background."
          : " ⚠️ Google Calendar didn't respond — I'll keep trying in the background.";
      }
      return shortLang === "es"
        ? " ⚠️ Pero no pude sincronizar con Google Calendar esta vez."
        : shortLang === "it"
        ? " ⚠️ Ma non sono riuscita a sincronizzare con Google Calendar stavolta."
        : " ⚠️ But I couldn't reach Google Calendar this time.";
  }
}

// "I let the X people on the event know" — short, factual, no emoji
// (we already used 📅 for the sync line; piling another emoji here
// breaks the brand voice's "no emoji spam" rule).
function attendeesNotifiedClause(
  count: number,
  shortLang: string,
  verb: "moved" | "cancelled",
): string {
  if (shortLang === "es") {
    const people = count === 1 ? "la otra persona" : `las ${count} personas`;
    const action = verb === "cancelled" ? "la cancelación" : "el cambio";
    return `Avisé a ${people} del evento sobre ${action}.`;
  }
  if (shortLang === "it") {
    const people = count === 1 ? "l'altra persona" : `le ${count} persone`;
    const action = verb === "cancelled" ? "l'annullamento" : "lo spostamento";
    return `Ho avvisato ${people} sull'evento de ${action}.`;
  }
  const people = count === 1 ? "the other person" : `the ${count} other people`;
  const action = verb === "cancelled" ? "cancelled" : "moved";
  return `I let ${people} on the event know it was ${action}.`;
}
