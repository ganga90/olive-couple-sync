// Tests for src/lib/note-display-moment.ts.
//
// Lives outside src/ because the repo has no frontend test framework
// (no vitest/jest configured); Deno runs the test directly against
// the source file via a relative import. The helper is pure TS — no
// React, no Vite, no DOM — so Deno parses it without ceremony.
//
// Coverage focus: the exact failure modes that produced the 2026-05-12
// "Thu, May 14" widget bug. Each scenario asserts the calendar day in
// the user's timezone, not just the underlying Date object.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getNoteDisplayMoment } from "../../../src/lib/note-display-moment.ts";

// Helper: render a moment as "weekday, month day" in a given timezone.
// Mirrors what ContextRail's `format(date, 'EEE, MMM d')` produces,
// except we explicitly thread the timezone through so the test is
// reproducible regardless of where it runs.
function renderDay(d: Date, timeZone: string): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
}

// ─── reminder_time wins ────────────────────────────────────────────

Deno.test("reminder_time takes precedence over due_date", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: "2026-05-15T16:00:00.000Z",
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, true);
  // 16:00 UTC = 12:00 EDT (May is EDT, UTC-4)
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

Deno.test("reminder_time used even when due_date is null", () => {
  const r = getNoteDisplayMoment({
    dueDate: null,
    reminder_time: "2026-05-15T16:00:00.000Z",
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, true);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

// ─── date-only due_date: the original off-by-one bug ─────────────────

Deno.test("date-only due_date (UTC midnight) renders correctly in NY (the screenshot bug)", () => {
  // The exact value that produced "Thu, May 14" in the 2026-05-12
  // user-reported screenshot. With the helper, it must render as
  // Friday May 15 in America/New_York.
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15 00:00:00+00",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, false);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

Deno.test("date-only due_date renders correctly in LA (UTC-7/-8)", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: null,
  }, "America/Los_Angeles");
  assert(r);
  assertEquals(renderDay(r.moment, "America/Los_Angeles"), "Fri, May 15");
});

Deno.test("date-only due_date renders correctly in Madrid (UTC+1/+2)", () => {
  // Positive-offset timezones don't have the off-by-one — but the
  // helper must not break them. Friday is still Friday in Madrid.
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: null,
  }, "Europe/Madrid");
  assert(r);
  assertEquals(renderDay(r.moment, "Europe/Madrid"), "Fri, May 15");
});

Deno.test("date-only due_date renders correctly in UTC", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: null,
  }, "UTC");
  assert(r);
  assertEquals(renderDay(r.moment, "UTC"), "Fri, May 15");
});

Deno.test("date-only due_date with no timezone arg defaults to noon-UTC anchor (calendar day stays right in browser zone)", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: null,
  });
  assert(r);
  // Noon UTC on May 15: still May 15 in every zone from -11 to +11.
  // No locale-pinned assertion needed — it's stable everywhere.
  const utcDay = r.moment.toLocaleDateString("en-US", {
    weekday: "short",
    timeZone: "UTC",
  });
  assertEquals(utcDay, "Fri");
});

Deno.test("plain YYYY-MM-DD due_date string parses correctly", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, false);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

// ─── timed due_date (not midnight UTC) is trusted as-is ─────────────

Deno.test("non-midnight-UTC due_date is treated as a real timed moment", () => {
  // e.g. someone set due_date to "Friday May 15 9am NY" → stored as
  // 2026-05-15T13:00:00.000Z. The helper should pass it through.
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T13:00:00.000Z",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, true);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

// ─── timezone handling: DST boundary safety ─────────────────────────

Deno.test("date-only on a DST transition day still renders the right day (NY spring-forward 2026)", () => {
  // 2026-03-08 is the US spring-forward day. The anchor must not
  // accidentally land in the wrong day because of the missing hour.
  const r = getNoteDisplayMoment({
    dueDate: "2026-03-08T00:00:00.000Z",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(renderDay(r.moment, "America/New_York"), "Sun, Mar 8");
});

Deno.test("date-only on a DST transition day in Sydney (south-hemisphere)", () => {
  // 2026-04-05 — Sydney falls back from AEDT to AEST.
  const r = getNoteDisplayMoment({
    dueDate: "2026-04-05T00:00:00.000Z",
    reminder_time: null,
  }, "Australia/Sydney");
  assert(r);
  assertEquals(renderDay(r.moment, "Australia/Sydney"), "Sun, Apr 5");
});

// ─── degenerate inputs ──────────────────────────────────────────────

Deno.test("both fields null → returns null (caller decides)", () => {
  const r = getNoteDisplayMoment({ dueDate: null, reminder_time: null });
  assertEquals(r, null);
});

Deno.test("both fields undefined → returns null", () => {
  const r = getNoteDisplayMoment({});
  assertEquals(r, null);
});

Deno.test("malformed reminder_time falls back to due_date", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00.000Z",
    reminder_time: "this is not a date",
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, false);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

Deno.test("malformed both fields → null", () => {
  const r = getNoteDisplayMoment({
    dueDate: "garbage",
    reminder_time: "more garbage",
  }, "America/New_York");
  assertEquals(r, null);
});

// ─── Postgres timestamptz format (with space + +00, no T) ──────────

Deno.test("postgres timestamptz format with space separator + '+00'", () => {
  // This is the literal shape the column returns in API responses
  // when serialized by some drivers. The regex must match.
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15 00:00:00+00",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(r.isTimed, false);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});

Deno.test("postgres timestamptz format with '+00:00' offset", () => {
  const r = getNoteDisplayMoment({
    dueDate: "2026-05-15T00:00:00+00:00",
    reminder_time: null,
  }, "America/New_York");
  assert(r);
  assertEquals(renderDay(r.moment, "America/New_York"), "Fri, May 15");
});
