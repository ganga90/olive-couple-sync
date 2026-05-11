// _shared/conflict-detector.ts
//
// Phase 3.1 — surface calendar conflicts at offer time.
//
// Before Olive confirms a reschedule, she scans the user's local
// `calendar_events` mirror (populated by calendar-sync from Google) for
// events overlapping the proposed window. The result is attached to the
// PendingOffer and surfaced in the offer line so the user sees the
// conflict BEFORE confirming, not after.
//
// This is one of the moats: an LLM-driven assistant that proposes
// changes WITHOUT visibility into the user's actual calendar will
// always feel naïve. Olive has the calendar mirror and the offer loop —
// surfacing conflicts at offer time is the highest-leverage way to use
// both together.
//
// Pure DB scan — no Google API calls. The local mirror is "good
// enough"; calendar-sync runs on a 15-minute cadence in production. For
// a v1 conflict warning, that's well within the resolution users care
// about (you don't reschedule something to a slot that conflicts with
// a meeting added 5 minutes ago).
//
// Graceful degradation: users without a connected calendar get an
// empty array — no conflicts, no warning, no error.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type ConflictSeverity = "overlap" | "adjacent";

export interface ConflictSummary {
  // calendar_events.id
  id: string;
  // Event title (calendar_events.title)
  title: string;
  // Start time as ISO (always populated; for all-day events this is
  // 00:00 UTC of the day in the event's timezone)
  start_time: string;
  end_time: string;
  all_day: boolean;
  // calendar_events.note_id — present when this event was created from
  // an Olive note. Lets future UX deep-link the conflict.
  note_id: string | null;
  // Minutes of overlap with the proposed window. Negative for adjacent
  // events (back-to-back). Useful for ordering and copy decisions.
  overlap_minutes: number;
  // 'overlap': the events share time. 'adjacent': within ADJACENCY_MIN
  // minutes before/after the proposed window. We surface adjacents
  // sparingly (only when there are no real overlaps).
  severity: ConflictSeverity;
}

export interface FindConflictsArgs {
  userId: string;
  proposedStart: string; // ISO
  proposedEnd: string;   // ISO
  // Treats the proposed window as an all-day event (start-of-day to
  // end-of-day in local timezone). When set, we use a wider scan window
  // so other events on the same day get flagged.
  proposedAllDay?: boolean;
  // Exclude this note's linked event from the result — otherwise moving
  // a note from Tue→Thu would flag "you have Visit Apartment on Thu"
  // (it's the same event we just rescheduled).
  excludeNoteId?: string;
  // How many minutes before/after the window to consider as adjacent
  // for back-to-back detection. Default 15.
  adjacencyMinutes?: number;
  // Cap conflicts in the response. Default 5 — copy can show up to 3
  // and summarize the rest.
  limit?: number;
}

const DEFAULT_ADJACENCY_MIN = 15;
const DEFAULT_LIMIT = 5;

export async function findConflicts(
  supabase: SupabaseClient,
  args: FindConflictsArgs,
): Promise<ConflictSummary[]> {
  const adjacency = args.adjacencyMinutes ?? DEFAULT_ADJACENCY_MIN;
  const limit = args.limit ?? DEFAULT_LIMIT;

  // Resolve the user's active calendar connection. Without one, the
  // mirror is empty and there's nothing to scan.
  const { data: conn } = await supabase
    .from("calendar_connections")
    .select("id")
    .eq("user_id", args.userId)
    .eq("is_active", true)
    .maybeSingle();

  if (!conn?.id) return [];

  // Define the scan window. For timed proposals: [start - adjacency,
  // end + adjacency]. For all-day proposals: same day's full window.
  const scanStart = new Date(args.proposedStart);
  const scanEnd = new Date(args.proposedEnd);
  if (args.proposedAllDay) {
    // Stretch to the whole day so other events on the day get caught.
    scanStart.setUTCHours(0, 0, 0, 0);
    scanEnd.setUTCHours(23, 59, 59, 999);
  } else {
    scanStart.setMinutes(scanStart.getMinutes() - adjacency);
    scanEnd.setMinutes(scanEnd.getMinutes() + adjacency);
  }

  // Standard interval-overlap predicate: [a, b] overlaps [c, d] iff
  // a < d AND b > c. Pull a small batch (limit * 4) to leave headroom
  // for the self-exclusion + ranking step before truncating.
  let query = supabase
    .from("calendar_events")
    .select("id, title, start_time, end_time, all_day, note_id")
    .eq("connection_id", conn.id)
    .lt("start_time", scanEnd.toISOString())
    .gt("end_time", scanStart.toISOString())
    .order("start_time", { ascending: true })
    .limit(limit * 4);

  if (args.excludeNoteId) {
    query = query.neq("note_id", args.excludeNoteId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  const proposedStartMs = new Date(args.proposedStart).getTime();
  const proposedEndMs = new Date(args.proposedEnd).getTime();
  const adjacencyMs = adjacency * 60 * 1000;

  const conflicts: ConflictSummary[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const startMs = new Date(row.start_time as string).getTime();
    const endMs = new Date(row.end_time as string).getTime();

    // Compute overlap (in minutes). Negative means adjacent
    // (no time-shared, but within the adjacency window).
    const overlapStart = Math.max(startMs, proposedStartMs);
    const overlapEnd = Math.min(endMs, proposedEndMs);
    const overlapMs = overlapEnd - overlapStart;

    let severity: ConflictSeverity;
    let overlapMinutes: number;
    if (overlapMs > 0) {
      severity = "overlap";
      overlapMinutes = Math.round(overlapMs / 60000);
    } else {
      // Adjacent — measure gap between events. Negative number = gap.
      const gapMs = Math.min(
        Math.abs(startMs - proposedEndMs),
        Math.abs(endMs - proposedStartMs),
      );
      if (gapMs > adjacencyMs) continue; // outside adjacency window
      severity = "adjacent";
      overlapMinutes = -Math.round(gapMs / 60000);
    }

    conflicts.push({
      id: row.id as string,
      title: (row.title as string) || "Untitled event",
      start_time: row.start_time as string,
      end_time: row.end_time as string,
      all_day: !!row.all_day,
      note_id: (row.note_id as string | null) ?? null,
      overlap_minutes: overlapMinutes,
      severity,
    });
  }

  // Rank: overlaps before adjacents, then by start time. If we ended up
  // with too many overlaps, drop adjacents entirely — they're noise
  // when the user already has a real conflict to address.
  const overlaps = conflicts.filter((c) => c.severity === "overlap");
  const adjacents = conflicts.filter((c) => c.severity === "adjacent");
  const ranked = overlaps.length > 0
    ? overlaps.slice(0, limit)
    : adjacents.slice(0, limit);

  return ranked;
}

// ─── Pure overlap helpers (exported for tests) ────────────────────────

// Compute overlap minutes between two windows. Positive = real overlap.
// Negative = gap (adjacency). Zero = exactly back-to-back.
export function computeOverlapMinutes(
  aStartIso: string,
  aEndIso: string,
  bStartIso: string,
  bEndIso: string,
): number {
  const aStart = new Date(aStartIso).getTime();
  const aEnd = new Date(aEndIso).getTime();
  const bStart = new Date(bStartIso).getTime();
  const bEnd = new Date(bEndIso).getTime();
  const overlapMs = Math.min(aEnd, bEnd) - Math.max(aStart, bStart);
  return Math.round(overlapMs / 60000);
}

// Return true if two windows overlap by any positive amount.
export function windowsOverlap(
  aStartIso: string,
  aEndIso: string,
  bStartIso: string,
  bEndIso: string,
): boolean {
  return computeOverlapMinutes(aStartIso, aEndIso, bStartIso, bEndIso) > 0;
}
