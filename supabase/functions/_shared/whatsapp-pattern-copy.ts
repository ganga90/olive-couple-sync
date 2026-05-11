// _shared/whatsapp-pattern-copy.ts
//
// Phase 3.5 WhatsApp port — pattern hint suffix for offer confirmation
// replies. Mirrors offer-copy.ts's buildPatternHintClause but uses
// WhatsApp's voice (lighter weight, no markdown, en/es/it via inline
// branches matching the rest of the webhook).

import type { MatchedPattern } from "./pattern-detector.ts";

const DAY_NAMES_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_NAMES_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAY_NAMES_IT = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

export function buildWhatsAppPatternSuffix(
  hints: MatchedPattern[] | undefined,
  lang: string,
): string {
  if (!hints || hints.length === 0) return "";
  const h = hints[0];
  if (h.pattern_type !== "weekday_shift") return "";
  const fromDow = (h.pattern_data as { from_dow?: number }).from_dow;
  const toDow = (h.pattern_data as { to_dow?: number }).to_dow;
  if (fromDow === undefined || toDow === undefined) return "";
  if (fromDow < 0 || fromDow > 6 || toDow < 0 || toDow > 6) return "";

  const shortLang = (lang || "en").split("-")[0];
  if (shortLang === "es") {
    return ` 💡 Sueles mover cosas de ${DAY_NAMES_ES[fromDow]} a ${DAY_NAMES_ES[toDow]}.`;
  }
  if (shortLang === "it") {
    return ` 💡 Di solito sposti le cose dal ${DAY_NAMES_IT[fromDow]} al ${DAY_NAMES_IT[toDow]}.`;
  }
  return ` 💡 By the way, you often move ${DAY_NAMES_EN[fromDow]} things to ${DAY_NAMES_EN[toDow]}.`;
}
