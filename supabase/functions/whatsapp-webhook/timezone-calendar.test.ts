import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { getRelativeDayWindowUtc, isInUtcRange } from "../_shared/timezone-calendar.ts";

Deno.test("New York late-evening event stays in today's local day", () => {
  const reference = new Date("2026-04-11T23:55:00Z");
  const todayWindow = getRelativeDayWindowUtc(reference, "America/New_York", 0);

  assertEquals(todayWindow.start.toISOString(), "2026-04-11T04:00:00.000Z");
  assertEquals(todayWindow.end.toISOString(), "2026-04-12T04:00:00.000Z");
  assert(isInUtcRange("2026-04-12T00:30:00+00", todayWindow.start, todayWindow.end));
});

Deno.test("DST boundary produces correct shorter local day window", () => {
  const reference = new Date("2026-03-08T15:00:00Z");
  const dayWindow = getRelativeDayWindowUtc(reference, "America/New_York", 0);

  assertEquals(dayWindow.start.toISOString(), "2026-03-08T05:00:00.000Z");
  assertEquals(dayWindow.end.toISOString(), "2026-03-09T04:00:00.000Z");
  assertEquals(dayWindow.end.getTime() - dayWindow.start.getTime(), 23 * 60 * 60 * 1000);
});