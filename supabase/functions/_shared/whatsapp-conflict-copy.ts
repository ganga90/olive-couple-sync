// _shared/whatsapp-conflict-copy.ts
//
// Phase 3.1 WhatsApp port — localized suffix for conflict warnings.
//
// Reuses the same ConflictSummary shape produced by conflict-detector.ts,
// but emits WhatsApp-house-style copy: emoji-aware, en/es/it via inline
// branches (matching the rest of WhatsApp's t()-templated voice).
//
// The web side uses offer-copy.ts; that module is markdown-leaning and
// uses the **bold** syntax. WhatsApp can't render markdown in messages,
// so we keep this separate and simpler.

import type { ConflictSummary } from "./conflict-detector.ts";
import { formatFriendlyDate } from "./whatsapp-messaging.ts";

export function buildWhatsAppConflictSuffix(
  conflicts: ConflictSummary[] | undefined,
  lang: string,
  timezone: string,
): string {
  if (!conflicts || conflicts.length === 0) return "";
  const shortLang = (lang || "en").split("-")[0];
  const lead = shortLang === "es" ? "Aviso" : shortLang === "it" ? "Attenzione" : "Heads up";

  if (conflicts.length === 1) {
    const c = conflicts[0];
    return ` ⚠️ ${lead}: ${describeOne(c, shortLang, timezone)}.`;
  }

  if (conflicts.length <= 3) {
    const phrases = conflicts.map((c) => describeOne(c, shortLang, timezone));
    const joined = joinList(phrases, shortLang);
    const intro =
      shortLang === "es"
        ? `${conflicts.length} cosas en tu calendario`
        : shortLang === "it"
        ? `${conflicts.length} cose sul tuo calendario`
        : `${conflicts.length} things on your calendar then`;
    return ` ⚠️ ${lead}: ${intro} — ${joined}.`;
  }

  const summary =
    shortLang === "es"
      ? `${conflicts.length} eventos en tu calendario alrededor de ese momento`
      : shortLang === "it"
      ? `${conflicts.length} eventi sul tuo calendario intorno a quell'ora`
      : `${conflicts.length} events on your calendar around then`;
  return ` ⚠️ ${lead}: ${summary}.`;
}

// Internal — describe a single conflict in a way that fits inline.
function describeOne(c: ConflictSummary, shortLang: string, timezone: string): string {
  const title = c.title || "an event";
  if (c.all_day) {
    if (shortLang === "es") return `"${title}" también es ese día`;
    if (shortLang === "it") return `"${title}" è anche quel giorno`;
    return `"${title}" is also on that day`;
  }
  if (c.severity === "adjacent") {
    const isAfter = c.overlap_minutes >= 0;
    if (shortLang === "es") return `"${title}" justo ${isAfter ? "después" : "antes"}`;
    if (shortLang === "it") return `"${title}" subito ${isAfter ? "dopo" : "prima"}`;
    return `"${title}" right ${isAfter ? "after" : "before"} that`;
  }
  // Timed overlap — include the time so the user can sense the impact.
  const friendly = formatFriendlyDate(c.start_time, true, timezone, shortLang);
  const tOnly = extractTime(friendly, shortLang) ?? friendly;
  if (shortLang === "es") return `"${title}" a las ${tOnly}`;
  if (shortLang === "it") return `"${title}" alle ${tOnly}`;
  return `"${title}" at ${tOnly}`;
}

function extractTime(friendly: string, shortLang: string): string | null {
  const marker = shortLang === "es" ? " a las " : shortLang === "it" ? " alle " : " at ";
  const idx = friendly.lastIndexOf(marker);
  if (idx < 0) return null;
  return friendly.slice(idx + marker.length);
}

function joinList(items: string[], shortLang: string): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  const conjunction = shortLang === "es" ? "y" : shortLang === "it" ? "e" : "and";
  if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, ${conjunction} ${items[items.length - 1]}`;
}
