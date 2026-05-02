// Tests for parseNaturalDate's locale-aware `readable` field.
//
// Two contracts to defend:
//   1. The English path is BYTE-IDENTICAL to the pre-i18n implementation.
//      Existing call sites (set_due, set_reminder, the chat AI prompt
//      that includes the readable phrase) depend on these exact strings.
//   2. New es/it paths return locale-natural phrases for the inputs the
//      parser already handles. Inputs the parser doesn't handle yet
//      (e.g., "tra due mesi e mezzo" — covered in PR3) still return the
//      `unknown` sentinel in the right locale.
//
// We don't lock down the `date` field here — that's a wall-clock-relative
// computation and is exercised indirectly by the rest of the suite.
// Time-relative tests (e.g., "in 30 minutes") are independent of the
// current wall clock because we only assert on `readable`.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseNaturalDate } from "./natural-date-parser.ts";

// ---------- English back-compat ----------

Deno.test("parseNaturalDate en: 'tomorrow at 3pm' → 'tomorrow at 3:00 PM'", () => {
  const r = parseNaturalDate("tomorrow at 3pm", "America/New_York");
  assertEquals(r.readable, "tomorrow at 3:00 PM");
});

Deno.test("parseNaturalDate en: 'today at 5pm' → 'today at 5:00 PM'", () => {
  const r = parseNaturalDate("today at 5pm", "America/New_York");
  assertEquals(r.readable, "today at 5:00 PM");
});

Deno.test("parseNaturalDate en: 'in 30 minutes' → 'in 30 minutes' (no time-suffix appended)", () => {
  // The relative-minute path must not append "at HH:MM" — that would
  // produce a confusing "in 30 minutes at 4:23 PM". This is the test
  // that proves the new isRelativeTimeExpr flag matches the old
  // `readable.includes("minute")` regex behavior in en.
  const r = parseNaturalDate("in 30 minutes", "America/New_York");
  assertEquals(r.readable, "in 30 minutes");
});

Deno.test("parseNaturalDate en: 'in 2 hours' → 'in 2 hours' (plural, no time-suffix)", () => {
  const r = parseNaturalDate("in 2 hours", "America/New_York");
  assertEquals(r.readable, "in 2 hours");
});

Deno.test("parseNaturalDate en: 'in 1 hour' → 'in 1 hour' (singular)", () => {
  const r = parseNaturalDate("in 1 hour", "America/New_York");
  assertEquals(r.readable, "in 1 hour");
});

Deno.test("parseNaturalDate en: 'half hour' → 'in 30 minutes'", () => {
  const r = parseNaturalDate("half hour", "America/New_York");
  assertEquals(r.readable, "in 30 minutes");
});

Deno.test("parseNaturalDate en: 'next Monday' → 'next Monday at 9:00 AM' (default time)", () => {
  // Day-of-week with no explicit time defaults to 09:00 local.
  const r = parseNaturalDate("next Monday", "America/New_York");
  assertEquals(r.readable, "next Monday at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'next month' → 'next month at 9:00 AM'", () => {
  const r = parseNaturalDate("next month", "America/New_York");
  assertEquals(r.readable, "next month at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'tomorrow' (no time) → 'tomorrow at 9:00 AM'", () => {
  const r = parseNaturalDate("tomorrow", "America/New_York");
  assertEquals(r.readable, "tomorrow at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'day after tomorrow' is +2 days (regression: previously matched tomorrow)", () => {
  // Pre-i18n the parser had a substring-shadowing bug — "day after
  // tomorrow".includes("tomorrow") fired the tomorrow branch first,
  // producing today+1 instead of today+2. PR1 reorders the elif chain
  // to check the more specific phrase first. This test locks that in.
  const r = parseNaturalDate("day after tomorrow", "America/New_York");
  assertEquals(r.readable, "day after tomorrow at 9:00 AM");
  // Compare ISO dates to confirm +2, not +1.
  const tomorrow = parseNaturalDate("tomorrow", "America/New_York");
  const ms = (s: string) => new Date(s).getTime();
  // day-after-tomorrow must be strictly later than tomorrow.
  assertEquals(ms(r.date!) > ms(tomorrow.date!), true);
});

Deno.test("parseNaturalDate it: 'dopodomani' → 'dopodomani alle 09:00' (regression: previously matched 'domani')", () => {
  const r = parseNaturalDate("dopodomani", "Europe/Rome", "it");
  assertEquals(r.readable, "dopodomani alle 09:00");
});

Deno.test("parseNaturalDate es: 'pasado mañana' → 'pasado mañana a las 9:00' (regression: previously matched 'mañana')", () => {
  const r = parseNaturalDate("pasado mañana", "Europe/Madrid", "es");
  assertEquals(r.readable, "pasado mañana a las 9:00");
});

Deno.test("parseNaturalDate en: 'this weekend' → 'this weekend at 9:00 AM'", () => {
  const r = parseNaturalDate("this weekend", "America/New_York");
  assertEquals(r.readable, "this weekend at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'in a week' → 'in a week at 9:00 AM' (no time)", () => {
  // Week-relative isn't "isRelativeTimeExpr" — only minutes/hours are.
  // So the at-9 default suffix is appended.
  const r = parseNaturalDate("in a week", "America/New_York");
  assertEquals(r.readable, "in a week at 9:00 AM");
});

Deno.test("parseNaturalDate en: '15 March' (DD-Mon form) → 'March 15 at 9:00 AM'", () => {
  // Note: "March 15" (Mon-DD form) is not handled by the current parser
  // due to a pre-existing template-literal escape bug in the Month-DD
  // regex. PR3 will overhaul the parser to fix this. PR1 only documents
  // the form that DOES work today (DD-Mon).
  const r = parseNaturalDate("15 March", "America/New_York");
  assertEquals(r.readable, "March 15 at 9:00 AM");
});

Deno.test("parseNaturalDate en: garbage input → 'unknown'", () => {
  const r = parseNaturalDate("zzz qqq", "America/New_York");
  assertEquals(r.date, null);
  assertEquals(r.readable, "unknown");
});

Deno.test("parseNaturalDate en: explicit lang='en' identical to default", () => {
  // Adding the lang argument must not perturb existing English output.
  const inputs = ["tomorrow at 3pm", "in 30 minutes", "next Monday", "March 15", "zzz"];
  for (const expr of inputs) {
    const noLang = parseNaturalDate(expr, "America/New_York");
    const withEn = parseNaturalDate(expr, "America/New_York", "en");
    assertEquals(withEn.readable, noLang.readable, `mismatch for "${expr}"`);
    assertEquals(withEn.date, noLang.date, `date mismatch for "${expr}"`);
  }
});

Deno.test("parseNaturalDate en: unknown lang falls back to en (no crash)", () => {
  const fallback = parseNaturalDate("tomorrow at 3pm", "America/New_York", "fr");
  const baseline = parseNaturalDate("tomorrow at 3pm", "America/New_York", "en");
  assertEquals(fallback.readable, baseline.readable);
});

// ---------- Italian ----------

Deno.test("parseNaturalDate it: 'oggi' → 'oggi alle 09:00'", () => {
  const r = parseNaturalDate("oggi", "Europe/Rome", "it");
  assertEquals(r.readable, "oggi alle 09:00");
});

Deno.test("parseNaturalDate it: 'domani' → 'domani alle 09:00'", () => {
  const r = parseNaturalDate("domani", "Europe/Rome", "it");
  assertEquals(r.readable, "domani alle 09:00");
});

Deno.test("parseNaturalDate it: 'dopodomani' → 'dopodomani alle 09:00'", () => {
  const r = parseNaturalDate("dopodomani", "Europe/Rome", "it");
  assertEquals(r.readable, "dopodomani alle 09:00");
});

Deno.test("parseNaturalDate it: 'tra una settimana' → 'tra una settimana alle 09:00'", () => {
  // "tra una settimana" is parsed via a literal substring match in the
  // named-date branch, so the readable comes out localized.
  const r = parseNaturalDate("tra una settimana", "Europe/Rome", "it");
  assertEquals(r.readable, "tra una settimana alle 09:00");
});

Deno.test("parseNaturalDate it: 'mezz'ora' (half hour) → 'tra 30 minuti'", () => {
  // The half-hour regex handles "mezz'ora" today; this verifies the
  // localized in30Min phrase is wired up.
  // Note: relative quantitatives like "tra 30 minuti" or "tra 2 ore"
  // aren't handled yet (the existing minute/hour regexes are gated on
  // the English "in" prefix). PR3 will extend them to accept tra/fra/en.
  const r = parseNaturalDate("mezz'ora", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 30 minuti");
});

Deno.test("parseNaturalDate it: day-of-week 'lunedì' → 'lunedì prossimo alle 09:00'", () => {
  // Critical contract: the canonical Italian day name is used in the
  // output regardless of how the user spelled it. The user might have
  // written "Lunedì" (capital) or "lunedi" (no diacritic) — output is
  // always the locale-canonical form.
  const r = parseNaturalDate("lunedì", "Europe/Rome", "it");
  assertEquals(r.readable, "lunedì prossimo alle 09:00");
});

Deno.test("parseNaturalDate it: 'lunedi' (no diacritic) maps to canonical 'lunedì'", () => {
  const r = parseNaturalDate("lunedi", "Europe/Rome", "it");
  assertEquals(r.readable, "lunedì prossimo alle 09:00");
});

Deno.test("parseNaturalDate it: 'il prossimo mese' → 'il prossimo mese alle 09:00'", () => {
  const r = parseNaturalDate("il prossimo mese", "Europe/Rome", "it");
  assertEquals(r.readable, "il prossimo mese alle 09:00");
});

Deno.test("parseNaturalDate it: 'BCP-47 'it-IT' is normalized'", () => {
  const a = parseNaturalDate("domani", "Europe/Rome", "it");
  const b = parseNaturalDate("domani", "Europe/Rome", "it-IT");
  assertEquals(a.readable, b.readable);
});

Deno.test("parseNaturalDate it: garbage → 'data non riconosciuta'", () => {
  const r = parseNaturalDate("zzz qqq", "Europe/Rome", "it");
  assertEquals(r.date, null);
  assertEquals(r.readable, "data non riconosciuta");
});

// ---------- Spanish ----------

Deno.test("parseNaturalDate es: 'hoy' → 'hoy a las 9:00'", () => {
  const r = parseNaturalDate("hoy", "Europe/Madrid", "es");
  assertEquals(r.readable, "hoy a las 9:00");
});

Deno.test("parseNaturalDate es: 'mañana' → 'mañana a las 9:00'", () => {
  const r = parseNaturalDate("mañana", "Europe/Madrid", "es");
  assertEquals(r.readable, "mañana a las 9:00");
});

Deno.test("parseNaturalDate es: 'en una semana' → 'en una semana a las 9:00'", () => {
  const r = parseNaturalDate("en una semana", "Europe/Madrid", "es");
  assertEquals(r.readable, "en una semana a las 9:00");
});

Deno.test("parseNaturalDate es: day-of-week 'lunes' → 'el próximo lunes a las 9:00'", () => {
  const r = parseNaturalDate("lunes", "Europe/Madrid", "es");
  assertEquals(r.readable, "el próximo lunes a las 9:00");
});

Deno.test("parseNaturalDate es: 'próximo mes' → 'el próximo mes a las 9:00'", () => {
  const r = parseNaturalDate("próximo mes", "Europe/Madrid", "es");
  assertEquals(r.readable, "el próximo mes a las 9:00");
});

Deno.test("parseNaturalDate es: BCP-47 'es-ES' is normalized", () => {
  const a = parseNaturalDate("mañana", "Europe/Madrid", "es");
  const b = parseNaturalDate("mañana", "Europe/Madrid", "es-ES");
  assertEquals(a.readable, b.readable);
});

Deno.test("parseNaturalDate es: garbage → 'fecha no reconocida'", () => {
  const r = parseNaturalDate("zzz qqq", "Europe/Madrid", "es");
  assertEquals(r.date, null);
  assertEquals(r.readable, "fecha no reconocida");
});

// ---------- Cross-locale invariants ----------

Deno.test("parseNaturalDate: same input, different locales → equivalent ISO date", () => {
  // The `date` (ISO timestamp) computation must be locale-INDEPENDENT.
  // Locale only affects the human-readable string. Otherwise we'd
  // accidentally pin a reminder to a different instant per locale,
  // which would be a critical timing bug in production.
  const en = parseNaturalDate("tomorrow", "Europe/Rome", "en");
  const it = parseNaturalDate("domani", "Europe/Rome", "it");
  const es = parseNaturalDate("mañana", "Europe/Madrid", "es");
  assertEquals(typeof en.date, "string");
  assertEquals(typeof it.date, "string");
  assertEquals(typeof es.date, "string");
  // en and it on the same timezone must produce the same ISO date.
  assertEquals(en.date, it.date);
});

// ============================================================================
// PR3 — relative months/years + multi-language relative-time prefix
// ============================================================================
// PR1 + PR2 left these inputs returning `unknown` (parser bug from the
// beta-user screenshot). PR3 adds first-class regex coverage so the
// parser produces the right date itself, removing the dependency on AI
// fallback (which was guessing wrong dates and defaulting to midnight UTC).
//
// Every new test follows the same shape: assert the readable string AND
// assert the resulting ISO date is in the expected window — using a wall-
// clock-relative computation with a 36-hour tolerance to absorb timezone
// shifts and the test runner's clock.

const HOURS = 60 * 60 * 1000;
const DAYS = 24 * HOURS;

function approximateDate(addMs: number): number {
  return Date.now() + addMs;
}

function dateWithinTolerance(actualISO: string, expectedMs: number, toleranceMs: number): boolean {
  const actualMs = new Date(actualISO).getTime();
  return Math.abs(actualMs - expectedMs) <= toleranceMs;
}

// ---------- Relative MONTHS — three locales ----------

Deno.test("parseNaturalDate en: 'in 2 months' → readable + date ~60 days out", () => {
  const r = parseNaturalDate("in 2 months", "America/New_York");
  assertEquals(r.readable, "in 2 months at 9:00 AM");
  // setMonth(+2) lands in roughly 60 ± 1 days. 36h tolerance absorbs DST and
  // short-month edge cases without making the test flaky.
  const expected = new Date();
  expected.setMonth(expected.getMonth() + 2);
  assertEquals(dateWithinTolerance(r.date!, expected.getTime(), 36 * HOURS), true);
});

Deno.test("parseNaturalDate en: 'in 1 month' → singular, ~30 days out", () => {
  const r = parseNaturalDate("in 1 month", "America/New_York");
  assertEquals(r.readable, "in 1 month at 9:00 AM");
});

Deno.test("parseNaturalDate it: 'tra 2 mesi' → readable in italian", () => {
  const r = parseNaturalDate("tra 2 mesi", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 mesi alle 09:00");
});

Deno.test("parseNaturalDate it: 'tra un mese' → singular form 'mese'", () => {
  const r = parseNaturalDate("tra un mese", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 1 mese alle 09:00");
});

Deno.test("parseNaturalDate it: 'fra 5 mesi' → 'fra' alternative prefix accepted", () => {
  // "fra" is an Italian variant of "tra" — the parser must accept both
  // because users genuinely use both interchangeably in beta data.
  const r = parseNaturalDate("fra 5 mesi", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 5 mesi alle 09:00");
});

Deno.test("parseNaturalDate es: 'en 2 meses' → readable in spanish", () => {
  const r = parseNaturalDate("en 2 meses", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 2 meses a las 9:00");
});

Deno.test("parseNaturalDate es: 'en un mes' → singular form 'mes'", () => {
  const r = parseNaturalDate("en un mes", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 1 mes a las 9:00");
});

// ---------- Relative MONTHS with "and a half" — the screenshot bug ----------

Deno.test("parseNaturalDate it: 'tra due mesi e mezzo' → ~75 days out, italian readable", () => {
  // THIS is the exact phrase from the beta-user screenshot. Pre-PR3 it
  // returned `unknown` and the system fell back to AI which produced
  // "Monday May 4th at 2:00 AM" (midnight UTC = 2 AM Rome).
  // PR3 must produce a date ~75 days out (2.5 months) and a localized
  // readable string.
  const r = parseNaturalDate("tra due mesi e mezzo", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 mesi e mezzo alle 09:00");
  assertEquals(r.date !== null, true);
  // 2 months ~ 60 days, plus 15 = 75 days. Tolerance 36h.
  const expectedMs = approximateDate(75 * DAYS);
  assertEquals(dateWithinTolerance(r.date!, expectedMs, 36 * HOURS), true);
});

Deno.test("parseNaturalDate es: 'en dos meses y medio' → ~75 days out, spanish readable", () => {
  const r = parseNaturalDate("en dos meses y medio", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 2 meses y medio a las 9:00");
  const expectedMs = approximateDate(75 * DAYS);
  assertEquals(dateWithinTolerance(r.date!, expectedMs, 36 * HOURS), true);
});

Deno.test("parseNaturalDate en: 'in 2 and a half months' → ~75 days out", () => {
  const r = parseNaturalDate("in 2 and a half months", "America/New_York");
  assertEquals(r.readable, "in 2 and a half months at 9:00 AM");
  const expectedMs = approximateDate(75 * DAYS);
  assertEquals(dateWithinTolerance(r.date!, expectedMs, 36 * HOURS), true);
});

Deno.test("parseNaturalDate it: 'tra 3 mesi e mezzo' → ~105 days out", () => {
  const r = parseNaturalDate("tra 3 mesi e mezzo", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 3 mesi e mezzo alle 09:00");
  const expectedMs = approximateDate(105 * DAYS); // 3 months ~ 90 + 15
  assertEquals(dateWithinTolerance(r.date!, expectedMs, 60 * HOURS), true);
});

// ---------- Relative YEARS — three locales ----------

Deno.test("parseNaturalDate en: 'in 1 year' → ~365 days out", () => {
  const r = parseNaturalDate("in 1 year", "America/New_York");
  assertEquals(r.readable, "in 1 year at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'in 2 years' → plural 'years'", () => {
  const r = parseNaturalDate("in 2 years", "America/New_York");
  assertEquals(r.readable, "in 2 years at 9:00 AM");
});

Deno.test("parseNaturalDate it: 'tra un anno' → singular 'anno'", () => {
  const r = parseNaturalDate("tra un anno", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 1 anno alle 09:00");
});

Deno.test("parseNaturalDate it: 'tra 2 anni' → plural 'anni'", () => {
  const r = parseNaturalDate("tra 2 anni", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 anni alle 09:00");
});

Deno.test("parseNaturalDate es: 'en un año' → singular 'año'", () => {
  const r = parseNaturalDate("en un año", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 1 año a las 9:00");
});

Deno.test("parseNaturalDate es: 'en 3 años' → plural 'años'", () => {
  const r = parseNaturalDate("en 3 años", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 3 años a las 9:00");
});

// ---------- Multi-language relative-time prefix (in / tra / fra / en) ----------
// Pre-PR3 the existing minute/hour/day regexes only accepted English "in"
// prefix. Italian "tra X minuti" and Spanish "en X minutos" returned
// `unknown`. PR3 extends the prefix to accept all three locales.

Deno.test("parseNaturalDate it: 'tra 30 minuti' → 'tra 30 minuti' (now parses)", () => {
  const r = parseNaturalDate("tra 30 minuti", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 30 minuti");
  assertEquals(r.date !== null, true);
});

Deno.test("parseNaturalDate it: 'fra 2 ore' → 'tra 2 ore'", () => {
  const r = parseNaturalDate("fra 2 ore", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 ore");
});

Deno.test("parseNaturalDate it: 'tra 3 giorni' → 'tra 3 giorni alle 09:00'", () => {
  const r = parseNaturalDate("tra 3 giorni", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 3 giorni alle 09:00");
});

Deno.test("parseNaturalDate es: 'en 30 minutos' → 'en 30 minutos' (now parses)", () => {
  const r = parseNaturalDate("en 30 minutos", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 30 minutos");
});

Deno.test("parseNaturalDate es: 'en 2 horas' → 'en 2 horas'", () => {
  const r = parseNaturalDate("en 2 horas", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 2 horas");
});

Deno.test("parseNaturalDate es: 'en 3 días' → 'en 3 días a las 9:00'", () => {
  const r = parseNaturalDate("en 3 días", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 3 días a las 9:00");
});

// ---------- Word-boundary protection (false-positive guards) ----------

Deno.test("parseNaturalDate en: 'begin 30 minutes' does NOT match 'in' false positive", () => {
  // Pre-PR3 the prefix `in\s+` had no word boundary, so messages like
  // "I plan to begin 30 minutes from now" matched 'in' inside 'begin'
  // and produced spurious dates. PR3 adds `\b` to guard against this.
  const r = parseNaturalDate("begin 30 minutes from now", "America/New_York");
  // Expected: parser does NOT extract a relative date from this phrase.
  // Either returns unknown OR matches a different (correct) branch.
  // The key contract: no spurious "in 30 minutes" from substring matching.
  assertEquals(r.readable.startsWith("in 30 minutes"), false);
});

Deno.test("parseNaturalDate en: 'lengthen 30 minutes' does NOT match 'en' false positive", () => {
  // Same test for the new 'en' (Spanish) prefix when used in en text.
  const r = parseNaturalDate("lengthen 30 minutes", "America/New_York");
  assertEquals(r.readable.startsWith("in 30 minutes"), false);
  assertEquals(r.readable.startsWith("en 30 minutos"), false);
});

// ---------- Mon-DD form ("March 15") regression test ----------

Deno.test("parseNaturalDate en: 'March 15' (Mon-DD) → 'March 15 at 9:00 AM'", () => {
  // PR2's test deliberately used DD-Mon ("15 March") because Mon-DD was
  // broken by a template-literal escape bug. PR3 fixes that bug —
  // both forms now work, so we can test the en-natural Mon-DD form.
  const r = parseNaturalDate("March 15", "America/New_York");
  assertEquals(r.readable, "March 15 at 9:00 AM");
});

Deno.test("parseNaturalDate en: 'July 4th' (with ordinal suffix) → 'July 4 at 9:00 AM'", () => {
  const r = parseNaturalDate("July 4th", "America/New_York");
  assertEquals(r.readable, "July 4 at 9:00 AM");
});

// ---------- Spanish "de" connector ----------

Deno.test("parseNaturalDate es: '15 de marzo' (Spanish 'de' connector) → 'March 15' equivalent", () => {
  // Pre-PR3 the DD-Mon regex required a simple [\s-] separator, so the
  // Spanish-natural "de" connector ("15 de marzo") didn't match and the
  // parser returned unknown. PR3 adds the alternative `\s+de\s+` separator.
  const r = parseNaturalDate("15 de marzo", "Europe/Madrid", "es");
  assertEquals(r.readable, "15 de marzo a las 9:00");
});

// Note: "20 de noviembre a las 8" (Spanish date + time-of-day combo) is
// not yet supported because timeMatch greedily captures the FIRST digit
// in the input ("20" here, swallowing the date-of-month) before the
// later "a las 8" can be extracted. Fixing this needs the time-extraction
// regex to prefer keyword-anchored time patterns ("a las X") over
// standalone digits — out of PR3 scope.

// ---------- Word numbers across locales ----------

Deno.test("parseNaturalDate en: 'in two months' (word number) → ~60 days out", () => {
  const r = parseNaturalDate("in two months", "America/New_York");
  assertEquals(r.readable, "in 2 months at 9:00 AM");
});

Deno.test("parseNaturalDate it: 'tra due mesi' (word number) → 'tra 2 mesi'", () => {
  const r = parseNaturalDate("tra due mesi", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 mesi alle 09:00");
});

Deno.test("parseNaturalDate es: 'en dos meses' (word number) → 'en 2 meses'", () => {
  const r = parseNaturalDate("en dos meses", "Europe/Madrid", "es");
  assertEquals(r.readable, "en 2 meses a las 9:00");
});

// ---------- Locale isolation — same input, different ISO ----------

Deno.test("parseNaturalDate: 'tra due mesi e mezzo' (it) and 'en dos meses y medio' (es) produce equivalent dates", () => {
  // Same semantics, different locales — the ISO timestamp must align
  // (modulo timezone shifts). Both should be ~75 days out.
  const it = parseNaturalDate("tra due mesi e mezzo", "Europe/Rome", "it");
  const es = parseNaturalDate("en dos meses y medio", "Europe/Madrid", "es");
  const itMs = new Date(it.date!).getTime();
  const esMs = new Date(es.date!).getTime();
  // Allow up to 24h difference for the Rome ↔ Madrid timezone gap.
  assertEquals(Math.abs(itMs - esMs) < 24 * HOURS, true);
});

// ============================================================================
// PR5 — DST-safe local→UTC conversion
// ============================================================================
// Pre-PR5 the parser closed with an inline offset-calculation block that
// round-tripped through `toLocaleString` to convert local-to-UTC.
// The math worked on normal days but produced wrong results across DST
// boundaries (Rome's spring-forward in late March, fall-back in late
// October; NY in early March / early November).
//
// PR5 replaces that block with `toUtcFromLocalParts` from
// `timezone-calendar.ts`, which uses Intl-aware offset resolution and
// is correct across DST transitions.
//
// Strategy for these tests: verify that the returned UTC ISO, when
// rendered back in the user's timezone, gives the LOCAL clock time the
// user actually typed (or the 09:00 default). This is the only test
// shape that's robust to wall-clock test runs, year-rolling for
// past-month dates, and DST shifts — if the conversion is wrong by an
// hour, the local-time render will be off by an hour, and the assertion
// fails clearly.

function localTimeIn(timezone: string, dateIso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(dateIso));
}

// ---------- Default 09:00 local across DST ----------

Deno.test("parseNaturalDate dst: 'march 29' in Rome lands at 09:00 Rome local (post-spring-forward)", () => {
  // Rome spring-forward in any modern year is the last Sunday of March.
  // March 29 is always AFTER spring-forward → CEST (UTC+2). 09:00 Rome
  // CEST = 07:00 UTC. Pre-PR5 the inline math could land an hour off
  // around the boundary; PR5 nails it.
  const r = parseNaturalDate("29 march", "Europe/Rome");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "09:00");
});

Deno.test("parseNaturalDate dst: 'november 1' in Rome lands at 09:00 Rome local (post-fall-back)", () => {
  // Rome fall-back is the last Sunday of October. November 1 is always
  // AFTER fall-back → CET (UTC+1). 09:00 Rome CET = 08:00 UTC.
  const r = parseNaturalDate("1 november", "Europe/Rome");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "09:00");
});

Deno.test("parseNaturalDate dst: 'march 10' in New York lands at 09:00 NY local (post-spring-forward)", () => {
  // NY spring-forward is the second Sunday of March (March 8 in 2026,
  // March 14 in 2027). March 10 is post-spring-forward → EDT (UTC-4).
  // 09:00 NY EDT = 13:00 UTC.
  const r = parseNaturalDate("10 march", "America/New_York");
  assertEquals(localTimeIn("America/New_York", r.date!), "09:00");
});

Deno.test("parseNaturalDate dst: 'november 5' in New York lands at 09:00 NY local (post-fall-back)", () => {
  // NY fall-back is the first Sunday of November. November 5 is always
  // post-fall-back → EST (UTC-5). 09:00 NY EST = 14:00 UTC.
  const r = parseNaturalDate("5 november", "America/New_York");
  assertEquals(localTimeIn("America/New_York", r.date!), "09:00");
});

// ---------- User-typed explicit time ----------
// Note: testing "<date> at <time>" combos with future month-day forms
// (e.g., "29 march at 3pm") would exercise a separate parser limitation
// where timeMatch greedily captures the date-of-month digit. We test
// the user-typed time path via named-date inputs instead, which take
// the same APPLY TIME conversion route through toUtcFromLocalParts.

Deno.test("parseNaturalDate dst: 'tomorrow at 3pm' in Rome lands at 15:00 Rome local", () => {
  const r = parseNaturalDate("tomorrow at 3pm", "Europe/Rome");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "15:00");
});

Deno.test("parseNaturalDate dst: 'tomorrow at 8am' in New York lands at 08:00 NY local", () => {
  const r = parseNaturalDate("tomorrow at 8am", "America/New_York");
  assertEquals(localTimeIn("America/New_York", r.date!), "08:00");
});

// ---------- Cross-locale invariant ----------

Deno.test("parseNaturalDate dst: 'tomorrow' in Rome resolves at 09:00 Rome (regardless of DST)", () => {
  const r = parseNaturalDate("tomorrow", "Europe/Rome");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "09:00");
});

Deno.test("parseNaturalDate dst: 'next month' in Madrid resolves at 09:00 Madrid (regardless of DST)", () => {
  const r = parseNaturalDate("próximo mes", "Europe/Madrid", "es");
  assertEquals(localTimeIn("Europe/Madrid", r.date!), "09:00");
});

Deno.test("parseNaturalDate dst: 'in 2 months' in Rome at 09:00 Rome local", () => {
  // Wall-clock-relative — exact UTC depends on the test run, but the
  // local render must always be 09:00 if the conversion is correct.
  const r = parseNaturalDate("in 2 months", "Europe/Rome");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "09:00");
});

// ============================================================================
// PR6 — Italian "dicembre" Mon-DD / DD-Mon parity
// ============================================================================
// Pre-PR6 Italian "dicembre" (different spelling from Spanish "diciembre")
// was missing from monthNames + abbrMonthMap, so Italian users hit
// `unknown` for any December input. This was the last per-locale gap
// in the parser's month-name coverage.

Deno.test("parseNaturalDate it: '15 dicembre' (DD-Mon, Italian December) parses", () => {
  const r = parseNaturalDate("15 dicembre", "Europe/Rome", "it");
  assertEquals(r.date !== null, true);
  // Readable should reference the Italian month name.
  assertEquals(r.readable, "15 dicembre alle 09:00");
});

Deno.test("parseNaturalDate it: 'dicembre 15' (Mon-DD, Italian December) parses", () => {
  const r = parseNaturalDate("dicembre 15", "Europe/Rome", "it");
  assertEquals(r.date !== null, true);
  assertEquals(r.readable, "15 dicembre alle 09:00");
});

Deno.test("parseNaturalDate es: '15 de diciembre' (Spanish 'de' connector) still works after dicembre addition", () => {
  // Regression guard — Spanish "diciembre" must still resolve correctly
  // after adding the Italian variant. Both spellings exist in the maps
  // and both should match.
  const r = parseNaturalDate("15 de diciembre", "Europe/Madrid", "es");
  assertEquals(r.date !== null, true);
  assertEquals(r.readable, "15 de diciembre a las 9:00");
});

// ============================================================================
// PR7 — keyword-anchored time-of-day extraction (date + time combos)
// ============================================================================
// Pre-PR7 the parser's `timeMatch` regex was greedy on the first digit
// pattern in the string. When the first match was a date-of-month (not a
// time), the rest of the string was never re-examined — including any
// `at <time>` / `alle <time>` / `a las <time>` keyword-anchored time-of-
// day. PR7 runs `extractTimeOnly` (which prefers keyword-anchored and
// AM/PM patterns) BEFORE the greedy first-digit fallback, so the user's
// actual time-of-day is captured for date+time combos.

Deno.test("parseNaturalDate pr7: '20 de noviembre a las 8' (es, date+time) → Nov 20 at 08:00 Madrid", () => {
  // The flagship case. Pre-PR7 returned "20 de noviembre a las 9:00"
  // (default 09:00, missing the user's actual "a las 8"). Now correct.
  const r = parseNaturalDate("20 de noviembre a las 8", "Europe/Madrid", "es");
  assertEquals(r.readable, "20 de noviembre a las 8:00");
  assertEquals(localTimeIn("Europe/Madrid", r.date!), "08:00");
});

Deno.test("parseNaturalDate pr7: 'march 15 at 3pm' (en, date+time AM/PM) → March 15 at 15:00 NY", () => {
  const r = parseNaturalDate("march 15 at 3pm", "America/New_York");
  assertEquals(r.readable, "March 15 at 3:00 PM");
  assertEquals(localTimeIn("America/New_York", r.date!), "15:00");
});

Deno.test("parseNaturalDate pr7: '15 dicembre alle 14' (it, date+time 24h) → Dec 15 at 14:00 Rome", () => {
  // Italian 24h native — pre-PR7 the kw path didn't run, "15" rejected
  // as hours, "alle 14" never seen → defaulted to 09:00.
  const r = parseNaturalDate("15 dicembre alle 14", "Europe/Rome", "it");
  assertEquals(r.readable, "15 dicembre alle 14:00");
  assertEquals(localTimeIn("Europe/Rome", r.date!), "14:00");
});

Deno.test("parseNaturalDate pr7: '5 de mayo a las 9' (es, single-digit date) — does NOT mistake date for hour", () => {
  // Worst pre-PR7 failure mode: "5" was ≤12 with no AM/PM, so the greedy
  // regex picked it as hour=5. The user's "a las 9" was silently lost
  // and they got a 5:00 reminder instead of 9:00. PR7 sees "a las 9"
  // first via the keyword path and ignores the date-position digit.
  const r = parseNaturalDate("5 de mayo a las 9", "Europe/Madrid", "es");
  assertEquals(r.readable, "5 de mayo a las 9:00");
  assertEquals(localTimeIn("Europe/Madrid", r.date!), "09:00");
});

Deno.test("parseNaturalDate pr7: 'at 14' (24h with keyword, no AM/PM) → 14:00 today", () => {
  // Pre-PR7 returned "unknown": "14" greedy-matched but failed the
  // ≤12-without-meridiem gate; no fallback found "at 14".
  const r = parseNaturalDate("at 14", "America/New_York");
  assertEquals(localTimeIn("America/New_York", r.date!), "14:00");
});

Deno.test("parseNaturalDate pr7: 'march 15 at 3' (en, no AM/PM) → 03:00 (24h interpretation)", () => {
  // Without AM/PM the keyword path treats "3" as 24h-style 03:00. Same
  // as bare "3" → 3 AM in pre-PR7 greedy. No regression; the only
  // difference is now the path through the keyword.
  const r = parseNaturalDate("march 15 at 3", "America/New_York");
  assertEquals(localTimeIn("America/New_York", r.date!), "03:00");
});

// ---------- PR7 regression guards (back-compat with pre-PR7 working cases) ----------

Deno.test("parseNaturalDate pr7 regression: 'tomorrow at 3pm' still works (AM/PM path takes priority)", () => {
  const r = parseNaturalDate("tomorrow at 3pm", "America/New_York");
  assertEquals(r.readable, "tomorrow at 3:00 PM");
});

Deno.test("parseNaturalDate pr7 regression: bare '10' (en) → today/tomorrow at 10:00 (greedy fallback)", () => {
  // No keyword anchor, no AM/PM, no HH:MM — extractTimeOnly returns
  // null and the greedy first-digit fallback sets hours=10. Preserves
  // pre-PR7 behavior for the small set of users typing bare hours.
  const r = parseNaturalDate("10", "America/New_York");
  // The standalone-time path picks today vs tomorrow based on whether
  // the proposed time has already passed. Either way it's 10:00 local.
  assertEquals(localTimeIn("America/New_York", r.date!), "10:00");
});

Deno.test("parseNaturalDate pr7 regression: 'in 30 minutes' still relative (no time-of-day captured)", () => {
  const r = parseNaturalDate("in 30 minutes", "America/New_York");
  assertEquals(r.readable, "in 30 minutes");
});

Deno.test("parseNaturalDate pr7 regression: 'tra due mesi e mezzo' (it) defaults to 09:00 alle", () => {
  const r = parseNaturalDate("tra due mesi e mezzo", "Europe/Rome", "it");
  assertEquals(r.readable, "tra 2 mesi e mezzo alle 09:00");
});
