// Tests for _shared/pattern-detector.ts
// Pure logic (feature extraction, day-of-week-in-tz) tested directly;
// DB-side recording / lookup exercised against a mock client.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __FOR_TESTS,
  extractFeatures,
  findMatchingPatterns,
  recordReschedulePattern,
} from "./pattern-detector.ts";

// ─── Feature extraction ──────────────────────────────────────────────

Deno.test("extractFeatures: Tue → Thu shift → one weekday_shift feature", () => {
  // 2026-05-12 is a Tuesday in UTC. 2026-05-14 is Thursday.
  const f = extractFeatures({
    priorIso: "2026-05-12T15:00:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(f.length, 1);
  assertEquals(f[0].pattern_type, "weekday_shift");
  assertEquals(f[0].pattern_data, { from_dow: 2, to_dow: 4 });
  assertEquals(f[0].fingerprint, "weekday_shift:2->4");
});

Deno.test("extractFeatures: same day-of-week (Tue → Tue) → no pattern", () => {
  // Both Tuesdays — adjusting time-of-day shouldn't fire a weekday shift.
  const f = extractFeatures({
    priorIso: "2026-05-12T15:00:00Z",
    newIso: "2026-05-19T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(f, []);
});

Deno.test("extractFeatures: no prior date → no patterns", () => {
  const f = extractFeatures({
    priorIso: null,
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(f, []);
});

Deno.test("extractFeatures: malformed prior → no patterns", () => {
  const f = extractFeatures({
    priorIso: "not-a-date",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(f, []);
});

Deno.test("extractFeatures: timezone affects day-of-week classification", () => {
  // 2026-05-12T23:30:00Z is Tuesday 19:30 in NY (still Tue), but
  // already Wednesday 09:30 in Sydney (UTC+10 AEST). Similarly
  // 2026-05-14T15:00:00Z is Thursday 11:00 in NY but Friday 01:00 in
  // Sydney. So the SAME pair of UTC instants is "Tue→Thu" for the NY
  // user and "Wed→Fri" for the Sydney user — that's the whole point
  // of running day-of-week extraction in the user's timezone.
  const ny = extractFeatures({
    priorIso: "2026-05-12T23:30:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(ny[0]?.pattern_data, { from_dow: 2, to_dow: 4 });

  const syd = extractFeatures({
    priorIso: "2026-05-12T23:30:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "Australia/Sydney",
  });
  assertEquals(syd[0]?.pattern_data, { from_dow: 3, to_dow: 5 });
});

Deno.test("extractFeatures: date-only anchor (due_date YYYY-MM-DD) stays on the correct local day", () => {
  // Phase 3.2 sister fix: `new Date("2026-05-12")` parses as UTC
  // midnight, which is Monday May 11 in any negative-offset timezone.
  // Pattern recording would silently capture from_dow=1 instead of 2
  // every time an all-day Tuesday task was rescheduled by a NY user.
  // This test pins the fix so the same bug can't regress.
  const f = extractFeatures({
    priorIso: "2026-05-12",          // Tuesday (all-day)
    newIso: "2026-05-14",            // Thursday (all-day)
    timezone: "America/New_York",
  });
  assertEquals(f.length, 1);
  assertEquals(f[0].pattern_data, { from_dow: 2, to_dow: 4 });
});

Deno.test("extractFeatures: fingerprint is stable + deterministic", () => {
  const a = extractFeatures({
    priorIso: "2026-05-12T15:00:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  const b = extractFeatures({
    priorIso: "2026-05-19T15:00:00Z", // different Tue
    newIso: "2026-05-21T15:00:00Z",   // different Thu
    timezone: "America/New_York",
  });
  // Different dates, same shift → same fingerprint
  assertEquals(a[0].fingerprint, b[0].fingerprint);
});

// ─── Confidence thresholds ────────────────────────────────────────────

Deno.test("MIN_COUNT and MIN_CONFIDENCE thresholds are set conservatively", () => {
  // Pinned so we know what surface bar we're committing to:
  // - At least 3 observations of the SPECIFIC pattern
  // - At least 50% of total reschedules match
  // Together these prevent surfacing on a single accidental reschedule.
  assertEquals(__FOR_TESTS.MIN_COUNT, 3);
  assertEquals(__FOR_TESTS.MIN_CONFIDENCE, 0.5);
});

// ─── findMatchingPatterns (DB via mock) ──────────────────────────────

interface PatternRow {
  pattern_type: string;
  pattern_data: Record<string, unknown>;
  count: number;
  total_observations: number;
  last_seen_at: string;
}

function makeSupabaseStub(rows: PatternRow[]) {
  return {
    from(_t: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        order: () => Promise.resolve({ data: rows, error: null }),
      };
      return chain;
    },
    rpc(_fn: string, _args: unknown) {
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
}

Deno.test("findMatchingPatterns: proposed Thursday + Tue→Thu pattern → match", () => {
  const stub = makeSupabaseStub([
    {
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: 2, to_dow: 4 },
      count: 5,
      total_observations: 8,
      last_seen_at: new Date().toISOString(),
    },
  ]);
  // Proposing a Thursday (2026-05-14)
  return findMatchingPatterns(stub, {
    userId: "u1",
    proposedIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  }).then((m) => {
    assertEquals(m.length, 1);
    assertEquals(m[0].pattern_data, { from_dow: 2, to_dow: 4 });
    // 5/8 = 0.625 — above the 0.5 threshold
    assert(m[0].confidence > 0.6);
  });
});

Deno.test("findMatchingPatterns: proposed Wednesday + Tue→Thu pattern → no match (wrong target day)", async () => {
  const stub = makeSupabaseStub([
    {
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: 2, to_dow: 4 },
      count: 5,
      total_observations: 8,
      last_seen_at: new Date().toISOString(),
    },
  ]);
  // 2026-05-13 is a Wednesday
  const m = await findMatchingPatterns(stub, {
    userId: "u1",
    proposedIso: "2026-05-13T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(m.length, 0);
});

Deno.test("findMatchingPatterns: low confidence (count high but ratio < 0.5) → no match", async () => {
  const stub = makeSupabaseStub([
    {
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: 2, to_dow: 4 },
      count: 3,
      total_observations: 20, // 3/20 = 0.15 — too noisy
      last_seen_at: new Date().toISOString(),
    },
  ]);
  const m = await findMatchingPatterns(stub, {
    userId: "u1",
    proposedIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(m.length, 0);
});

Deno.test("findMatchingPatterns: caps at 1 hint per call", async () => {
  // Two patterns both pointing at the proposed Thursday — the lookup
  // should surface only the strongest. (DB ORDER BY count handles
  // ranking; we just verify the cap.)
  const stub = makeSupabaseStub([
    {
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: 2, to_dow: 4 },
      count: 6,
      total_observations: 8,
      last_seen_at: new Date().toISOString(),
    },
    {
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: 1, to_dow: 4 },
      count: 4,
      total_observations: 8,
      last_seen_at: new Date().toISOString(),
    },
  ]);
  const m = await findMatchingPatterns(stub, {
    userId: "u1",
    proposedIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(m.length, 1);
});

// ─── recordReschedulePattern (RPC via mock) ──────────────────────────

Deno.test("recordReschedulePattern: calls the RPC with extracted fingerprint", async () => {
  const captured: { rpcArgs?: Record<string, unknown> } = {};
  const stub = {
    rpc(fn: string, args: Record<string, unknown>) {
      captured.rpcArgs = { fn, ...args };
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
  await recordReschedulePattern(stub, {
    userId: "u1",
    priorIso: "2026-05-12T15:00:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(captured.rpcArgs?.fn, "olive_record_user_pattern");
  assertEquals(captured.rpcArgs?.p_user_id, "u1");
  assertEquals(captured.rpcArgs?.p_pattern_type, "weekday_shift");
  assertEquals(captured.rpcArgs?.p_fingerprint, "weekday_shift:2->4");
});

Deno.test("recordReschedulePattern: same-day-of-week event → no RPC call", async () => {
  let called = 0;
  const stub = {
    rpc() {
      called++;
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
  await recordReschedulePattern(stub, {
    userId: "u1",
    priorIso: "2026-05-12T15:00:00Z", // Tue
    newIso: "2026-05-12T18:00:00Z",   // same Tue, different time
    timezone: "America/New_York",
  });
  assertEquals(called, 0);
});

Deno.test("recordReschedulePattern: RPC error is swallowed", async () => {
  const stub = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "boom" } });
    },
  } as never;
  // Should not throw despite the RPC error.
  await recordReschedulePattern(stub, {
    userId: "u1",
    priorIso: "2026-05-12T15:00:00Z",
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
});

Deno.test("recordReschedulePattern: no prior → no RPC call", async () => {
  let called = 0;
  const stub = {
    rpc() {
      called++;
      return Promise.resolve({ data: null, error: null });
    },
  } as never;
  await recordReschedulePattern(stub, {
    userId: "u1",
    priorIso: null,
    newIso: "2026-05-14T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(called, 0);
});
