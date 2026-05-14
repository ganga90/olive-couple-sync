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
 * If `pending` is a set_due_date proposal and `message` is a refinement
 * of that same proposal (a new date/time tweak), return the updated
 * pending action with the new date. Otherwise return null and let the
 * normal cancel-and-process flow take over.
 *
 * Two gates so we don't accidentally re-target on unrelated chatter:
 *   (a) the message parses to a concrete date via parseNaturalDate
 *   (b) it carries a refinement signal — pronoun, correction verb,
 *       "due/for/to/at/on", or is a short (≤30 char) date-shaped
 *       message (EN + ES + IT covered).
 */
export function detectSetDueRefinement(
  pending: unknown,
  message: string | null | undefined,
  timezone: string,
  lang: string,
): RefinedSetDue | null {
  if (!message) return null;
  const p = pending as PendingSetDueAction | null;
  if (!p || p.type !== "set_due_date") return null;

  const parsed = parseNaturalDate(message, timezone, lang);
  if (!parsed.date) return null;

  // A refinement is one of three shapes — all tight, anchored to the
  // *start* of the message so we don't catch stray dates inside long
  // narratives ("I was thinking maybe Monday could work for that…"):
  //
  //   (a) starts with a correction verb (no/set/move/change/make/...)
  //   (b) starts with a pronoun referring to the pending task
  //   (c) the whole message is a short date-shaped phrase (≤30 chars)
  const trimmed = message.trim();
  const startsWithCorrectionVerb =
    /^(no|nope|nah|actually|wait|hmm|set|move|change|make|push|postpone|reschedule|update|put|reschedul|cambia|sposta|metti|sposto|posponer|mueve|cambiar|aspetta|impost|pon)\b/i
      .test(trimmed);
  const startsWithPronoun =
    /^(it|that|this|lo|eso|quello|esa|questa|quella)\b/i.test(trimmed);
  const isShort = trimmed.length <= 30;

  if (!startsWithCorrectionVerb && !startsWithPronoun && !isShort) return null;

  return {
    updated: {
      ...p,
      date: parsed.date,
      readable: parsed.readable,
      timezone: p.timezone || timezone,
    },
    parsedReadable: parsed.readable,
    parsedDateIso: parsed.date,
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
