/**
 * Time-of-day extractor for time-only `set_due` updates.
 * =======================================================
 *
 * Parses time-of-day phrases that come up in follow-up corrections
 * like "fai alle 8" or "change it to 7 AM" — small fragments where
 * the user didn't restate the date, just the new time.
 *
 * Pre-PR4 the inlined regex required AM/PM, which broke 24h-native
 * locales (it/es). The user's "fai alle 8" returned no match → the
 * webhook responded with `date_unparseable` and the correction was
 * silently lost. This module is the correct, locale-aware replacement.
 *
 * Recognized forms:
 *   en: "7 AM" / "7:30 PM" / "at 7" / "at 7:30 am"
 *   it: "alle 8" / "alle 14:30" / "all'8" (24h native; AM/PM unused)
 *   es: "a las 8" / "a la 1" / "a las 14:30" (24h native)
 *   bare 24h: "8:30" / "14:00"
 */

export interface TimeOnly {
  hours: number;   // 0–23
  minutes: number; // 0–59
}

/**
 * Try to extract a time-of-day from a free-form expression.
 *
 * Returns `null` if no recognizable time pattern is found, leaving the
 * caller free to fall back to e.g. parseNaturalDate or AI extraction.
 */
export function extractTimeOnly(expr: string): TimeOnly | null {
  if (!expr || typeof expr !== "string") return null;

  // 1) Explicit AM/PM. Highest priority because it disambiguates 1–12.
  const ampm = expr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/i);
  if (ampm) {
    let h = parseInt(ampm[1]);
    const m = ampm[2] ? parseInt(ampm[2]) : 0;
    if (ampm[3].toLowerCase() === "pm" && h < 12) h += 12;
    if (ampm[3].toLowerCase() === "am" && h === 12) h = 0;
    if (isValid(h, m)) return { hours: h, minutes: m };
  }

  // 2) Keyword-anchored time. Accepts both 24h ("alle 14") and any
  //    optional trailing AM/PM ("at 7:30 am"). Anchoring on the keyword
  //    prevents false positives where the digit is a count, not a time
  //    (e.g., "in 2 months" — no "at"/"alle"/"a las" before the 2).
  //
  //    Note: `all'8` with the apostrophe-elision form is allowed via
  //    the `all['']` character class. `\s*` (not `\s+`) lets us match
  //    that (no space between "all'" and the digit).
  const kw = expr.match(/\b(?:at|alle|all['’]|a\s+las|a\s+la)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s*(am|pm))?/i);
  if (kw) {
    let h = parseInt(kw[1]);
    const m = kw[2] ? parseInt(kw[2]) : 0;
    if (kw[3]) {
      if (kw[3].toLowerCase() === "pm" && h < 12) h += 12;
      if (kw[3].toLowerCase() === "am" && h === 12) h = 0;
    } else if (h === 24) {
      // 24:00 → 00:00 next day; collapse to 0 here.
      h = 0;
    }
    if (isValid(h, m)) return { hours: h, minutes: m };
  }

  // 3) Bare HH:MM (24h, no anchoring). Lower priority because it
  //    matches any HH:MM pattern in the string — but if someone wrote
  //    just "8:30" alone, that's clearly a time.
  const hhmm = expr.match(/\b(\d{1,2}):(\d{2})\b/);
  if (hhmm) {
    let h = parseInt(hhmm[1]);
    const m = parseInt(hhmm[2]);
    if (h === 24) h = 0;
    if (isValid(h, m)) return { hours: h, minutes: m };
  }

  return null;
}

function isValid(h: number, m: number): boolean {
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}
