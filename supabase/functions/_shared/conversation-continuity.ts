/**
 * Conversation Continuity Helpers
 * ================================
 * Small, pure predicates used by whatsapp-webhook (and any other surface
 * that wants to feel continuous) to detect:
 *
 *   1. Pending-proposal refinements — when the user, instead of replying
 *      "yes/no" to an AWAITING_CONFIRMATION proposal, sends a tweak
 *      ("Set it due for Friday at 5pm"). We update the proposal instead
 *      of cancelling it.
 *
 *   2. Misrouted partner relays — when the classifier returns
 *      PARTNER_MESSAGE but the verb-target is not the user's actual
 *      partner (e.g., "Text Jacopo Amazon" while the partner is Almu).
 *      That's a brain-dump, not a relay.
 *
 * These live outside whatsapp-webhook/index.ts so they can be unit-tested
 * in isolation and reused by ask-olive-individual / future group surfaces
 * without duplicating regex logic.
 */

import { parseNaturalDate } from "./natural-date-parser.ts";

// ─── Refinement of an AWAITING_CONFIRMATION set_due_date proposal ────

export interface PendingSetDueAction {
  type: "set_due_date";
  task_id: string;
  task_summary: string;
  date: string;
  readable: string;
  timezone?: string;
  prior_due_date?: string | null;
  prior_reminder_time?: string | null;
}

export interface RefinedSetDue {
  updated: PendingSetDueAction;
  parsedReadable: string;
  parsedDateIso: string;
}

/**
 * Generic predicate — does the message look like a refinement of a
 * pending reschedule-style proposal? Returns the parsed new date when
 * yes, null otherwise. Pulled out from `detectSetDueRefinement` so the
 * web-chat surface can reuse the *exact same* gates against its own
 * pending-offer shape (`RescheduleTaskOffer` vs WhatsApp's
 * `PendingSetDueAction`). Two gates so we don't re-target on unrelated
 * chatter:
 *   (a) the message parses to a concrete date via parseNaturalDate
 *   (b) it carries a refinement signal — correction verb / pronoun at
 *       the start, OR the whole message is a short (≤30 char) date-
 *       shaped phrase (EN + ES + IT).
 */
export interface ParsedRefinement {
  parsedReadable: string;
  parsedDateIso: string;
}

export function detectDateRefinement(
  message: string | null | undefined,
  timezone: string,
  lang: string,
): ParsedRefinement | null {
  if (!message) return null;
  const parsed = parseNaturalDate(message, timezone, lang);
  if (!parsed.date) return null;

  const trimmed = message.trim();
  const startsWithCorrectionVerb =
    /^(no|nope|nah|actually|wait|hmm|set|move|change|make|push|postpone|reschedule|update|put|reschedul|cambia|sposta|metti|sposto|posponer|mueve|cambiar|aspetta|impost|pon)\b/i
      .test(trimmed);
  const startsWithPronoun =
    /^(it|that|this|lo|eso|quello|esa|questa|quella)\b/i.test(trimmed);
  const isShort = trimmed.length <= 30;

  if (!startsWithCorrectionVerb && !startsWithPronoun && !isShort) return null;

  return { parsedReadable: parsed.readable, parsedDateIso: parsed.date };
}

/**
 * If `pending` is a set_due_date proposal and `message` is a refinement
 * of that same proposal (a new date/time tweak), return the updated
 * pending action with the new date. Otherwise return null and let the
 * normal cancel-and-process flow take over. WhatsApp-shape adapter
 * around the generic `detectDateRefinement` predicate.
 */
export function detectSetDueRefinement(
  pending: unknown,
  message: string | null | undefined,
  timezone: string,
  lang: string,
): RefinedSetDue | null {
  const p = pending as PendingSetDueAction | null;
  if (!p || p.type !== "set_due_date") return null;

  const refined = detectDateRefinement(message, timezone, lang);
  if (!refined) return null;

  return {
    updated: {
      ...p,
      date: refined.parsedDateIso,
      readable: refined.parsedReadable,
      timezone: p.timezone || timezone,
    },
    parsedReadable: refined.parsedReadable,
    parsedDateIso: refined.parsedDateIso,
  };
}

/**
 * Web-chat adapter — same predicate, applied to a `reschedule_task`
 * PendingOffer (shape from `_shared/pending-offer.ts`). Returns the
 * updated offer with `new_iso` and `readable` replaced, plus a flag
 * indicating the parsed date carried a time component (so callers can
 * keep / flip `has_time` correctly when offers store date-only). The
 * input type is `unknown` so callers can pass `session.context_data.
 * pending_action` without narrowing first.
 */
export interface RefinedReschedule {
  // Shape-loose return — caller's RescheduleTaskOffer fields, but we
  // keep it as a plain Record so this module doesn't have to import
  // the pending-offer types and create a circular dep.
  updated: Record<string, unknown> & {
    type: "reschedule_task";
    new_iso: string;
    readable: string;
    timezone: string;
  };
  parsedReadable: string;
  parsedDateIso: string;
}

export function detectRescheduleRefinement(
  pending: unknown,
  message: string | null | undefined,
  timezone: string,
  lang: string,
): RefinedReschedule | null {
  const p = pending as ({ type?: string; timezone?: string } & Record<string, unknown>) | null;
  if (!p || p.type !== "reschedule_task") return null;

  const refined = detectDateRefinement(message, timezone, lang);
  if (!refined) return null;

  return {
    updated: {
      ...p,
      type: "reschedule_task",
      new_iso: refined.parsedDateIso,
      readable: refined.parsedReadable,
      timezone: (p.timezone as string | undefined) || timezone,
    },
    parsedReadable: refined.parsedReadable,
    parsedDateIso: refined.parsedDateIso,
  };
}

// ─── Misrouted partner relay detection ────────────────────────────

/**
 * Detect that a PARTNER_MESSAGE classification should be downgraded to
 * CREATE because the relay verb's target is not the user's partner.
 *
 * Returns the misrouted target name (for logging) when a downgrade
 * should happen, or null when the message is either not a relay shape
 * at all, or correctly targets the partner / a generic partner-ref.
 *
 * Examples:
 *   detectMisroutedPartnerRelay("Text Jacopo Amazon", "Almu", null)
 *     → "Jacopo"   (downgrade to CREATE)
 *   detectMisroutedPartnerRelay("Tell Almu to buy milk", "Almu", null)
 *     → null       (correct partner — keep as PARTNER_MESSAGE)
 *   detectMisroutedPartnerRelay("Remind my partner about dinner", "Almu", null)
 *     → null       (generic partner reference — keep)
 *   detectMisroutedPartnerRelay("Just bought lunch $10", "Almu", null)
 *     → null       (not a relay shape — caller doesn't touch it)
 */
export function detectMisroutedPartnerRelay(
  message: string,
  partnerName: string | null | undefined,
  selfName: string | null | undefined,
): string | null {
  if (!message) return null;
  // Allow optional dative/preposition between verb and name so Spanish
  // ("dile a Marco") and Italian ("ricorda a Marco") + EN's occasional
  // "tell to Marco" all extract the actual target rather than the prep.
  const relayMatch = message.match(
    /^\s*(text|tell|remind|ask|message|send|let|notify|dile|recuérdale|recuérda|recuérdame|recuerda|recordale|ricorda|dì|di|chiedi|manda|invia)\s+(?:a\s+|al\s+|to\s+|para\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][\w'\-]*)\b/i,
  );
  if (!relayMatch) return null;
  const targetWord = relayMatch[2];

  // Generic partner-references that bypass the check (multilingual).
  // Includes possessive determiners ("my", "mi") and the singular
  // articles that precede partner-nouns in ES/IT ("la pareja", "il
  // marito"). Followed downstream by "partner/husband/wife/spouse/
  // pareja/marido/esposa/marito/moglie".
  if (/^(my|the|your|mi|mio|mia|il|la|el|tu|su)$/i.test(targetWord)) {
    return null;
  }

  const partnerFirst = (partnerName || "").split(/\s+/)[0];
  const selfFirst = (selfName || "").split(/\s+/)[0];

  const matchesPartner = !!partnerFirst &&
    targetWord.toLowerCase() === partnerFirst.toLowerCase();
  const matchesSelf = !!selfFirst &&
    targetWord.toLowerCase() === selfFirst.toLowerCase();

  if (matchesPartner || matchesSelf) return null;
  return targetWord;
}
