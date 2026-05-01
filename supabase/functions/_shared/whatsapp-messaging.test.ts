// Tests for formatFriendlyDate's locale support.
//
// The English path MUST be byte-identical to the pre-i18n implementation —
// every existing call site (send-reminders, whatsapp-webhook confirmations,
// briefings, weekly summaries) already depends on the exact format
// "Monday, May 4th at 2:00 AM". The es/it paths are new surfaces.
//
// We test against a fixed UTC instant to avoid flakiness from "current year"
// behavior (the formatter omits the year if it matches new Date()'s year).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatFriendlyDate } from "./whatsapp-messaging.ts";

// 2026-05-04T08:00:00Z = Monday, May 4th 2026 at 08:00 UTC.
// In Europe/Rome (CEST = +02:00 in May) this is 10:00 local.
// In America/New_York (EDT = -04:00 in May) this is 04:00 local.
// Year matches "today" (2026), so the year suffix is suppressed in output.
const MAY_4_2026_8AM_UTC = "2026-05-04T08:00:00.000Z";

// 2026-05-04T00:00:00Z = the buggy "midnight UTC" case from the screenshot.
// Renders as 02:00 in Rome — historically displayed as "Monday, May 4th
// at 2:00 AM" which is what the user actually saw. Locked in to prove the
// formatter is innocent — the bug is upstream (process-note set midnight).
const MAY_4_2026_MIDNIGHT_UTC = "2026-05-04T00:00:00.000Z";

// ---------- English back-compat (default lang) ----------

Deno.test("formatFriendlyDate en: weekday + month + ordinal + 12h time", () => {
  // No timezone → uses UTC fields directly.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC),
    "Monday, May 4th at 8:00 AM",
  );
});

Deno.test("formatFriendlyDate en: timezone shifts the local time", () => {
  // 08:00 UTC → 10:00 Rome (CEST in May).
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome"),
    "Monday, May 4th at 10:00 AM",
  );
});

Deno.test("formatFriendlyDate en: midnight UTC → 2:00 AM Rome (the bug-from-screenshot)", () => {
  // This locks in formatter behavior: with timezone=Rome, the output is
  // "Monday, May 4th at 2:00 AM" — which is exactly what the failing
  // beta-user screenshot showed. The fix is upstream (block A: don't
  // store midnight UTC); the formatter is correct.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_MIDNIGHT_UTC, true, "Europe/Rome"),
    "Monday, May 4th at 2:00 AM",
  );
});

Deno.test("formatFriendlyDate en: ordinal suffixes (st/nd/rd/th)", () => {
  assertEquals(
    formatFriendlyDate("2026-05-01T17:00:00.000Z").startsWith("Friday, May 1st"),
    true,
  );
  assertEquals(
    formatFriendlyDate("2026-05-02T17:00:00.000Z").startsWith("Saturday, May 2nd"),
    true,
  );
  assertEquals(
    formatFriendlyDate("2026-05-03T17:00:00.000Z").startsWith("Sunday, May 3rd"),
    true,
  );
  assertEquals(
    formatFriendlyDate("2026-05-04T17:00:00.000Z").startsWith("Monday, May 4th"),
    true,
  );
  assertEquals(
    formatFriendlyDate("2026-05-21T17:00:00.000Z").startsWith("Thursday, May 21st"),
    true,
  );
  assertEquals(
    formatFriendlyDate("2026-05-22T17:00:00.000Z").startsWith("Friday, May 22nd"),
    true,
  );
});

Deno.test("formatFriendlyDate en: omit time when includeTime=false", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, false),
    "Monday, May 4th",
  );
});

Deno.test("formatFriendlyDate en: midnight UTC with no timezone suppresses time", () => {
  // Historical behavior: midnight (00:00) is treated as a "no time set"
  // marker and omitted from the friendly string. Critical to preserve —
  // all-day reminders rely on this.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_MIDNIGHT_UTC, true),
    "Monday, May 4th",
  );
});

Deno.test("formatFriendlyDate en: invalid date returns input unchanged", () => {
  assertEquals(formatFriendlyDate("not-a-date"), "not-a-date");
});

Deno.test("formatFriendlyDate en: explicit lang='en' identical to default", () => {
  // Adding the lang argument must not perturb existing English output.
  const noLang = formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome");
  const withEn = formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "en");
  assertEquals(withEn, noLang);
});

Deno.test("formatFriendlyDate en: unknown lang falls back to en (no crash)", () => {
  // Important — RESPONSES lookup has the same fallback. If a future user
  // shows up with locale='fr', formatFriendlyDate must not throw.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "fr"),
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "en"),
  );
});

// ---------- Italian ----------

Deno.test("formatFriendlyDate it: weekday + month + 24h time, lowercase", () => {
  // Rome timezone, May → CEST = UTC+2, so 08:00 UTC → 10:00 Rome.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "it"),
    "lunedì 4 maggio alle 10:00",
  );
});

Deno.test("formatFriendlyDate it: midnight UTC → 02:00 alle (24h, 2-digit hour)", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_MIDNIGHT_UTC, true, "Europe/Rome", "it"),
    "lunedì 4 maggio alle 02:00",
  );
});

Deno.test("formatFriendlyDate it: BCP-47 'it-IT' is normalized", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "it-IT"),
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "it"),
  );
});

Deno.test("formatFriendlyDate it: time omitted when includeTime=false", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, false, "Europe/Rome", "it"),
    "lunedì 4 maggio",
  );
});

Deno.test("formatFriendlyDate it: midnight suppresses time (consistent with en)", () => {
  // Without a timezone, midnight UTC stays midnight → suppressed.
  assertEquals(
    formatFriendlyDate(MAY_4_2026_MIDNIGHT_UTC, true, undefined, "it"),
    "lunedì 4 maggio",
  );
});

Deno.test("formatFriendlyDate it: out-of-year date includes year", () => {
  // Pick a date deliberately in the past so year suppression doesn't fire.
  const oldDate = "2024-12-25T12:00:00.000Z";
  const result = formatFriendlyDate(oldDate, true, "Europe/Rome", "it");
  assertEquals(result.includes("2024"), true);
  assertEquals(result.startsWith("mercoledì 25 dicembre"), true);
});

// ---------- Spanish ----------

Deno.test("formatFriendlyDate es: 'de' connector + 24h time", () => {
  // 08:00 UTC → 10:00 Madrid (CEST in May).
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Madrid", "es"),
    "lunes 4 de mayo a las 10:00",
  );
});

Deno.test("formatFriendlyDate es: BCP-47 'es-ES' is normalized", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Madrid", "es-ES"),
    formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Madrid", "es"),
  );
});

Deno.test("formatFriendlyDate es: out-of-year date adds 'de YYYY'", () => {
  const oldDate = "2024-12-25T12:00:00.000Z";
  const result = formatFriendlyDate(oldDate, true, "Europe/Madrid", "es");
  assertEquals(result.includes("de 2024"), true);
  assertEquals(result.startsWith("miércoles 25 de diciembre"), true);
});

Deno.test("formatFriendlyDate es: midnight UTC → 02:00 Madrid", () => {
  assertEquals(
    formatFriendlyDate(MAY_4_2026_MIDNIGHT_UTC, true, "Europe/Madrid", "es"),
    "lunes 4 de mayo a las 2:00",
  );
});

// ---------- Cross-locale invariants ----------

Deno.test("formatFriendlyDate: same instant, different locale = different day-name", () => {
  const en = formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "en");
  const it = formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "it");
  const es = formatFriendlyDate(MAY_4_2026_8AM_UTC, true, "Europe/Rome", "es");

  // All three must mention the same hour (10:00).
  assertEquals(en.includes("10:00"), true);
  assertEquals(it.includes("10:00"), true);
  assertEquals(es.includes("10:00"), true);

  // But the day-name word must be in its native locale.
  assertEquals(en.startsWith("Monday"), true);
  assertEquals(it.startsWith("lunedì"), true);
  assertEquals(es.startsWith("lunes"), true);
});
