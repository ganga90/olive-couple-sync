// _shared/bulk-resolver.ts
//
// Phase 3.2 — resolve a bulk predicate into a list of candidate tasks.
//
// v1 supports one predicate: "weekday" — all incomplete tasks whose
// due_date or reminder_time falls on a given day-of-week in the user's
// timezone. Future predicates (date_range, time_band, list_name) plug
// in alongside the same shape — same resolver entry point, new
// predicate variant.
//
// Day-of-week extraction is intentionally timezone-aware: a task whose
// reminder_time is 23:30 UTC on Tuesday is Tuesday for a NY user, but
// Wednesday for a Sydney user. Pattern-detector.ts has the same
// discipline; we use the same primitive (getTimeZoneParts) so the two
// modules stay aligned.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getTimeZoneParts } from "./timezone-calendar.ts";

export interface BulkTaskCandidate {
  id: string;
  summary: string;
  due_date: string | null;
  reminder_time: string | null;
  // The local-tz day-of-week the task currently sits on. Stored so
  // copy can show "moving 3 Tuesday tasks…" without re-computing.
  current_dow: number;
}

// How many candidates we'll pull before stopping. Bulk operations on
// a huge candidate set (50+ tasks) feel scary; the offer-copy already
// summarizes ≥6, so loading 500 wastes both DB and LLM context.
const MAX_CANDIDATES = 50;

export interface ResolveBulkArgs {
  userId: string;
  spaceId: string | null;
  fromDow: number; // 0..6, Sun..Sat
  timezone: string;
  // Optional limit override — tests use a small value to make
  // pagination behavior assertable without seeding 50 rows.
  limit?: number;
}

// Find all incomplete tasks for the user whose due_date or reminder_time
// falls on the requested day-of-week. Returns an empty array if no
// matches; never throws — caller (planner) bails out on length 0.
export async function resolveWeekdayCandidates(
  supabase: SupabaseClient,
  args: ResolveBulkArgs,
): Promise<BulkTaskCandidate[]> {
  const limit = args.limit ?? MAX_CANDIDATES;
  if (args.fromDow < 0 || args.fromDow > 6) return [];

  // We can't filter day-of-week in the SQL layer without a generated
  // column or a SQL function — Postgres' EXTRACT(DOW) operates on UTC
  // unless we explicitly cast through a tz, which is brittle. So we
  // pull all incomplete tasks with a date and filter in app code.
  // Bounded by limit*4 so the in-app filter doesn't accidentally
  // truncate matches; if a user has thousands of tasks the right fix
  // is paginated bulk, not a bigger fetch here.
  let query = supabase
    .from("clerk_notes")
    .select("id, summary, due_date, reminder_time")
    .eq("completed", false)
    // Some date must be set, otherwise the task has no weekday to
    // match. We don't `.not('due_date', 'is', null)` because
    // reminder_time can also be set. Filter in JS.
    .order("reminder_time", { ascending: true, nullsFirst: false })
    .limit(limit * 4);

  if (args.spaceId) {
    query = query.or(`author_id.eq.${args.userId},space_id.eq.${args.spaceId}`);
  } else {
    query = query.eq("author_id", args.userId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const out: BulkTaskCandidate[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const iso = (row.reminder_time as string) || (row.due_date as string);
    if (!iso) continue;
    const dow = dayOfWeekInTz(iso, args.timezone);
    if (dow === null) continue;
    if (dow !== args.fromDow) continue;
    out.push({
      id: row.id as string,
      summary: (row.summary as string) || "Untitled task",
      due_date: (row.due_date as string) ?? null,
      reminder_time: (row.reminder_time as string) ?? null,
      current_dow: dow,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Shift a task's date to the target day-of-week. Preserves time-of-day
// (in the user's tz) and direction-of-shift: we always move FORWARD
// to the next matching weekday, so "Tuesday → Thursday" on a task
// scheduled for "Tue May 12" becomes "Thu May 14", not "Thu May 7".
// This matches user expectation: "move all my Tuesday tasks to
// Thursday" means "later in the same week," not "earlier."
//
// Returns a new ISO string. Pure / deterministic / DST-aware (uses
// the existing timezone-calendar primitives).
import { toUtcFromLocalParts } from "./timezone-calendar.ts";

export function shiftToWeekday(
  sourceIso: string,
  toDow: number,
  timezone: string,
): string | null {
  const src = new Date(sourceIso);
  if (Number.isNaN(src.getTime())) return null;
  if (toDow < 0 || toDow > 6) return null;
  const localParts = getTimeZoneParts(src, timezone);
  // Build a midnight-UTC date matching the local-tz calendar day, then
  // walk it forward until its UTC-day-of-week matches toDow. The
  // walk uses a max-7 iteration cap so a malformed toDow can't loop.
  let cursor = new Date(Date.UTC(localParts.year, localParts.month - 1, localParts.day));
  let safety = 0;
  while (cursor.getUTCDay() !== toDow && safety < 8) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    safety++;
  }
  if (cursor.getUTCDay() !== toDow) return null;
  // Replace just the date portion of the local parts; keep
  // hour/minute/second. Re-convert via toUtcFromLocalParts so DST
  // changes are honored.
  try {
    const newLocal = {
      ...localParts,
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
    };
    return toUtcFromLocalParts(newLocal, timezone).toISOString();
  } catch {
    return null;
  }
}

// ─── Internal ─────────────────────────────────────────────────────────

function dayOfWeekInTz(iso: string, timezone: string): number | null {
  try {
    // Date-only strings (length === 10, "YYYY-MM-DD") need special
    // handling: `new Date("2026-05-12")` parses as 2026-05-12T00:00Z
    // (UTC midnight), which is the PREVIOUS day in any negative-offset
    // timezone. due_date is conceptually a calendar date — we want
    // "Tuesday" to be Tuesday regardless of the user's tz. So we
    // build the date directly from the literal Y/M/D and return its
    // day-of-week.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, day] = iso.split("-").map((s) => parseInt(s, 10));
      if (!y || !m || !day) return null;
      const literal = new Date(Date.UTC(y, m - 1, day));
      return literal.getUTCDay();
    }
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const parts = getTimeZoneParts(d, timezone);
    const utcMidnight = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return utcMidnight.getUTCDay();
  } catch {
    return null;
  }
}

// Exported for tests so we can assert behavior without spinning up a
// Supabase mock.
export const __FOR_TESTS = {
  MAX_CANDIDATES,
  dayOfWeekInTz,
};
