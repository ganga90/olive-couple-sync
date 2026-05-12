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

// Mirrors CalendarSyncStatus from _shared/calendar-sync-logger.ts.
// Kept local to this module because WhatsApp's surface predates the
// shared enum; keeping a copy lets us add WhatsApp-only values
// (`skipped`) without bloating the shared module. PR 2B parity:
// needs_reconnect / rate_limited / google_unavailable / enqueue_failed
// added so the WhatsApp suffix can speak about them the same way the
// web suffix does in offer-copy.ts.
export type WhatsAppCalendarSyncStatus =
  | "updated"
  | "deleted"
  | "already_gone"
  | "not_connected"
  | "no_linked_event"
  | "etag_conflict"
  | "needs_reconnect"
  | "rate_limited"
  | "google_unavailable"
  | "enqueue_failed"
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
  // PR 2B parity with offer-copy.ts CalendarSyncReport.
  enqueue_failed?: boolean;
  enqueue_failure_reason?: string;
  retry_after_ms?: number;
  needs_reconnect?: boolean;
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
      // PR 2B parity — surface the new payload fields so the suffix
      // builder can render the differentiated copy.
      enqueue_failed: data?.enqueue_failed,
      enqueue_failure_reason: data?.enqueue_failure_reason,
      retry_after_ms: data?.retry_after_ms,
      needs_reconnect: data?.needs_reconnect,
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
      enqueue_failed: data?.enqueue_failed,
      enqueue_failure_reason: data?.enqueue_failure_reason,
      retry_after_ms: data?.retry_after_ms,
      needs_reconnect: data?.needs_reconnect,
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
    case "needs_reconnect":
      // PR 2B: 401/403 → user must reconnect. Don't soften into "I'll
      // keep trying" — we won't, because we can't.
      return shortLang === "es"
        ? " ⚠️ Tu Google Calendar necesita reconexión (Ajustes → Calendario)."
        : shortLang === "it"
        ? " ⚠️ Il tuo Google Calendar va riconnesso (Impostazioni → Calendario)."
        : " ⚠️ Your Google Calendar needs reconnecting (Settings → Calendar).";

    case "rate_limited": {
      // PR 2B: if Google's Retry-After hint is in the readable window
      // (10s–10min), quote the seconds. Otherwise fall back to the
      // generic retry copy — quoting "30 minutes" is more anxiety-
      // inducing than helpful, and "3 seconds" is silly.
      const ms = sync.retry_after_ms ?? 0;
      if (ms >= 10_000 && ms <= 600_000) {
        const sec = Math.round(ms / 1000);
        return shortLang === "es"
          ? ` ⚠️ Google está limitando peticiones — me pondré al día en ~${sec}s.`
          : shortLang === "it"
          ? ` ⚠️ Google sta limitando le richieste — recupero in ~${sec}s.`
          : ` ⚠️ Google's rate-limiting — I'll catch up in about ${sec}s.`;
      }
      if (sync.retry_enqueued) {
        return shortLang === "es"
          ? " ⚠️ Google está limitando peticiones — seguiré intentándolo en segundo plano."
          : shortLang === "it"
          ? " ⚠️ Google sta limitando le richieste — continuerò a riprovare in background."
          : " ⚠️ Google's rate-limiting — I'll keep trying in the background.";
      }
      if (sync.enqueue_failed) {
        return shortLang === "es"
          ? " ⚠️ Google está limitando peticiones y no pude programar un reintento — lo intentaré la próxima vez."
          : shortLang === "it"
          ? " ⚠️ Google sta limitando le richieste e non sono riuscita a programmare un nuovo tentativo — riproverò la prossima volta."
          : " ⚠️ Google's rate-limiting and I couldn't queue a retry — I'll try again next time you ask.";
      }
      return shortLang === "es"
        ? " ⚠️ Google está limitando peticiones."
        : shortLang === "it"
        ? " ⚠️ Google sta limitando le richieste."
        : " ⚠️ Google's rate-limiting.";
    }

    case "google_unavailable":
      // PR 2B: 5xx — Google's having a moment. Same shape as the
      // generic retry copy but explicit about the source.
      if (sync.retry_enqueued) {
        return shortLang === "es"
          ? " ⚠️ Google está teniendo problemas — seguiré intentándolo en segundo plano."
          : shortLang === "it"
          ? " ⚠️ Google sta avendo un momento difficile — continuerò a riprovare in background."
          : " ⚠️ Google's having a moment — I'll keep trying in the background.";
      }
      if (sync.enqueue_failed) {
        return shortLang === "es"
          ? " ⚠️ Google está teniendo problemas y no pude programar un reintento — lo intentaré la próxima vez."
          : shortLang === "it"
          ? " ⚠️ Google sta avendo un momento difficile e non sono riuscita a programmare un nuovo tentativo — riproverò la prossima volta."
          : " ⚠️ Google's having a moment and I couldn't queue a retry — I'll try again next time you ask.";
      }
      return shortLang === "es"
        ? " ⚠️ Google está teniendo problemas."
        : shortLang === "it"
        ? " ⚠️ Google sta avendo un momento difficile."
        : " ⚠️ Google's having a moment.";

    case "enqueue_failed":
      // PR 2B: shouldn't appear as the primary status (the original
      // Google reason is what we surface), but defend the branch.
      return shortLang === "es"
        ? " ⚠️ No pude programar la sincronización con Google — lo intentaré la próxima vez."
        : shortLang === "it"
        ? " ⚠️ Non sono riuscita a programmare la sincronizzazione con Google — riproverò la prossima volta."
        : " ⚠️ Couldn't queue the Google sync — I'll try again next time you ask.";

    case "etag_conflict":
      // Existing behavior — preserved verbatim to keep WhatsApp parity
      // with PR 2's offer-copy.ts which also kept etag_conflict as the
      // legacy "didn't respond/keep trying" message.
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

    case "google_api_error":
    case "token_refresh_failed":
    case "invoke_failed":
      // PR 2B: retired the dead-end "couldn't reach" copy, mirroring
      // the L4 change in offer-copy.ts. Now three states:
      //   1. retryEnqueued: "I'll keep trying"
      //   2. enqueueFailed: be honest, promise "next time"
      //   3. neither: shouldRetry was false → "next time" anyway
      if (sync.retry_enqueued) {
        return shortLang === "es"
          ? " ⚠️ Google Calendar no respondió — seguiré intentándolo en segundo plano."
          : shortLang === "it"
          ? " ⚠️ Google Calendar non ha risposto — continuerò a riprovare in background."
          : " ⚠️ Google Calendar didn't respond — I'll keep trying in the background.";
      }
      if (sync.enqueue_failed) {
        return shortLang === "es"
          ? " ⚠️ Google no respondió y no pude programar un reintento — lo intentaré la próxima vez."
          : shortLang === "it"
          ? " ⚠️ Google non ha risposto e non sono riuscita a programmare un nuovo tentativo — riproverò la prossima volta."
          : " ⚠️ Google didn't respond and I couldn't queue a retry — I'll try again next time you ask.";
      }
      return shortLang === "es"
        ? " ⚠️ Google no respondió — lo intentaré la próxima vez."
        : shortLang === "it"
        ? " ⚠️ Google non ha risposto — riproverò la prossima volta."
        : " ⚠️ Google didn't respond — I'll try again next time you ask.";
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
