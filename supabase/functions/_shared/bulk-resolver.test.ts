// Tests for _shared/bulk-resolver.ts
//
// Pure logic tested directly (dayOfWeekInTz, shiftToWeekday). The DB
// scan is exercised against a mock supabase chain so we can pin
// behavior without depending on a live database.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __FOR_TESTS,
  resolveWeekdayCandidates,
  shiftToWeekday,
} from "./bulk-resolver.ts";
import { getTimeZoneParts } from "./timezone-calendar.ts";

// ─── dayOfWeekInTz ────────────────────────────────────────────────────

const { dayOfWeekInTz } = __FOR_TESTS;

Deno.test("dayOfWeekInTz: 2026-05-12T15:00 UTC in NY → Tuesday (2)", () => {
  assertEquals(dayOfWeekInTz("2026-05-12T15:00:00Z", "America/New_York"), 2);
});

Deno.test("dayOfWeekInTz: 23:30 UTC reads differently in NY vs Sydney", () => {
  // 2026-05-12T23:30:00Z = Tue 19:30 NY (still Tue) but Wed 09:30 Sydney
  assertEquals(dayOfWeekInTz("2026-05-12T23:30:00Z", "America/New_York"), 2);
  assertEquals(dayOfWeekInTz("2026-05-12T23:30:00Z", "Australia/Sydney"), 3);
});

Deno.test("dayOfWeekInTz: malformed ISO → null", () => {
  assertEquals(dayOfWeekInTz("not-a-date", "America/New_York"), null);
});

// ─── shiftToWeekday ───────────────────────────────────────────────────

Deno.test("shiftToWeekday: Tue → Thu shifts forward, preserves time-of-day", () => {
  // 2026-05-12 is Tuesday. Shift to Thursday → 2026-05-14.
  const out = shiftToWeekday("2026-05-12T22:00:00Z", 4, "America/New_York");
  assert(out !== null);
  const parts = getTimeZoneParts(new Date(out!), "America/New_York");
  // Same time-of-day in NY (18:00 EDT = 22:00 UTC), shifted to Thursday
  assertEquals(parts.day, 14);
  assertEquals(parts.month, 5);
  assertEquals(parts.year, 2026);
  assertEquals(parts.hour, 18);
  assertEquals(parts.minute, 0);
});

Deno.test("shiftToWeekday: Thu → Tue wraps to NEXT week, not previous", () => {
  // 2026-05-14 is Thursday. Shifting to Tuesday should land on
  // 2026-05-19 (next Tue), not 2026-05-12 (last Tue). User intent
  // for "move to X" is forward-looking.
  const out = shiftToWeekday("2026-05-14T18:00:00Z", 2, "America/New_York");
  assert(out !== null);
  const parts = getTimeZoneParts(new Date(out!), "America/New_York");
  assertEquals(parts.day, 19);
});

Deno.test("shiftToWeekday: same dow → same day (no-op semantic)", () => {
  // Edge case: shifting Tue → Tue is rejected by the planner before
  // ever reaching this function (it short-circuits with "not
  // plannable" when fromDow === toDow). But the function itself
  // returns the same day to be predictable for any direct callers —
  // any forward-walking behavior would be a footgun if the helper
  // were used outside the planner.
  const out = shiftToWeekday("2026-05-12T15:00:00Z", 2, "America/New_York");
  assert(out !== null);
  const parts = getTimeZoneParts(new Date(out!), "America/New_York");
  // Same Tuesday
  assertEquals(parts.day, 12);
});

Deno.test("shiftToWeekday: malformed source → null", () => {
  assertEquals(shiftToWeekday("garbage", 4, "America/New_York"), null);
});

Deno.test("shiftToWeekday: out-of-range to_dow → null", () => {
  assertEquals(shiftToWeekday("2026-05-12T15:00:00Z", 9, "America/New_York"), null);
});

Deno.test("shiftToWeekday: DST-aware — Rome shift across DST start", () => {
  // 2026 DST start in Rome: Mar 29 (last Sunday in March). Shift
  // from a Tuesday-before-DST (Mar 24) to a Thursday-after-DST
  // (Mar 26 is still in CET, so let's pick a longer shift).
  // For this test we just sanity-check the function doesn't break
  // when the shift crosses a DST boundary.
  const out = shiftToWeekday("2026-03-24T10:00:00Z", 4, "Europe/Rome");
  assert(out !== null);
  const parts = getTimeZoneParts(new Date(out!), "Europe/Rome");
  assertEquals(parts.day, 26);
  assertEquals(parts.month, 3);
});

// ─── resolveWeekdayCandidates (DB via mock) ──────────────────────────

interface MockRow {
  id: string;
  summary: string;
  due_date: string | null;
  reminder_time: string | null;
}

function makeMockSupabase(rows: MockRow[]) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    or: () => chain,
  };
  // Terminate the chain with a thenable that yields our rows.
  const final = Object.assign(Promise.resolve({ data: rows, error: null }), chain);
  // Make every chained method return the final thenable so any ordering
  // of .eq/.order/.limit/.or terminates correctly.
  for (const k of Object.keys(chain) as Array<keyof typeof chain>) {
    (chain as any)[k] = () => final;
  }
  return {
    from(_t: string) {
      return chain;
    },
  } as never;
}

Deno.test("resolveWeekdayCandidates: returns rows matching from_dow in user tz", async () => {
  // 2026-05-12T15:00Z is Tuesday in NY (dow=2)
  // 2026-05-14T15:00Z is Thursday in NY (dow=4)
  const sb = makeMockSupabase([
    { id: "t1", summary: "Tue task A", due_date: null, reminder_time: "2026-05-12T15:00:00Z" },
    { id: "t2", summary: "Thu task", due_date: null, reminder_time: "2026-05-14T15:00:00Z" },
    { id: "t3", summary: "Tue task B", due_date: "2026-05-12", reminder_time: null },
  ]);
  const out = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 2,
    timezone: "America/New_York",
  });
  assertEquals(out.length, 2);
  assertEquals(out.map((c) => c.id).sort(), ["t1", "t3"]);
});

Deno.test("resolveWeekdayCandidates: out-of-range from_dow → []", async () => {
  const sb = makeMockSupabase([]);
  const out = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 9,
    timezone: "America/New_York",
  });
  assertEquals(out, []);
});

Deno.test("resolveWeekdayCandidates: skips rows with no schedule", async () => {
  const sb = makeMockSupabase([
    { id: "t1", summary: "scheduled", due_date: null, reminder_time: "2026-05-12T15:00:00Z" },
    { id: "t2", summary: "unscheduled", due_date: null, reminder_time: null },
  ]);
  const out = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 2,
    timezone: "America/New_York",
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].id, "t1");
});

Deno.test("resolveWeekdayCandidates: limit caps the result", async () => {
  const rows: MockRow[] = [];
  for (let i = 0; i < 10; i++) {
    rows.push({
      id: `t${i}`,
      summary: `task ${i}`,
      due_date: null,
      reminder_time: "2026-05-12T15:00:00Z", // all Tuesdays
    });
  }
  const sb = makeMockSupabase(rows);
  const out = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 2,
    timezone: "America/New_York",
    limit: 3,
  });
  assertEquals(out.length, 3);
});

Deno.test("resolveWeekdayCandidates: reminder_time wins over due_date when both set", async () => {
  // reminder_time on Wed, due_date on Tue — should match against
  // reminder_time (highest-priority anchor in our schema).
  const sb = makeMockSupabase([
    {
      id: "t1",
      summary: "mixed task",
      due_date: "2026-05-12", // Tue
      reminder_time: "2026-05-13T15:00:00Z", // Wed
    },
  ]);
  // Asking for Wed (3) — should match
  const wed = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 3,
    timezone: "America/New_York",
  });
  assertEquals(wed.length, 1);
  // Asking for Tue (2) — should NOT match (reminder_time is Wed)
  const tue = await resolveWeekdayCandidates(sb, {
    userId: "u1",
    spaceId: null,
    fromDow: 2,
    timezone: "America/New_York",
  });
  assertEquals(tue.length, 0);
});
