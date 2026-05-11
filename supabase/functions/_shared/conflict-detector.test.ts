// Tests for _shared/conflict-detector.ts
//
// The DB-side scan is exercised against a mock Supabase client that
// returns pre-canned rows; the conflict-classification logic on top is
// pure and is what these tests pin down. Real-DB integration is
// covered by edge-function smoke tests.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeOverlapMinutes,
  findConflicts,
  windowsOverlap,
} from "./conflict-detector.ts";

// ─── Pure overlap helpers ─────────────────────────────────────────────

Deno.test("computeOverlapMinutes: full overlap (identical windows)", () => {
  const m = computeOverlapMinutes(
    "2026-05-14T18:00:00Z",
    "2026-05-14T19:00:00Z",
    "2026-05-14T18:00:00Z",
    "2026-05-14T19:00:00Z",
  );
  assertEquals(m, 60);
});

Deno.test("computeOverlapMinutes: partial overlap", () => {
  // A: 18:00–19:00, B: 18:30–19:30 → 30min overlap
  const m = computeOverlapMinutes(
    "2026-05-14T18:00:00Z",
    "2026-05-14T19:00:00Z",
    "2026-05-14T18:30:00Z",
    "2026-05-14T19:30:00Z",
  );
  assertEquals(m, 30);
});

Deno.test("computeOverlapMinutes: no overlap → negative (gap)", () => {
  // A: 18:00–19:00, B: 19:30–20:30 → gap of 30 min
  const m = computeOverlapMinutes(
    "2026-05-14T18:00:00Z",
    "2026-05-14T19:00:00Z",
    "2026-05-14T19:30:00Z",
    "2026-05-14T20:30:00Z",
  );
  assertEquals(m, -30);
});

Deno.test("computeOverlapMinutes: back-to-back → 0", () => {
  const m = computeOverlapMinutes(
    "2026-05-14T18:00:00Z",
    "2026-05-14T19:00:00Z",
    "2026-05-14T19:00:00Z",
    "2026-05-14T20:00:00Z",
  );
  assertEquals(m, 0);
});

Deno.test("windowsOverlap: true for overlapping, false for adjacent", () => {
  assertEquals(
    windowsOverlap(
      "2026-05-14T18:00:00Z", "2026-05-14T19:00:00Z",
      "2026-05-14T18:30:00Z", "2026-05-14T19:30:00Z",
    ),
    true,
  );
  // back-to-back is not "overlap" (zero overlap, treated as adjacent)
  assertEquals(
    windowsOverlap(
      "2026-05-14T18:00:00Z", "2026-05-14T19:00:00Z",
      "2026-05-14T19:00:00Z", "2026-05-14T20:00:00Z",
    ),
    false,
  );
});

// ─── findConflicts (DB integration via mock) ──────────────────────────

interface MockEvent {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  note_id: string | null;
}

function makeMockSupabase(args: {
  hasConnection: boolean;
  events: MockEvent[];
  // captured filters so tests can verify the query shape
  filters?: { excludeNoteId?: string };
}) {
  return {
    from(table: string) {
      if (table === "calendar_connections") {
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  eq(_col2: string, _val2: unknown) {
                    return {
                      maybeSingle() {
                        return Promise.resolve({
                          data: args.hasConnection ? { id: "conn-1" } : null,
                          error: null,
                        });
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "calendar_events") {
        // Build a fluent chain that ends in a thenable: .eq().lt().gt().order().limit()
        // and optionally .neq() before .order() if excludeNoteId is provided.
        const chainable = (data: MockEvent[]) => {
          const result = { data, error: null };
          const thenable = Object.assign(Promise.resolve(result), {
            order: () => thenable,
            limit: () => thenable,
            neq: (_col: string, val: string) => {
              if (args.filters) args.filters.excludeNoteId = val;
              return chainable(data.filter((e) => e.note_id !== val));
            },
          });
          return thenable as unknown as ReturnType<typeof Promise.resolve>;
        };
        return {
          select(_cols: string) {
            return {
              eq(_col: string, _val: unknown) {
                return {
                  lt(_col2: string, _val2: unknown) {
                    return {
                      gt(_col3: string, _val3: unknown) {
                        return chainable(args.events);
                      },
                    };
                  },
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as never;
}

Deno.test("findConflicts: no calendar connection → empty array", async () => {
  const sb = makeMockSupabase({ hasConnection: false, events: [] });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
  });
  assertEquals(r, []);
});

Deno.test("findConflicts: one timed overlap → severity='overlap', accurate minutes", async () => {
  const sb = makeMockSupabase({
    hasConnection: true,
    events: [
      {
        id: "e1",
        title: "Dinner with Sara",
        start_time: "2026-05-14T18:30:00Z",
        end_time: "2026-05-14T19:30:00Z",
        all_day: false,
        note_id: null,
      },
    ],
  });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
  });
  assertEquals(r.length, 1);
  assertEquals(r[0].title, "Dinner with Sara");
  assertEquals(r[0].severity, "overlap");
  assertEquals(r[0].overlap_minutes, 30);
});

Deno.test("findConflicts: all-day event flagged for same-day timed proposal", async () => {
  const sb = makeMockSupabase({
    hasConnection: true,
    events: [
      {
        id: "e1",
        title: "Off-site planning",
        // All-day event spans the whole day
        start_time: "2026-05-14T00:00:00Z",
        end_time: "2026-05-15T00:00:00Z",
        all_day: true,
        note_id: null,
      },
    ],
  });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
  });
  assertEquals(r.length, 1);
  assertEquals(r[0].all_day, true);
  assertEquals(r[0].severity, "overlap");
});

Deno.test("findConflicts: excludeNoteId filters self-conflict", async () => {
  const filters: { excludeNoteId?: string } = {};
  const sb = makeMockSupabase({
    hasConnection: true,
    events: [
      // This event IS the one being moved — should be filtered out
      {
        id: "e-self",
        title: "Visit apartment",
        start_time: "2026-05-14T18:00:00Z",
        end_time: "2026-05-14T19:00:00Z",
        all_day: false,
        note_id: "note-being-moved",
      },
    ],
    filters,
  });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
    excludeNoteId: "note-being-moved",
  });
  assertEquals(r.length, 0);
  assertEquals(filters.excludeNoteId, "note-being-moved");
});

Deno.test("findConflicts: no events in window → empty", async () => {
  const sb = makeMockSupabase({ hasConnection: true, events: [] });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
  });
  assertEquals(r, []);
});

Deno.test("findConflicts: real overlaps suppress adjacents", async () => {
  // A real overlap and a back-to-back event. The real overlap should
  // dominate the result; the adjacent should be hidden so the user
  // isn't distracted by a less-important neighbor.
  const sb = makeMockSupabase({
    hasConnection: true,
    events: [
      {
        id: "overlap-e",
        title: "Conflict A",
        start_time: "2026-05-14T18:30:00Z",
        end_time: "2026-05-14T19:30:00Z",
        all_day: false,
        note_id: null,
      },
      {
        id: "adj-e",
        title: "Right after",
        start_time: "2026-05-14T19:05:00Z", // 5 min after proposed end
        end_time: "2026-05-14T20:00:00Z",
        all_day: false,
        note_id: null,
      },
    ],
  });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
  });
  // Both are returned by the SQL filter (both fall within scan window),
  // but our ranking promotes overlaps and drops adjacents.
  assert(r.every((c) => c.severity === "overlap"));
});

Deno.test("findConflicts: limit caps results", async () => {
  const events: MockEvent[] = [];
  for (let i = 0; i < 8; i++) {
    events.push({
      id: `e${i}`,
      title: `Event ${i}`,
      start_time: `2026-05-14T18:${String(i * 5).padStart(2, "0")}:00Z`,
      end_time: `2026-05-14T18:${String(i * 5 + 30).padStart(2, "0")}:00Z`,
      all_day: false,
      note_id: null,
    });
  }
  const sb = makeMockSupabase({ hasConnection: true, events });
  const r = await findConflicts(sb, {
    userId: "u1",
    proposedStart: "2026-05-14T18:00:00Z",
    proposedEnd: "2026-05-14T19:00:00Z",
    limit: 3,
  });
  assertEquals(r.length, 3);
});
