// Tests for the PR4 set_due timezone fix (Block C / screenshot bug #3).
//
// Pre-PR4 the time-only update path used `existingDate.setUTCHours(...)`,
// which sets the *UTC* hour of the date. For a Rome user typing "fai
// alle 8" (meaning "make it 8 AM Rome"), this set 08:00 UTC = 10:00 Rome
// (or 09:00 in winter). The fix replaces the UTC math with the
// `getTimeZoneParts` + `toUtcFromLocalParts` helpers from
// `timezone-calendar.ts` so the user's typed time is interpreted in
// their selected timezone.
//
// These tests exercise the fix directly via the helpers — the same
// composition the webhook now does in the set_due case. Locking down
// the math here protects against future refactors that could
// re-introduce the bug.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractTimeOnly } from "./time-only-parser.ts";
import {
  getTimeZoneParts,
  toUtcFromLocalParts,
} from "./timezone-calendar.ts";

// Helper that mirrors the exact two-step composition the webhook
// performs in set_due: extract time → replace hour/minute on the
// existing UTC date in the user's timezone → convert back to UTC.
function applyTimeOnlyToExistingDate(
  existingDateIso: string,
  timeOnlyExpr: string,
  timeZone: string,
): string | null {
  const t = extractTimeOnly(timeOnlyExpr);
  if (!t) return null;
  const existingDate = new Date(existingDateIso);
  const localParts = getTimeZoneParts(existingDate, timeZone);
  const newDate = toUtcFromLocalParts(
    { ...localParts, hour: t.hours, minute: t.minutes, second: 0 },
    timeZone,
  );
  return newDate.toISOString();
}

// ---------- THE SCREENSHOT BUG ----------

Deno.test("set_due tz fix: 'fai alle 8' on a Rome user lands at 08:00 Rome (CEST = +02:00)", () => {
  // Original reminder: 2026-05-04T00:00:00Z = midnight UTC = 02:00 Rome.
  // User says "fai alle 8" — they want 08:00 Rome local.
  // Pre-PR4 (setUTCHours) bug: would have produced 08:00 UTC = 10:00 Rome.
  // PR4 fix: converts via Rome timezone → 06:00 UTC = 08:00 Rome.
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T00:00:00.000Z",
    "fai alle 8",
    "Europe/Rome",
  );
  assertEquals(result, "2026-05-04T06:00:00.000Z");
});

Deno.test("set_due tz fix: 'a las 8' on a Madrid user lands at 08:00 Madrid (CEST = +02:00)", () => {
  // Madrid uses CEST (UTC+2) in May, same as Rome.
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T00:00:00.000Z",
    "a las 8",
    "Europe/Madrid",
  );
  assertEquals(result, "2026-05-04T06:00:00.000Z");
});

Deno.test("set_due tz fix: 'change to 7 AM' on a New York user lands at 07:00 EDT", () => {
  // NY in May is EDT (UTC-4), so 07:00 NY = 11:00 UTC.
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T12:00:00.000Z",
    "change to 7 AM",
    "America/New_York",
  );
  assertEquals(result, "2026-05-04T11:00:00.000Z");
});

// ---------- Day-of-month preservation ----------

Deno.test("set_due tz fix: setting a Rome time keeps the LOCAL day even when UTC day differs", () => {
  // Original: 2026-05-04T23:30:00Z. In Rome that's 2026-05-05 01:30
  // (next day local). User says "alle 8" — meaning 08:00 Rome on the
  // SAME local day (May 5). The fix must preserve local day-of-month,
  // not UTC day. setUTCHours would have produced 2026-05-04T08:00:00Z
  // = 2026-05-04T10:00 Rome (PREVIOUS local day, wrong).
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T23:30:00.000Z",
    "alle 8",
    "Europe/Rome",
  );
  // Expected: 2026-05-05T08:00 Rome = 2026-05-05T06:00:00.000Z
  assertEquals(result, "2026-05-05T06:00:00.000Z");
});

// ---------- DST boundary ----------

Deno.test("set_due tz fix: 'alle 8' on a Rome date in winter (CET = +01:00) lands 07:00 UTC", () => {
  // Rome in February is CET (UTC+1), so 08:00 Rome = 07:00 UTC.
  // toUtcFromLocalParts in timezone-calendar.ts handles this; the test
  // proves we're using the helper, not naive UTC math.
  const result = applyTimeOnlyToExistingDate(
    "2026-02-15T00:00:00.000Z",
    "alle 8",
    "Europe/Rome",
  );
  assertEquals(result, "2026-02-15T07:00:00.000Z");
});

Deno.test("set_due tz fix: NY user resets time on a date stored as midnight UTC — preserves LOCAL day", () => {
  // Subtle but important: 2026-08-10T00:00:00Z is, in NY local time,
  // 2026-08-09 20:00 EDT — yesterday from the user's perspective. When
  // they say "at 7 AM", they mean 07:00 on AUG 9 (their local day),
  // because that's the day the existing reminder LOCALLY belongs to.
  // Result: 2026-08-09T11:00 UTC.
  //
  // Pre-PR4 setUTCHours would have produced 2026-08-10T07:00:00Z
  // = 03:00 EDT on Aug 10 — a totally different day AND wrong time.
  // The fix preserves both the local day and the local hour the
  // user actually typed.
  const result = applyTimeOnlyToExistingDate(
    "2026-08-10T00:00:00.000Z",
    "at 7 AM",
    "America/New_York",
  );
  assertEquals(result, "2026-08-09T11:00:00.000Z");
});

Deno.test("set_due tz fix: NY user with a sensibly-stored noon-UTC date → same local day, 7 AM", () => {
  // 2026-08-10T12:00 UTC is 08:00 EDT on Aug 10 (within local day).
  // Setting time to 07:00 NY → 11:00 UTC, same local day Aug 10.
  const result = applyTimeOnlyToExistingDate(
    "2026-08-10T12:00:00.000Z",
    "at 7 AM",
    "America/New_York",
  );
  assertEquals(result, "2026-08-10T11:00:00.000Z");
});

// ---------- 24h native locales (no AM/PM in input) ----------

Deno.test("set_due tz fix: 'alle 14:30' (Italian 24h) → 14:30 Rome local", () => {
  // Pre-PR4 the regex required AM/PM, so this input wouldn't have
  // matched at all → user's correction silently dropped. PR4 accepts
  // 24h native time and converts correctly.
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T00:00:00.000Z",
    "alle 14:30",
    "Europe/Rome",
  );
  // 14:30 Rome (CEST +02:00) = 12:30 UTC.
  assertEquals(result, "2026-05-04T12:30:00.000Z");
});

Deno.test("set_due tz fix: 'a las 14:30' (Spanish 24h) → 14:30 Madrid local", () => {
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T00:00:00.000Z",
    "a las 14:30",
    "Europe/Madrid",
  );
  assertEquals(result, "2026-05-04T12:30:00.000Z");
});

// ---------- Ineligible inputs ----------

Deno.test("set_due tz fix: returns null when no time-of-day is in the input", () => {
  const result = applyTimeOnlyToExistingDate(
    "2026-05-04T00:00:00.000Z",
    "in 2 months",
    "Europe/Rome",
  );
  assertEquals(result, null);
});
