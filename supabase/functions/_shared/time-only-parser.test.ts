// Tests for extractTimeOnly — used by the WhatsApp set_due time-only
// update path. Pre-PR4 the inlined regex required AM/PM, which broke
// "fai alle 8" / "a las 8" / "alle 14:30". The new helper covers all
// three locales and 24h forms.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractTimeOnly } from "./time-only-parser.ts";

// ---------- AM/PM forms ----------

Deno.test("extractTimeOnly: '7 AM' → 7:00", () => {
  assertEquals(extractTimeOnly("7 AM"), { hours: 7, minutes: 0 });
});

Deno.test("extractTimeOnly: '7:30 PM' → 19:30", () => {
  assertEquals(extractTimeOnly("7:30 PM"), { hours: 19, minutes: 30 });
});

Deno.test("extractTimeOnly: '12 AM' → 0:00 (midnight)", () => {
  assertEquals(extractTimeOnly("12 AM"), { hours: 0, minutes: 0 });
});

Deno.test("extractTimeOnly: '12 PM' → 12:00 (noon)", () => {
  assertEquals(extractTimeOnly("12 PM"), { hours: 12, minutes: 0 });
});

Deno.test("extractTimeOnly: 'change it to 7 AM' (with surrounding text)", () => {
  assertEquals(extractTimeOnly("change it to 7 AM"), { hours: 7, minutes: 0 });
});

Deno.test("extractTimeOnly: 'at 7am' (lowercase, no space)", () => {
  // The "at" keyword path runs first and matches; both paths yield the
  // same answer here. The lock-in is just that it parses.
  assertEquals(extractTimeOnly("at 7am"), { hours: 7, minutes: 0 });
});

// ---------- Italian "alle X" / "all'X" (24h native) ----------

Deno.test("extractTimeOnly: 'alle 8' → 8:00 (24h, no AM/PM)", () => {
  // THIS is the screenshot phrase that pre-PR4 returned null →
  // user's "fai alle 8" correction was silently dropped.
  assertEquals(extractTimeOnly("alle 8"), { hours: 8, minutes: 0 });
});

Deno.test("extractTimeOnly: 'fai alle 8' (with verb prefix)", () => {
  assertEquals(extractTimeOnly("fai alle 8"), { hours: 8, minutes: 0 });
});

Deno.test("extractTimeOnly: 'alle 14:30' → 14:30 (24h)", () => {
  assertEquals(extractTimeOnly("alle 14:30"), { hours: 14, minutes: 30 });
});

Deno.test("extractTimeOnly: \"all'8\" (apostrophe elision) → 8:00", () => {
  assertEquals(extractTimeOnly("all'8"), { hours: 8, minutes: 0 });
});

// ---------- Spanish "a las X" / "a la X" ----------

Deno.test("extractTimeOnly: 'a las 8' → 8:00 (24h, no AM/PM)", () => {
  assertEquals(extractTimeOnly("a las 8"), { hours: 8, minutes: 0 });
});

Deno.test("extractTimeOnly: 'a la 1' → 1:00 (Spanish singular)", () => {
  assertEquals(extractTimeOnly("a la 1"), { hours: 1, minutes: 0 });
});

Deno.test("extractTimeOnly: 'a las 14:30' → 14:30 (24h)", () => {
  assertEquals(extractTimeOnly("a las 14:30"), { hours: 14, minutes: 30 });
});

// ---------- Bare HH:MM ----------

Deno.test("extractTimeOnly: '8:30' (bare) → 8:30", () => {
  assertEquals(extractTimeOnly("8:30"), { hours: 8, minutes: 30 });
});

Deno.test("extractTimeOnly: '14:00' (24h bare) → 14:00", () => {
  assertEquals(extractTimeOnly("14:00"), { hours: 14, minutes: 0 });
});

// ---------- Edge cases & negatives ----------

Deno.test("extractTimeOnly: empty string → null", () => {
  assertEquals(extractTimeOnly(""), null);
});

Deno.test("extractTimeOnly: pure noise → null", () => {
  assertEquals(extractTimeOnly("hello world"), null);
});

Deno.test("extractTimeOnly: invalid HH (25:00) → null", () => {
  // 25 isn't a valid hour. Helper rejects out-of-range values rather
  // than silently mod-ing them, so callers can distinguish "no time
  // found" from "weird user input".
  assertEquals(extractTimeOnly("25:00"), null);
});

Deno.test("extractTimeOnly: invalid MM (8:99) → null", () => {
  assertEquals(extractTimeOnly("8:99"), null);
});

Deno.test("extractTimeOnly: '24:00' coerced to 00:00", () => {
  assertEquals(extractTimeOnly("24:00"), { hours: 0, minutes: 0 });
});

Deno.test("extractTimeOnly: 'alle 24' coerced to 00:00", () => {
  assertEquals(extractTimeOnly("alle 24"), { hours: 0, minutes: 0 });
});

Deno.test("extractTimeOnly: 'in 2 months' does NOT extract '2' as time", () => {
  // Critical regression guard: the count digit "2" must not be
  // mis-extracted as a time. The helper only matches via AM/PM, an
  // explicit time keyword, or a colon — none of which fire here.
  assertEquals(extractTimeOnly("in 2 months"), null);
});

Deno.test("extractTimeOnly: 'tra 30 minuti' does NOT extract '30' as time", () => {
  assertEquals(extractTimeOnly("tra 30 minuti"), null);
});

// ---------- AM/PM beats keyword path when both present ----------

Deno.test("extractTimeOnly: 'at 7 AM' uses AM/PM disambiguator", () => {
  // The AM/PM regex runs first (priority 1), so "at 7 AM" lands at
  // 7:00. If we ran the keyword regex first, "at 7" would also yield
  // 7:00 by 24h interpretation — same answer here, but the priority
  // matters for disambiguating 1–12 hours in en.
  assertEquals(extractTimeOnly("at 7 AM"), { hours: 7, minutes: 0 });
});

Deno.test("extractTimeOnly: 'at 7 PM' (keyword + PM) → 19:00", () => {
  assertEquals(extractTimeOnly("at 7 PM"), { hours: 19, minutes: 0 });
});
