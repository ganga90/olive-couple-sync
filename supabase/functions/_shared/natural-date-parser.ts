/**
 * Natural Date Parser — Multilingual Date/Time Extraction
 * =========================================================
 * Parses natural language date/time expressions in English, Spanish, and Italian.
 * Handles relative times ("in 30 minutes"), named dates ("tomorrow", "next Monday"),
 * month+day ("March 15"), standalone times ("at 3pm"), and timezone-aware conversion.
 *
 * Extracted from whatsapp-webhook to enable reuse across:
 *   - WhatsApp webhook (reminder/due date parsing)
 *   - process-note (due date extraction)
 *   - ask-olive-stream (calendar context)
 *
 * Usage:
 *   import { parseNaturalDate } from "../_shared/natural-date-parser.ts";
 *   // English (default): readable = "tomorrow at 3:00 PM"
 *   const { date, time, readable } = parseNaturalDate("tomorrow at 3pm", "America/New_York");
 *   // Italian: readable = "domani alle 15:00"
 *   parseNaturalDate("domani alle 15", "Europe/Rome", "it");
 *   // Spanish: readable = "mañana a las 15:00"
 *   parseNaturalDate("mañana a las 15", "Europe/Madrid", "es");
 */

import { type SupportedLocale, normalizeLocale } from "./i18n-locale.ts";
import { getTimeZoneParts, toUtcFromLocalParts } from "./timezone-calendar.ts";

export interface ParsedDate {
  date: string | null;
  time: string | null;
  readable: string;
}

// ─── Locale-Aware "readable" Phrase Tables ─────────────────────────
// Every assignment to `readable` below routes through one of these
// helpers. The English entries are constructed to produce strings that
// are BYTE-IDENTICAL to the pre-i18n output (every existing caller that
// doesn't pass a `lang` argument keeps producing the same string).
//
// For es/it the phrases use the locale's natural conventions (lowercase
// day/month, 24h time). The day/month names are looked up by index
// (Sunday=0..Saturday=6, January=0..December=11) so the parser doesn't
// have to round-trip through user-supplied spellings.

const DAY_NAMES_BY_LOCALE: Record<SupportedLocale, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  it: ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"],
};

const MONTH_NAMES_BY_LOCALE: Record<SupportedLocale, string[]> = {
  en: ["January", "February", "March", "April", "May", "June",
       "July", "August", "September", "October", "November", "December"],
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
       "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  it: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
       "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
};

interface ReadablePhrases {
  today: string;
  tomorrow: string;
  dayAfterTomorrow: string;
  nextWeek: string;
  inAWeek: string;
  thisWeekend: string;
  nextMonth: string;
  in30Min: string;
  inMinutes: (n: number) => string;
  inHours: (n: number) => string;
  inDays: (n: number) => string;
  /**
   * "in N months" plus optional "and a half" / "e mezzo" / "y medio" suffix.
   * Note word order differs by locale:
   *   en: "in 2 and a half months"  (half BEFORE units)
   *   it: "tra 2 mesi e mezzo"      (half AFTER units)
   *   es: "en 2 meses y medio"      (half AFTER units)
   */
  inMonths: (n: number, isHalf: boolean) => string;
  /** "in N years" / "tra N anni" / "en N años". */
  inYears: (n: number) => string;
  /**
   * en: returns "Month DD" using the English month name supplied.
   * es/it: ignores englishMonth and uses the localized month at index.
   * Both representations are passed so the en path stays byte-identical
   * regardless of the user's input language.
   */
  monthDay: (englishMonth: string, monthIdx: number, day: number) => string;
  /**
   * en: returns "next ${matchedCapitalized}" using the user's spelling
   *     capitalized — preserves the historical behavior exactly.
   * es/it: ignores the matched form and uses canonical localized name
   *     so output is uniform (e.g., "lunedì prossimo" not "next Lunedì").
   */
  nextDayOfWeek: (matchedCapitalized: string, dayIdx: number) => string;
  atTime: (hours: number, minutes: number) => string;
  at9default: string;
  unknown: string;
}

const READABLE_PHRASES_BY_LOCALE: Record<SupportedLocale, ReadablePhrases> = {
  en: {
    today: "today",
    tomorrow: "tomorrow",
    dayAfterTomorrow: "day after tomorrow",
    nextWeek: "next week",
    inAWeek: "in a week",
    thisWeekend: "this weekend",
    nextMonth: "next month",
    in30Min: "in 30 minutes",
    inMinutes: (n) => `in ${n} minutes`,
    inHours: (n) => `in ${n} hour${n > 1 ? "s" : ""}`,
    inDays: (n) => `in ${n} day${n > 1 ? "s" : ""}`,
    inMonths: (n, isHalf) => {
      // "in 2 and a half months" / "in 1 month" / "in 2 months"
      const half = isHalf ? " and a half" : "";
      const plural = n > 1 || isHalf ? "s" : "";
      return `in ${n}${half} month${plural}`;
    },
    inYears: (n) => `in ${n} year${n > 1 ? "s" : ""}`,
    monthDay: (m, _idx, d) => `${m} ${d}`,
    nextDayOfWeek: (matched, _idx) => `next ${matched}`,
    atTime: (h, m) => {
      // Exact pre-i18n template: 12-hour clock, AM/PM suffix, midnight = 12 AM.
      const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      return `at ${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
    },
    at9default: "at 9:00 AM",
    unknown: "unknown",
  },
  it: {
    today: "oggi",
    tomorrow: "domani",
    dayAfterTomorrow: "dopodomani",
    nextWeek: "la prossima settimana",
    inAWeek: "tra una settimana",
    thisWeekend: "questo weekend",
    nextMonth: "il prossimo mese",
    in30Min: "tra 30 minuti",
    inMinutes: (n) => `tra ${n} minuti`,
    inHours: (n) => `tra ${n} ${n === 1 ? "ora" : "ore"}`,
    inDays: (n) => `tra ${n} ${n === 1 ? "giorno" : "giorni"}`,
    inMonths: (n, isHalf) => {
      // Italian word order: "tra 2 mesi e mezzo" (half AFTER units).
      const unit = n === 1 ? "mese" : "mesi";
      const half = isHalf ? " e mezzo" : "";
      return `tra ${n} ${unit}${half}`;
    },
    inYears: (n) => `tra ${n} ${n === 1 ? "anno" : "anni"}`,
    monthDay: (_m, idx, d) => `${d} ${MONTH_NAMES_BY_LOCALE.it[idx]}`,
    nextDayOfWeek: (_match, idx) => `${DAY_NAMES_BY_LOCALE.it[idx]} prossimo`,
    atTime: (h, m) =>
      `alle ${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
    at9default: "alle 09:00",
    unknown: "data non riconosciuta",
  },
  es: {
    today: "hoy",
    tomorrow: "mañana",
    dayAfterTomorrow: "pasado mañana",
    nextWeek: "la próxima semana",
    inAWeek: "en una semana",
    thisWeekend: "este fin de semana",
    nextMonth: "el próximo mes",
    in30Min: "en 30 minutos",
    inMinutes: (n) => `en ${n} minutos`,
    inHours: (n) => `en ${n} ${n === 1 ? "hora" : "horas"}`,
    inDays: (n) => `en ${n} ${n === 1 ? "día" : "días"}`,
    inMonths: (n, isHalf) => {
      // Spanish word order: "en 2 meses y medio" (half AFTER units).
      const unit = n === 1 ? "mes" : "meses";
      const half = isHalf ? " y medio" : "";
      return `en ${n} ${unit}${half}`;
    },
    inYears: (n) => `en ${n} ${n === 1 ? "año" : "años"}`,
    monthDay: (_m, idx, d) => `${d} de ${MONTH_NAMES_BY_LOCALE.es[idx]}`,
    nextDayOfWeek: (_match, idx) => `el próximo ${DAY_NAMES_BY_LOCALE.es[idx]}`,
    atTime: (h, m) => `a las ${h}:${m.toString().padStart(2, "0")}`,
    at9default: "a las 9:00",
    unknown: "fecha no reconocida",
  },
};

export function parseNaturalDate(
  expression: string,
  timezone: string = "America/New_York",
  lang?: string | SupportedLocale
): ParsedDate {
  const locale: SupportedLocale = lang ? normalizeLocale(lang) : "en";
  const phrases = READABLE_PHRASES_BY_LOCALE[locale];
  const now = new Date();

  // PR5 — Construct `localNow` as a Date whose UTC fields ARE the user's
  // local clock parts, regardless of the JS engine's local timezone.
  //
  // Pre-PR5 this used `now.toLocaleString(..., timezone)` + `new Date(localStr)`,
  // which only produced the right UTC fields when the engine ran in UTC.
  // On Supabase Edge (UTC) it worked; on developer machines (e.g., EDT)
  // the UTC fields were off by the engine's offset. The end-of-function
  // offset block compensated through self-cancelling math, but mutations
  // along the way (`setDate`, `setHours`, `setMonth`) operated on engine-
  // local fields rather than UTC, causing subtle drift especially around
  // DST boundaries.
  //
  // Using `getTimeZoneParts` + `Date.UTC` makes the contract explicit:
  // localNow.getUTCxx() returns the user-local clock parts on every
  // engine. From here on the function uses `setUTCxx` / `getUTCxx`
  // consistently, and the final `toUtcFromLocalParts` call delivers a
  // DST-correct UTC instant.
  let localNow: Date;
  try {
    const parts = getTimeZoneParts(now, timezone);
    localNow = new Date(Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ));
  } catch {
    // Bad timezone — fall back to UTC-now. Resulting parser output may
    // be off but won't crash.
    localNow = new Date(now);
  }

  const lowerExpr = expression.toLowerCase().trim();
  const formatDate = (d: Date): string => d.toISOString();

  // Word-to-number map for natural language ("in one hour", "in two minutes")
  const wordToNum: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
    twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
    "forty-five": 45, "forty five": 45, sixty: 60, ninety: 90,
    // Spanish
    un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
    seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15,
    veinte: 20, treinta: 30, media: 0.5,
    // Italian
    "un'": 1, mezza: 0.5, "mezz'ora": 0.5, due: 2, tre_it: 3, quattro: 4,
    cinque_it: 5, sei_it: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
    quindici: 15, venti: 20, trenta: 30,
  };

  function resolveNumber(token: string): number | null {
    const n = parseInt(token);
    if (!isNaN(n)) return n;
    return wordToNum[token.toLowerCase()] ?? null;
  }

  const monthNames: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2,
    april: 3, apr: 3, may: 4, june: 5, jun: 5, july: 6, jul: 6,
    august: 7, aug: 7, september: 8, sep: 8, sept: 8,
    october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11,
    // Spanish
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    // Italian. PR6: Italian "dicembre" (different spelling from Spanish
    // "diciembre" — no 'i' between 'd' and 'c') was previously missing
    // from this map AND from `abbrMonthMap` below. Result: Italian users
    // typing "dicembre 15" or "15 dicembre" got `unknown` even though
    // every other Italian month worked.
    gennaio: 0, febbraio: 1, aprile: 3, maggio: 4, giugno: 5,
    luglio: 6, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
  };

  const getNextDayOfWeek = (dayName: string): Date => {
    const dayMap: Record<string, number> = {
      sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2,
      wednesday: 3, wed: 3, thursday: 4, thu: 4, friday: 5, fri: 5,
      saturday: 6, sat: 6,
      // Spanish
      domingo: 0, lunes: 1, martes: 2, "miércoles": 3, miercoles: 3,
      jueves: 4, viernes: 5, "sábado": 6, sabado: 6,
      // Italian
      domenica: 0, "lunedì": 1, lunedi: 1, "martedì": 2, martedi: 2,
      "mercoledì": 3, mercoledi: 3, "giovedì": 4, giovedi: 4,
      "venerdì": 5, venerdi: 5,
    };
    const targetDay = dayMap[dayName.toLowerCase()] ?? -1;
    if (targetDay === -1) return localNow;

    // PR5 — operate on UTC fields so the parser is server-timezone
    // independent. Pre-PR5 this used `setDate`/`setHours` which are
    // local-time on the JS engine; correct only on UTC servers
    // (Supabase Edge runs UTC, so production was fine, but tests run
    // on developers' local machines and produced subtly wrong results
    // that the offset block compensated for in fragile ways).
    const result = new Date(localNow);
    const currentDay = result.getUTCDay();
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setUTCDate(result.getUTCDate() + daysToAdd);
    result.setUTCHours(9, 0, 0, 0);
    return result;
  };

  let hours: number | null = null;
  let minutes: number = 0;

  // Parse explicit time (e.g., "3pm", "10:30 AM", "15:00")
  const timeMatch = lowerExpr.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if (timeMatch) {
    const potentialHour = parseInt(timeMatch[1]);
    const meridiem = timeMatch[3]?.toLowerCase();

    if (meridiem || potentialHour <= 12) {
      hours = potentialHour;
      minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      if (meridiem === "pm" && hours < 12) hours += 12;
      if (meridiem === "am" && hours === 12) hours = 0;
    }
  }

  // Named time-of-day keywords (multilingual)
  if (lowerExpr.includes("morning") || lowerExpr.includes("mañana") || lowerExpr.includes("mattina")) {
    hours = hours ?? 9;
  } else if (/\bnoon\b/.test(lowerExpr) || /\bmidday\b/.test(lowerExpr) || /\bmezzogiorno\b/.test(lowerExpr) || /\bmediodía\b/.test(lowerExpr) || /\bmediodia\b/.test(lowerExpr)) {
    hours = hours ?? 12; minutes = 0;
  } else if (lowerExpr.includes("afternoon") || lowerExpr.includes("pomeriggio") || lowerExpr.includes("tarde")) {
    hours = hours ?? 14;
  } else if (lowerExpr.includes("evening") || lowerExpr.includes("sera") || lowerExpr.includes("noche")) {
    hours = hours ?? 18;
  } else if (lowerExpr.includes("night") || lowerExpr.includes("notte")) {
    hours = hours ?? 20;
  } else if (lowerExpr.includes("midnight") || lowerExpr.includes("mezzanotte") || lowerExpr.includes("medianoche")) {
    hours = hours ?? 0; minutes = 0;
  }

  let targetDate: Date | null = null;
  let readable = "";
  // Set true when readable already encodes "in N minutes/hours" — this
  // suppresses the trailing "at HH:MM" append (which would be confusing
  // for relative-minute/hour expressions). Replaces the previous regex
  // probe `readable.includes("minute"|"hour")` which only worked in en.
  let isRelativeTimeExpr = false;

  // Detects whether the user actually specified a time-of-day. Used by
  // date-relative branches (days/months/years/Mon-DD) to decide whether
  // to keep `hours` (extracted by the greedy timeMatch above) or reset
  // it to null so APPLY TIME falls through to the 09:00 default.
  //
  // Without this check, "in 2 months" wrongly renders as "in 2 months at
  // 2:00 AM" because timeMatch grabbed the "2" from "2 months" and
  // treated it as the hour-of-day. The user intended a count, not a time.
  const hasExplicitTimeOfDay =
    /\d\s*(?:am|pm)\b/i.test(lowerExpr) ||
    /\b(?:at|alle|all['']|a\s+las|a\s+la)\s+\d/i.test(lowerExpr) ||
    /\b(?:morning|mattina|noon|midday|mezzogiorno|mediodía|mediodia|afternoon|pomeriggio|tarde|evening|sera|noche|night|notte|midnight|mezzanotte|medianoche)\b/i.test(lowerExpr);

  // === RELATIVE TIME EXPRESSIONS (highest priority) ===
  // Prefix `\b(?:in|tra|fra|en)\b` accepts:
  //   en: "in 30 minutes" / "in 2 hours" / "in 3 days"
  //   it: "tra 30 minuti" / "fra 2 ore" / "tra 3 giorni"
  //   es: "en 30 minutos" / "en 2 horas" / "en 3 días"
  // Word boundaries (`\b`) prevent false positives like "begin 30 minutes",
  // "ten 30 minutes" (suffix-of-word), or "lengthen 30 minutes".
  const relativePatterns = [
    /\b(?:in|tra|fra|en)\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:min(?:ute)?s?|minuto?s?|minut[io])/i,
    /\b(?:in|tra|fra|en)\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:hours?|hrs?|or[ae]s?|or[ae])/i,
    /\b(?:in|tra|fra|en)\s+([\w'-]+(?:\s+[\w'-]+)?)\s*(?:days?|días?|dias?|giorn[io])/i,
    /(?:half\s+(?:an?\s+)?hour|mezz'?ora|media\s+hora)/i,
  ];

  const halfHourMatch = lowerExpr.match(relativePatterns[3]);
  if (halfHourMatch) {
    targetDate = new Date(now);
    targetDate.setMinutes(targetDate.getMinutes() + 30);
    readable = phrases.in30Min;
    isRelativeTimeExpr = true;
    hours = targetDate.getHours();
    minutes = targetDate.getMinutes();
  }

  if (!targetDate) {
    const minMatch = lowerExpr.match(relativePatterns[0]);
    if (minMatch) {
      const num = resolveNumber(minMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        targetDate.setMinutes(targetDate.getMinutes() + Math.round(num));
        readable = phrases.inMinutes(Math.round(num));
        isRelativeTimeExpr = true;
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const hrMatch = lowerExpr.match(relativePatterns[1]);
    if (hrMatch) {
      const num = resolveNumber(hrMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(now);
        if (num === 0.5) {
          targetDate.setMinutes(targetDate.getMinutes() + 30);
          readable = phrases.in30Min;
        } else {
          targetDate.setHours(targetDate.getHours() + Math.round(num));
          readable = phrases.inHours(Math.round(num));
        }
        isRelativeTimeExpr = true;
        hours = targetDate.getHours();
        minutes = targetDate.getMinutes();
      }
    }
  }

  if (!targetDate) {
    const dayMatch = lowerExpr.match(relativePatterns[2]);
    if (dayMatch) {
      const num = resolveNumber(dayMatch[1].trim());
      if (num !== null) {
        // PR5 — operate on UTC fields so the parser is server-tz independent.
        // For "in N days" we anchor on the user's local TODAY (localNow,
        // whose UTC fields encode user-local Y/M/D), then advance N
        // calendar days in those same UTC fields. The eventual
        // toUtcFromLocalParts call resolves the proper instant for the
        // user's timezone — DST-safe.
        targetDate = new Date(localNow);
        targetDate.setUTCDate(targetDate.getUTCDate() + Math.round(num));
        readable = phrases.inDays(Math.round(num));
        // The count digit ("3" in "in 3 days") was greedily captured as
        // hours by timeMatch above. Reset unless the user actually said
        // a time so APPLY TIME defaults to 09:00.
        if (!hasExplicitTimeOfDay) { hours = null; minutes = 0; }
      }
    }
  }

  // === RELATIVE MONTHS ===
  // Patterns the regex matches across all three locales:
  //   en: "in 2 months", "in 2 and a half months", "in 1 month"
  //   it: "tra 2 mesi", "tra 2 mesi e mezzo", "fra un mese"
  //   es: "en 2 meses", "en 2 meses y medio", "en un mes"
  //
  // Word order for the half marker varies by locale — English puts it
  // BEFORE the unit ("in 2 and a half months"), it/es put it AFTER
  // ("tra 2 mesi e mezzo" / "en 2 meses y medio"). The regex accepts
  // both orders via two optional groups around the unit word; the
  // halfFlag is then determined by a separate scan of lowerExpr.
  if (!targetDate) {
    const monthsMatch = lowerExpr.match(
      /\b(?:in|tra|fra|en)\s+([\w'-]+)(?:\s+(?:and\s+a\s+half|e\s+mezzo|y\s+medio))?\s+(?:months?|mes(?:e|es|i)?)(?:\s+(?:and\s+a\s+half|e\s+mezzo|y\s+medio))?\b/i,
    );
    if (monthsMatch) {
      const num = resolveNumber(monthsMatch[1].trim());
      if (num !== null) {
        const isHalf = /\b(?:and\s+a\s+half|e\s+mezzo|y\s+medio)\b/i.test(lowerExpr);
        targetDate = new Date(localNow);
        targetDate.setUTCMonth(targetDate.getUTCMonth() + Math.round(num));
        if (isHalf) {
          // Add 15 days as a calendar approximation of "half a month".
          // Using setDate (not setMonth + 0.5) preserves day-of-month
          // anchoring across short months (Feb/Apr/etc.).
          targetDate.setUTCDate(targetDate.getUTCDate() + 15);
        }
        readable = phrases.inMonths(Math.round(num), isHalf);
        // Same trap as days/years — count digit isn't a time-of-day.
        if (!hasExplicitTimeOfDay) { hours = null; minutes = 0; }
      }
    }
  }

  // === RELATIVE YEARS ===
  //   en: "in 1 year", "in 2 years"
  //   it: "tra un anno", "tra 2 anni", "fra 5 anni"
  //   es: "en un año", "en 2 años"
  if (!targetDate) {
    const yearsMatch = lowerExpr.match(
      /\b(?:in|tra|fra|en)\s+([\w'-]+)\s+(?:years?|ann(?:o|i)|años?|anos?)\b/i,
    );
    if (yearsMatch) {
      const num = resolveNumber(yearsMatch[1].trim());
      if (num !== null) {
        targetDate = new Date(localNow);
        targetDate.setUTCFullYear(targetDate.getUTCFullYear() + Math.round(num));
        readable = phrases.inYears(Math.round(num));
        if (!hasExplicitTimeOfDay) { hours = null; minutes = 0; }
      }
    }
  }

  // === NAMED DATE EXPRESSIONS ===
  if (!targetDate) {
    if (lowerExpr.includes("today") || lowerExpr.includes("hoy") || lowerExpr.includes("oggi")) {
      targetDate = new Date(localNow);
      readable = phrases.today;
    } else if (lowerExpr.includes("day after tomorrow") || lowerExpr.includes("pasado mañana") || lowerExpr.includes("dopodomani")) {
      // Must be checked BEFORE the "tomorrow" branch — every "day after
      // tomorrow" phrase contains "tomorrow"/"domani"/"mañana" as a
      // substring, so without this ordering the broader phrase shadows
      // the more specific one and the user gets a date 1 day off.
      targetDate = new Date(localNow);
      targetDate.setUTCDate(targetDate.getUTCDate() + 2);
      readable = phrases.dayAfterTomorrow;
    } else if (lowerExpr.includes("tomorrow") || /\bmañana\b/.test(lowerExpr) || lowerExpr.includes("domani")) {
      targetDate = new Date(localNow);
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
      readable = phrases.tomorrow;
    } else if (lowerExpr.includes("next week") || lowerExpr.includes("próxima semana") || lowerExpr.includes("prossima settimana") || lowerExpr.includes("la semana que viene") || lowerExpr.includes("settimana prossima")) {
      targetDate = new Date(localNow);
      targetDate.setUTCDate(targetDate.getUTCDate() + 7);
      readable = phrases.nextWeek;
    } else if (lowerExpr.includes("in a week") || lowerExpr.includes("in 1 week") || lowerExpr.includes("en una semana") || lowerExpr.includes("tra una settimana") || lowerExpr.includes("fra una settimana")) {
      targetDate = new Date(localNow);
      targetDate.setUTCDate(targetDate.getUTCDate() + 7);
      readable = phrases.inAWeek;
    } else if (lowerExpr.includes("this weekend") || lowerExpr.includes("este fin de semana") || lowerExpr.includes("questo weekend") || lowerExpr.includes("questo fine settimana")) {
      targetDate = new Date(localNow);
      const currentDay = targetDate.getUTCDay();
      const daysUntilSaturday = currentDay === 6 ? 0 : 6 - currentDay;
      targetDate.setUTCDate(targetDate.getUTCDate() + daysUntilSaturday);
      readable = phrases.thisWeekend;
    } else if (lowerExpr.includes("next month") || lowerExpr.includes("próximo mes") || lowerExpr.includes("prossimo mese") || lowerExpr.includes("il mese prossimo")) {
      targetDate = new Date(localNow);
      targetDate.setUTCMonth(targetDate.getUTCMonth() + 1);
      readable = phrases.nextMonth;
    }
  }

  // === MONTH + DAY EXPRESSIONS ===
  // Three accepted forms:
  //   en/it: "15 March", "15 marzo"   (number + space/dash + month)
  //   es:    "15 de marzo"            (number + " de " + month) — PR3 addition
  //   en:    "March 15"               (month + space + number)  — see Mon-DD loop below
  //
  // The DD-Mon regex uses an alternation `(?:\s+de\s+|[\s-]+)` so the
  // Spanish "de" connector is preferred when present, otherwise the
  // existing space/dash separator wins.
  if (!targetDate) {
    const ddMonMatch = lowerExpr.match(
      /(\d{1,2})(?:\s+de\s+|[\s-]+)(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|gennaio|febbraio|aprile|maggio|giugno|luglio|settembre|ottobre|novembre|dicembre)/i
    );
    if (ddMonMatch) {
      const dayNum = parseInt(ddMonMatch[1]);
      const monthWord = ddMonMatch[2].toLowerCase();
      const abbrMonthMap: Record<string, number> = {
        jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
        apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
        aug: 7, august: 7, sep: 8, sept: 8, september: 8,
        oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
        enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
        julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
        // PR6 — Italian "dicembre" added (was missing; see comment on
        // `monthNames` at module top).
        gennaio: 0, febbraio: 1, aprile: 3, maggio: 4, giugno: 5,
        luglio: 6, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11,
      };
      const monthNum = abbrMonthMap[monthWord] ?? monthNames[monthWord];
      if (monthNum !== undefined && dayNum >= 1 && dayNum <= 31) {
        // The dayNum digits (e.g., "15" in "15 marzo") were greedily
        // captured by timeMatch as hours. Reset unless the user said
        // an explicit time elsewhere in the phrase.
        if (!hasExplicitTimeOfDay) { hours = null; minutes = 0; }
        // PR5 — build via Date.UTC so the constructed Date's UTC fields
        // are exactly {year, monthNum, dayNum}. Pre-PR5 used the
        // `new Date(year, month, day)` constructor which interprets
        // the args as engine-local time — fine on UTC servers, off by
        // the engine offset on other servers.
        targetDate = new Date(Date.UTC(localNow.getUTCFullYear(), monthNum, dayNum));
        targetDate.setUTCHours(hours ?? 9, hours !== null ? minutes : 0, 0, 0);
        if (targetDate.getTime() < localNow.getTime()) {
          targetDate.setUTCFullYear(targetDate.getUTCFullYear() + 1);
        }
        readable = phrases.monthDay(MONTH_NAMES_BY_LOCALE.en[monthNum], monthNum, dayNum);
      }
    }

    // Handle "Month DD" format (e.g., "March 15", "marzo 15", "marzo del 15"…).
    // Pre-i18n bug: the template literal used `\s+` and `\d{1,2}` literally
    // in a JS string — JS interprets `\s` and `\d` as non-escapes and drops
    // the backslash, so the constructed regex was `marchs+(d{1,2})` which
    // never matched real input. PR3 double-escapes so `\\s+` and `\\d{1,2}`
    // reach the RegExp constructor as the regex metacharacters they should be.
    if (!targetDate) {
      for (const [monthWord, monthNum] of Object.entries(monthNames)) {
        const monthDayMatch = lowerExpr.match(
          new RegExp(`\\b${monthWord}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i")
        );
        if (monthDayMatch) {
          const dayNum = parseInt(monthDayMatch[1]);
          if (dayNum >= 1 && dayNum <= 31) {
            // Same dayNum-as-hours trap as the DD-Mon branch above.
            if (!hasExplicitTimeOfDay) { hours = null; minutes = 0; }
            // PR5 — UTC-fields construction (see DD-Mon branch above).
            targetDate = new Date(Date.UTC(localNow.getUTCFullYear(), monthNum, dayNum));
            targetDate.setUTCHours(hours ?? 9, hours !== null ? minutes : 0, 0, 0);
            if (targetDate.getTime() < localNow.getTime()) {
              targetDate.setUTCFullYear(targetDate.getUTCFullYear() + 1);
            }
            readable = phrases.monthDay(MONTH_NAMES_BY_LOCALE.en[monthNum], monthNum, dayNum);
          }
          break;
        }
      }
    }
  }

  // === DAY-OF-WEEK ===
  if (!targetDate) {
    // Map every accepted lowercase day word → its Sunday-indexed weekday
    // number. Used to look up the canonical localized day name when
    // building the readable string (so an Italian user typing "lunedì"
    // gets back "lunedì prossimo" — not "next Lunedì").
    const dayWordToIndex: Record<string, number> = {
      sunday: 0, sun: 0, domingo: 0, domenica: 0,
      monday: 1, mon: 1, lunes: 1, "lunedì": 1, lunedi: 1,
      tuesday: 2, tue: 2, martes: 2, "martedì": 2, martedi: 2,
      wednesday: 3, wed: 3, "miércoles": 3, miercoles: 3, "mercoledì": 3, mercoledi: 3,
      thursday: 4, thu: 4, jueves: 4, "giovedì": 4, giovedi: 4,
      friday: 5, fri: 5, viernes: 5, "venerdì": 5, venerdi: 5,
      saturday: 6, sat: 6, "sábado": 6, sabado: 6,
    };
    const allDayNames = Object.keys(dayWordToIndex);
    for (const day of allDayNames) {
      if (lowerExpr.includes(day)) {
        targetDate = getNextDayOfWeek(day);
        const displayDay = day.charAt(0).toUpperCase() + day.slice(1);
        readable = phrases.nextDayOfWeek(displayDay, dayWordToIndex[day]);
        break;
      }
    }
  }

  // === STANDALONE TIME (no date) → default to TODAY ===
  if (!targetDate && hours !== null) {
    // PR5 — read user-local hour/minute via UTC fields (which encode
    // user-local clock parts post-PR5 localNow construction). Pre-PR5
    // used getHours/getMinutes which read engine-local time and could
    // diverge from user-local on non-UTC servers.
    targetDate = new Date(localNow);
    const localHour = localNow.getUTCHours();
    const localMinute = localNow.getUTCMinutes();
    const proposedMinutes = hours * 60 + minutes;
    const currentMinutes = localHour * 60 + localMinute;

    if (proposedMinutes <= currentMinutes) {
      targetDate.setUTCDate(targetDate.getUTCDate() + 1);
      readable = phrases.tomorrow;
    } else {
      readable = phrases.today;
    }
  }

  // === APPLY TIME (timezone-aware) ===
  // PR5 / Block A follow-up — the DST-fragile inline offset math at this
  // step has been replaced with `toUtcFromLocalParts` from
  // `timezone-calendar.ts`. The fragile-Date `targetDate` carries the
  // user-local clock parts in its UTC fields (constructed that way at
  // the top via `now.toLocaleString(..., timezone)` + `new Date(localStr)`,
  // then mutated in place by the various branches above). We extract
  // those parts and hand them to the helper, which performs the
  // local→UTC conversion using the same DST-resolution logic as
  // `getRelativeDayWindowUtc` and friends — correct across spring-forward
  // and fall-back boundaries instead of off by an hour.
  //
  // The helper internally calls `Intl.DateTimeFormat`. If the user has
  // a malformed `timezone` value the formatter throws — we keep the
  // try/catch and fall through with `targetDate` unchanged so a bad
  // profile setting can never crash the parser.
  if (targetDate && hours !== null) {
    // PR5 — relative-time expressions ("in 30 minutes", "in 2 hours")
    // produce a targetDate that's already a real UTC instant; we only
    // capture `hours`/`minutes` as a side-effect for back-compat. We
    // skip the local→UTC conversion for those branches and just suppress
    // the time-suffix in `readable`.
    if (isRelativeTimeExpr) {
      // No-op: targetDate is already correct UTC; readable suffix skipped.
    } else {
      // Set the user-local time-of-day on the UTC-fields representation,
      // then resolve to a true UTC instant via the DST-aware helper.
      targetDate.setUTCHours(hours, minutes, 0, 0);
      try {
        targetDate = toUtcFromLocalParts(
          {
            year: targetDate.getUTCFullYear(),
            month: targetDate.getUTCMonth() + 1,
            day: targetDate.getUTCDate(),
            hour: hours,
            minute: minutes,
            second: 0,
          },
          timezone,
        );
      } catch {
        // Bad timezone — keep targetDate as-is.
      }
      readable += ` ${phrases.atTime(hours, minutes)}`;
    }
  } else if (targetDate && hours === null) {
    if (!isRelativeTimeExpr) {
      targetDate.setUTCHours(9, 0, 0, 0);
      try {
        targetDate = toUtcFromLocalParts(
          {
            year: targetDate.getUTCFullYear(),
            month: targetDate.getUTCMonth() + 1,
            day: targetDate.getUTCDate(),
            hour: 9,
            minute: 0,
            second: 0,
          },
          timezone,
        );
      } catch {
        /* keep as-is */
      }
      readable += ` ${phrases.at9default}`;
    }
  }

  if (!targetDate) {
    return { date: null, time: null, readable: phrases.unknown };
  }

  return { date: formatDate(targetDate), time: formatDate(targetDate), readable };
}
