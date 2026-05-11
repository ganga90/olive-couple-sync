// Tests for _shared/action-planner.ts — focus on the pure pieces
// (readableHasTime). Full planAction() needs a Supabase client and is
// covered by integration tests in the edge-function test plan.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readableHasTime, resolveTimeOnlyEdit } from "./action-planner.ts";
import { getTimeZoneParts } from "./timezone-calendar.ts";

Deno.test("readableHasTime: 'tomorrow at 3:00 PM' → true", () => {
  assertEquals(readableHasTime("tomorrow at 3:00 PM"), true);
});

Deno.test("readableHasTime: 'today at 6:00 PM' → true", () => {
  assertEquals(readableHasTime("today at 6:00 PM"), true);
});

Deno.test("readableHasTime: 'in 30 minutes' → true", () => {
  assertEquals(readableHasTime("in 30 minutes"), true);
});

Deno.test("readableHasTime: 'in 2 hours' → true", () => {
  assertEquals(readableHasTime("in 2 hours"), true);
});

Deno.test("readableHasTime: 'tomorrow' → false (no time-of-day given)", () => {
  assertEquals(readableHasTime("tomorrow"), false);
});

Deno.test("readableHasTime: 'next week' → false", () => {
  assertEquals(readableHasTime("next week"), false);
});

Deno.test("readableHasTime: 'this weekend' → false", () => {
  assertEquals(readableHasTime("this weekend"), false);
});

Deno.test("readableHasTime: empty / missing → false", () => {
  assertEquals(readableHasTime(""), false);
});

Deno.test("readableHasTime: '3:00 PM' bare → true", () => {
  assertEquals(readableHasTime("3:00 PM"), true);
});

// ─── Phase 3.6 — resolveTimeOnlyEdit ──────────────────────────────────

Deno.test("resolveTimeOnlyEdit: time-only + anchor → keeps anchor's date, swaps time", () => {
  // Anchor: 2026-05-12 (some time on that day), user says "change it to 7am" in NY.
  // 7am NY in May = 11:00 UTC (EDT, UTC-4).
  const r = resolveTimeOnlyEdit("change it to 7am", "2026-05-12T15:00:00Z", "America/New_York");
  assert(r !== null);
  // Should be on May 12 (in NY time)
  const parts = getTimeZoneParts(new Date(r!), "America/New_York");
  assertEquals(parts.year, 2026);
  assertEquals(parts.month, 5);
  assertEquals(parts.day, 12);
  assertEquals(parts.hour, 7);
  assertEquals(parts.minute, 0);
});

Deno.test("resolveTimeOnlyEdit: '7:30 PM' is parsed correctly", () => {
  const r = resolveTimeOnlyEdit("set it to 7:30 PM", "2026-05-12T15:00:00Z", "America/New_York");
  assert(r !== null);
  const parts = getTimeZoneParts(new Date(r!), "America/New_York");
  assertEquals(parts.hour, 19);
  assertEquals(parts.minute, 30);
});

Deno.test("resolveTimeOnlyEdit: Italian 'alle 8' against existing Rome anchor", () => {
  // Rome user, expression in Italian, 24h native.
  const r = resolveTimeOnlyEdit("fai alle 8", "2026-05-12T15:00:00Z", "Europe/Rome");
  assert(r !== null);
  const parts = getTimeZoneParts(new Date(r!), "Europe/Rome");
  assertEquals(parts.hour, 8);
  assertEquals(parts.minute, 0);
});

Deno.test("resolveTimeOnlyEdit: Spanish 'a las 14:30' parses as 24h", () => {
  const r = resolveTimeOnlyEdit("cambia a las 14:30", "2026-05-12T10:00:00Z", "Europe/Madrid");
  assert(r !== null);
  const parts = getTimeZoneParts(new Date(r!), "Europe/Madrid");
  assertEquals(parts.hour, 14);
  assertEquals(parts.minute, 30);
});

Deno.test("resolveTimeOnlyEdit: no time in expression → null", () => {
  assertEquals(
    resolveTimeOnlyEdit("change the priority", "2026-05-12T15:00:00Z", "America/New_York"),
    null,
  );
});

Deno.test("resolveTimeOnlyEdit: no anchor → falls back to today (still produces ISO)", () => {
  const r = resolveTimeOnlyEdit("at 7am", null, "America/New_York");
  assert(r !== null);
  const parts = getTimeZoneParts(new Date(r!), "America/New_York");
  assertEquals(parts.hour, 7);
  assertEquals(parts.minute, 0);
});

Deno.test("resolveTimeOnlyEdit: malformed anchor → null (fail safe)", () => {
  assertEquals(
    resolveTimeOnlyEdit("at 7am", "not-a-date", "America/New_York"),
    null,
  );
});

Deno.test("resolveTimeOnlyEdit: DST-safe — Rome anchor across spring-forward", () => {
  // March 30 2026 is after Rome's DST start (March 29). Picking 7am
  // should land at 05:00 UTC (Rome is UTC+2 during CEST).
  const r = resolveTimeOnlyEdit("at 7am", "2026-04-15T10:00:00Z", "Europe/Rome");
  assert(r !== null);
  const parts = getTimeZoneParts(new Date(r!), "Europe/Rome");
  assertEquals(parts.hour, 7);
});

Deno.test("resolveTimeOnlyEdit: ambiguous AM/PM '7' (no marker) → null", () => {
  // Without an AM/PM marker or anchor token, "7" alone shouldn't
  // hijack the parse — the user might have meant 7 items, 7 days, etc.
  assertEquals(
    resolveTimeOnlyEdit("count to 7", "2026-05-12T15:00:00Z", "America/New_York"),
    null,
  );
});
