// _shared/offer-copy.ts
//
// One-line builders for the user-visible side of every offer/result.
// Lives here (not in the edge functions) so:
//   - Voice rules stay consistent across surfaces (web, WhatsApp, iOS)
//   - Translations land in one place when we wire i18n through
//   - The text the LLM sees ("ACTION PROPOSED: X") matches what the
//     LLM is told to surface, eliminating drift between hint and reply
//
// Today the strings are English-only; the function shape accepts a
// `lang` arg so adding es/it later is a translation-table swap, not a
// refactor. This matches the Olive brand-bible discipline: short,
// direct, no exclamation-point spam.

import type {
  BulkRescheduleOffer,
  DeleteTaskOffer,
  DisambiguationOffer,
  EditTaskOffer,
  RescheduleTaskOffer,
} from "./pending-offer.ts";
import { formatFriendlyDate } from "./whatsapp-messaging.ts";
import type {
  CalendarSyncReport,
  ExecutedAction,
} from "./action-executor-offers.ts";
import type { LastAction } from "./web-session.ts";
import type { ConflictSummary } from "./conflict-detector.ts";
import type { MatchedPattern } from "./pattern-detector.ts";

export type Lang = "en" | "es" | "it";

// ─── Offer prompts (Capture → Offer phase) ─────────────────────────────

export interface OfferCopyContext {
  timezone: string;
  lang?: Lang;
}

export function buildRescheduleOffer(
  offer: RescheduleTaskOffer,
  ctx: OfferCopyContext,
): string {
  const lang = ctx.lang || "en";
  const newWhen = friendly(offer.new_iso, offer.has_time, ctx.timezone, lang);
  const priorIso = offer.prior_reminder_time || offer.prior_due_date;
  const priorWhen = priorIso ? friendly(priorIso, !!offer.prior_reminder_time, ctx.timezone, lang) : null;
  // Phase 3.1 — surface conflicts in the offer line so the user sees
  // them BEFORE confirming. Empty/absent → no clause.
  const conflictClause = buildConflictClause(offer.conflicts, ctx);
  // Phase 3.5 — surface a strong pattern hint. Appended AFTER the
  // conflict clause so the conflict (more urgent signal) reads first
  // and the pattern (softer "by the way") reads second.
  const patternClause = buildPatternHintClause(offer.pattern_hints, ctx);
  if (priorWhen && priorIso !== offer.new_iso) {
    return `🌿 Move *${offer.task_summary}* — ${priorWhen} → **${newWhen}**.${conflictClause}${patternClause} Confirm?`;
  }
  return `🌿 Set *${offer.task_summary}* for **${newWhen}**.${conflictClause}${patternClause} Confirm?`;
}

export function buildDeleteOffer(offer: DeleteTaskOffer): string {
  return `🌿 Delete *${offer.task_summary}*? This will also remove the linked calendar event.`;
}

export function buildEditOffer(offer: EditTaskOffer, ctx?: OfferCopyContext): string {
  const c = offer.changes;
  if (c.new_title !== undefined) {
    return `🌿 Rename *${offer.task_summary}* → *${c.new_title}*. Confirm?`;
  }
  if (c.new_location !== undefined) {
    return `🌿 Update location of *${offer.task_summary}* to *${c.new_location}*. Confirm?`;
  }
  if (c.new_duration_minutes !== undefined) {
    // Phase 3.1 — duration changes shift the event window; surface
    // conflicts on the new window if the planner detected any.
    const conflictClause = ctx ? buildConflictClause(offer.conflicts, ctx) : "";
    return `🌿 Make *${offer.task_summary}* a ${c.new_duration_minutes}-minute event.${conflictClause} Confirm?`;
  }
  if (c.new_description !== undefined) {
    const preview = c.new_description.length > 60
      ? c.new_description.slice(0, 60) + "…"
      : c.new_description;
    return `🌿 Update notes on *${offer.task_summary}* to: "${preview}". Confirm?`;
  }
  return `🌿 Update *${offer.task_summary}*. Confirm?`;
}

// Phase 3.2 — bulk reschedule offer. Lists up to 5 affected tasks
// inline so the user can see what's being moved BEFORE confirming;
// summarizes the rest by count when there are more. Day names
// localized via the same DAY_NAMES table used for pattern hints.
export function buildBulkRescheduleOffer(
  offer: BulkRescheduleOffer,
  ctx: OfferCopyContext,
): string {
  const lang = ctx.lang || "en";
  const n = offer.candidates.length;
  const fromName = bulkDayName(offer.from_dow, lang);
  const toName = bulkDayName(offer.to_dow, lang);
  if (!fromName || !toName) {
    // Defensive — should never happen because the planner validates,
    // but failing closed in copy is cleaner than emitting a broken
    // offer line.
    return `🌿 Move ${n} tasks. Confirm?`;
  }

  const intro =
    lang === "es"
      ? `🌿 Mover ${n} ${n === 1 ? "tarea" : "tareas"} de **${fromName}** a **${toName}**`
      : lang === "it"
      ? `🌿 Sposta ${n} ${n === 1 ? "attività" : "attività"} dal **${fromName}** al **${toName}**`
      : `🌿 Move ${n} ${n === 1 ? "task" : "tasks"} from **${fromName}** to **${toName}**`;

  // Show up to 5 task names; summarize the rest. List uses bullets
  // (rendered as a newline-prefixed list in markdown-friendly
  // contexts) so the offer reads cleanly even on long lists.
  const previewN = Math.min(5, n);
  const previewItems = offer.candidates.slice(0, previewN).map((c) => `• ${c.task_summary}`);
  const tail = n > previewN ? `\n…${lang === "es" ? "y " : lang === "it" ? "e " : "and "}${n - previewN} ${lang === "es" ? "más" : lang === "it" ? "in più" : "more"}` : "";
  const listing = `\n${previewItems.join("\n")}${tail}`;
  const tailConfirm = lang === "es" ? "¿Confirmar?" : lang === "it" ? "Confermare?" : "Confirm?";
  return `${intro}:${listing}\n${tailConfirm}`;
}

// Result hint after bulk execution. Reports what actually happened
// without overselling; mentions calendar state honestly per the
// aggregate signal from the executor.
function buildBulkResultHint(
  r: Extract<import("./action-executor-offers.ts").ExecutedAction, { action: "tasks_bulk_rescheduled" }>,
  ctx: OfferCopyContext,
): string {
  const lang = ctx.lang || "en";
  const toName = bulkDayName(r.to_dow, lang) ?? "";
  let line: string;
  if (r.failed === 0) {
    line =
      lang === "es"
        ? `Movidas ${r.succeeded} ${r.succeeded === 1 ? "tarea" : "tareas"} a ${toName}`
        : lang === "it"
        ? `Spostate ${r.succeeded} ${r.succeeded === 1 ? "attività" : "attività"} a ${toName}`
        : `Moved ${r.succeeded} ${r.succeeded === 1 ? "task" : "tasks"} to ${toName}`;
  } else {
    line =
      lang === "es"
        ? `Movidas ${r.succeeded} de ${r.attempted} (${r.failed} no se pudieron actualizar)`
        : lang === "it"
        ? `Spostate ${r.succeeded} su ${r.attempted} (${r.failed} non sono state aggiornate)`
        : `Moved ${r.succeeded} of ${r.attempted} (${r.failed} couldn't be saved)`;
  }

  // Calendar aggregate suffix — single signal across the whole batch
  // rather than 6 individual lines.
  const calSuffix = buildBulkCalendarSuffix(r.calendar_aggregate, r.succeeded, lang);
  const undoTail =
    r.succeeded > 0
      ? lang === "es"
        ? ' Responde "deshacer" en 5 min para revertir.'
        : lang === "it"
        ? ' Rispondi "annulla" entro 5 min per ripristinare.'
        : ' Reply "undo" within 5 min to revert.'
      : "";
  return `${line}${calSuffix}.${undoTail}`;
}

function buildBulkCalendarSuffix(
  aggregate: Extract<import("./action-executor-offers.ts").ExecutedAction, { action: "tasks_bulk_rescheduled" }>["calendar_aggregate"],
  succeeded: number,
  lang: Lang,
): string {
  // No-op when nothing landed on Google. Empty strings keep the
  // sentence clean.
  if (succeeded === 0) return "";
  switch (aggregate) {
    case "all_synced":
      return lang === "es"
        ? " y sincronizadas con Google Calendar"
        : lang === "it"
        ? " e sincronizzate con Google Calendar"
        : " and synced to your Google Calendar";
    case "partial":
      return lang === "es"
        ? " — algunas no llegaron a Google Calendar, lo seguiré intentando"
        : lang === "it"
        ? " — alcune non sono arrivate a Google Calendar, continuerò a riprovare"
        : " — some didn't reach Google Calendar, I'll keep trying in the background";
    case "none_synced":
      return lang === "es"
        ? " en Olive — pero no llegué a Google Calendar"
        : lang === "it"
        ? " in Olive — ma non sono riuscita a raggiungere Google Calendar"
        : " in Olive — but I couldn't reach Google Calendar";
    case "not_connected":
    case "no_linked_events":
      return "";
  }
}

// Locale-aware day names — separate from offer-copy's `DAY_NAMES`
// because the bulk copy uses **bold** day labels in headers and bare
// names in body text. Keeping a parallel small table avoids
// awkward markdown-stripping at format time.
function bulkDayName(dow: number, lang: Lang): string | null {
  if (dow < 0 || dow > 6) return null;
  const en = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const es = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const it = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  if (lang === "es") return es[dow];
  if (lang === "it") return it[dow];
  return en[dow];
}

// Exported so the executor caller can build the result hint inline.
export { buildBulkResultHint };

export function buildDisambiguationOffer(offer: DisambiguationOffer): string {
  const lines = offer.candidates.map((c, i) => {
    const when = c.reminder_time || c.due_date;
    const suffix = when ? ` (${when.split("T")[0]})` : "";
    return `${i + 1}. ${c.summary}${suffix}`;
  });
  return `🌿 I found a few — which one did you mean?\n${lines.join("\n")}\nReply with a number or the name.`;
}

// ─── Execution result hints (Execute → Confirm phase) ──────────────────
//
// Strings the LLM gets in its confirmation prompt. The LLM is told to
// follow these verbatim instead of inventing — so when the calendar
// sync failed, the chat reply says so instead of claiming success.

export function buildResultHint(
  result: ExecutedAction,
  ctx: OfferCopyContext,
): string {
  // Bulk results don't carry a single calendar_sync — they have an
  // aggregate field instead, handled in the dedicated builder below.
  // For the single-task variants we compute the sync suffix once here.
  if (result.action === "tasks_bulk_rescheduled") {
    return buildBulkResultHint(result, ctx);
  }
  // Read the optional Phase 2 fields off the calendar_sync report —
  // they're added by calendar-update-event / calendar-delete-event but
  // older callers may not populate them, so default safely.
  const cs = result.calendar_sync as CalendarSyncReport & {
    retry_enqueued?: boolean;
    attendees_notified?: boolean;
    attendee_count?: number;
  };
  const sync = buildCalendarSuffix(result.calendar_sync, {
    retryEnqueued: cs.retry_enqueued,
    attendeesNotified: cs.attendees_notified,
    attendeeCount: cs.attendee_count,
  });
  switch (result.action) {
    case "task_rescheduled": {
      const newIso = result.new_reminder_time || result.new_due_date;
      const newWhen = newIso ? friendly(newIso, !!result.new_reminder_time, ctx.timezone, ctx.lang) : "updated";
      const priorIso = result.prior_reminder_time || result.prior_due_date;
      const priorWhen = priorIso ? friendly(priorIso, !!result.prior_reminder_time, ctx.timezone, ctx.lang) : null;
      const diff = priorWhen && priorIso !== newIso
        ? `Moved "${result.task_summary}" from ${priorWhen} to ${newWhen}`
        : `"${result.task_summary}" is set for ${newWhen}`;
      return `${diff}${sync}. Reply "undo" within 5 minutes to revert.`;
    }
    case "task_deleted":
      return `Deleted "${result.task_summary}"${sync}. Reply "undo" within 5 minutes to bring it back.`;
    case "task_edited": {
      const c = result.changes;
      if (c.new_title !== undefined) {
        return `Renamed to "${c.new_title}"${sync}. Reply "undo" within 5 minutes to revert.`;
      }
      if (c.new_location !== undefined) {
        return `Location set to "${c.new_location}"${sync}. Reply "undo" to revert.`;
      }
      if (c.new_duration_minutes !== undefined) {
        return `Duration set to ${c.new_duration_minutes} minutes${sync}. Reply "undo" to revert.`;
      }
      if (c.new_description !== undefined) {
        return `Notes updated${sync}. Reply "undo" to revert.`;
      }
      return `Updated "${result.task_summary}"${sync}.`;
    }
  }
}

// Translate a calendar sync status into the user-facing trailing clause.
// Empty string when nothing's worth saying (not_connected, no_linked).
//
// Phase 2 extensions:
//   - `retryEnqueued`: when a transient failure was queued for retry,
//     soften the failure message — the user's calendar WILL catch up,
//     they just shouldn't expect it instantly.
//   - `attendeesNotified` + `attendeeCount`: when Google's notification
//     was triggered, mention it. Moving a meeting silently on people
//     is the kind of thing the brand voice cares about.
export function buildCalendarSuffix(
  sync: CalendarSyncReport,
  options: { retryEnqueued?: boolean; attendeesNotified?: boolean; attendeeCount?: number } = {},
): string {
  switch (sync.status) {
    case "updated": {
      const base = " and synced to your Google Calendar";
      if (options.attendeesNotified && (options.attendeeCount ?? 0) > 0) {
        const n = options.attendeeCount!;
        const people = n === 1 ? "1 other person" : `${n} other people`;
        return `${base} (notified ${people} on the event)`;
      }
      return base;
    }
    case "deleted": {
      const base = " and removed from your Google Calendar";
      if (options.attendeesNotified && (options.attendeeCount ?? 0) > 0) {
        const n = options.attendeeCount!;
        const people = n === 1 ? "1 other person" : `${n} other people`;
        return `${base} (cancelled for ${people})`;
      }
      return base;
    }
    case "already_gone":
      return "";
    case "not_connected":
    case "no_linked_event":
    case "skipped":
    case "missing_input":
      return "";
    case "etag_conflict":
    case "google_api_error":
    case "token_refresh_failed":
    case "invoke_failed":
      return options.retryEnqueued
        ? " in Olive — Google Calendar didn't respond, I'll keep trying in the background"
        : " in Olive — but I couldn't reach Google Calendar this time";
  }
}

// ─── Undo confirmation ─────────────────────────────────────────────────

export function buildUndoConfirmation(
  result: { kind: LastAction["kind"]; reverted: boolean; detail?: string },
  taskSummary: string,
): string {
  if (!result.reverted) {
    return `Couldn't undo this one${result.detail ? ` — ${result.detail}` : ""}.`;
  }
  switch (result.kind) {
    case "reschedule_task":
      return `Reverted "${taskSummary}" to its prior time.`;
    case "delete_task":
      return `Brought "${taskSummary}" back.`;
    case "edit_task":
      return `Reverted "${taskSummary}".`;
    case "bulk_reschedule_task":
      // taskSummary is a count here (caller passes entries.length).
      // Keeps the function signature stable across kinds without
      // overloading the LastAction shape into the call site.
      return `Reverted the bulk move (${taskSummary} task${taskSummary === "1" ? "" : "s"}).`;
  }
}

// ─── Conflicts (Phase 3.1) ────────────────────────────────────────────

// One-line clause describing calendar conflicts at the proposed time.
// Empty string when there are no conflicts to surface so the offer
// reads cleanly when the schedule is clear.
//
// Voice: factual, brief, uses the brand's "say less" rule. Examples:
//   "" (no conflicts)
//   " Heads up: dinner with Sara at 6:30pm overlaps."
//   " Heads up: 'Off-site planning' is also on Thursday."
//   " Heads up: 2 things on your calendar then — dinner with Sara at 6:30pm and gym at 7:45pm."
//   " Heads up: 4 things on your calendar that day."
export function buildConflictClause(
  conflicts: ConflictSummary[] | undefined,
  ctx: OfferCopyContext,
): string {
  if (!conflicts || conflicts.length === 0) return "";
  const lang = ctx.lang || "en";
  const lead = lang === "es" ? "Aviso" : lang === "it" ? "Attenzione" : "Heads up";

  // 1 conflict — describe it inline.
  if (conflicts.length === 1) {
    return ` ${lead}: ${describeOneConflict(conflicts[0], ctx)}.`;
  }

  // 2-3 conflicts — list them. More than 3 → summarize count to keep
  // the offer readable.
  if (conflicts.length <= 3) {
    const phrases = conflicts.map((c) => describeOneConflict(c, ctx));
    const joined = lang === "es" || lang === "it"
      ? joinList(phrases, lang === "es" ? "y" : "e")
      : joinList(phrases, "and");
    const intro = lang === "es"
      ? `${conflicts.length} cosas en tu calendario`
      : lang === "it"
      ? `${conflicts.length} cose sul tuo calendario`
      : `${conflicts.length} things on your calendar then`;
    return ` ${lead}: ${intro} — ${joined}.`;
  }

  // Many — summarize. Don't try to enumerate; the user can look at
  // their own calendar.
  const summary = lang === "es"
    ? `${conflicts.length} eventos en tu calendario`
    : lang === "it"
    ? `${conflicts.length} eventi sul tuo calendario`
    : `${conflicts.length} events on your calendar around then`;
  return ` ${lead}: ${summary}.`;
}

function describeOneConflict(c: ConflictSummary, ctx: OfferCopyContext): string {
  const title = c.title || "an event";
  if (c.all_day) {
    // For all-day events the time isn't useful; just name it.
    return `"${title}" is also on that day`;
  }
  // Timed event — include the start time so the user knows whether
  // it's an actual overlap or merely close.
  const start = formatFriendlyDate(c.start_time, true, ctx.timezone, ctx.lang || "en");
  // formatFriendlyDate returns the full date+time; pick just the time
  // segment if the user already knows the date from the offer's main
  // line. The friendly formatter doesn't expose a time-only mode, so
  // we use a heuristic: take the substring after the last "at " (en),
  // "alle " (it), or "a las " (es).
  const tOnly = extractTimeFromFriendly(start, ctx.lang || "en") ?? start;
  if (c.severity === "adjacent") {
    return `"${title}" right ${c.overlap_minutes < 0 ? "before" : "after"} that`;
  }
  return `"${title}" at ${tOnly}`;
}

// Best-effort time extractor — formatFriendlyDate produces strings like
// "Thu, May 14 at 6:00 PM" (en), "gio 14 mag alle 18:00" (it),
// "jue 14 may a las 18:00" (es). We strip the date portion so the
// inline conflict reads naturally inside the offer's already-set
// temporal context.
function extractTimeFromFriendly(s: string, lang: Lang): string | null {
  const marker = lang === "es" ? " a las " : lang === "it" ? " alle " : " at ";
  const idx = s.lastIndexOf(marker);
  if (idx < 0) return null;
  return s.slice(idx + marker.length);
}

function joinList(items: string[], conjunction: string): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}

// ─── Pattern hint (Phase 3.5) ────────────────────────────────────────

// Render a strong matched pattern as a soft "by the way" clause. Voice
// is intentionally lighter than conflict copy — patterns are
// informational ("hey, this matches what you usually do"), not urgent.
// Empty string when no pattern hits the surfacing bar.
//
// Today we only support weekday_shift; future pattern_types add a
// branch here. Each language has the same shape: "[connective] you
// often move <from> things to <to>."
export function buildPatternHintClause(
  hints: MatchedPattern[] | undefined,
  ctx: OfferCopyContext,
): string {
  if (!hints || hints.length === 0) return "";
  const lang = ctx.lang || "en";
  // We cap at one hint per offer for copy hygiene (planner already
  // caps the array at 1). Defensive: just take the first.
  const h = hints[0];
  if (h.pattern_type !== "weekday_shift") return "";
  const fromDow = (h.pattern_data as { from_dow?: number }).from_dow;
  const toDow = (h.pattern_data as { to_dow?: number }).to_dow;
  if (fromDow === undefined || toDow === undefined) return "";
  const fromName = dayName(fromDow, lang);
  const toName = dayName(toDow, lang);
  if (!fromName || !toName) return "";
  if (lang === "es") return ` Sueles mover cosas de ${fromName} a ${toName}.`;
  if (lang === "it") return ` Di solito sposti le cose dal ${fromName} al ${toName}.`;
  return ` By the way, you often move ${fromName} things to ${toName}.`;
}

// Days of week per locale, indexed Sun=0..Sat=6 so it matches
// JS Date.getUTCDay() output and our pattern_data fields.
const DAY_NAMES: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  it: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
};

function dayName(dow: number, lang: Lang): string | null {
  const names = DAY_NAMES[lang] ?? DAY_NAMES.en;
  if (dow < 0 || dow > 6) return null;
  return names[dow];
}

// ─── Internal ─────────────────────────────────────────────────────────

function friendly(iso: string, includeTime: boolean, timezone: string, lang: Lang = "en"): string {
  // formatFriendlyDate handles 'en' / 'es' / 'it' already; map our Lang
  // to its language code 1:1.
  return formatFriendlyDate(iso, includeTime, timezone, lang);
}
