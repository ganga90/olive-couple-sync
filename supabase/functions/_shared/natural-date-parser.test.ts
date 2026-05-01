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
