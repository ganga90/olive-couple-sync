// _shared/pattern-detector.ts
//
// Phase 3.5 — pattern learning. Records and reads behavior patterns for
// a user, persisted in olive_user_patterns. Two public entry points:
//
//   - recordReschedulePattern: called by the action executor on every
//     confirmed set_due/set_reminder mutation. Extracts a small set of
//     features from (prior, new) and upserts into the per-user pattern
//     store via the atomic SECURITY-DEFINER RPC.
//
//   - findMatchingPatterns: called by the planner at offer time. Looks
//     up patterns matching the user's proposed action and returns
//     STRONG matches only — confidence-gated so we never surface "I
//     noticed a pattern" until we actually have one (≥3 observations
//     AND ≥50% of observed reschedules of this kind).
//
// The features extracted in v1 are intentionally narrow: weekday shifts
// (Tue→Thu, Mon→Fri, etc.). Future variants (time-of-day shifts,
// duration tweaks) plug in without changing this module's API —
// they're new pattern_type discriminators, recorded via the same RPC.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getTimeZoneParts } from "./timezone-calendar.ts";

export type PatternType = "weekday_shift";

// What we extract from a reschedule. Pure transformation — no IO.
export interface ExtractedFeature {
  pattern_type: PatternType;
  pattern_data: Record<string, unknown>;
  // Stable string fingerprint for the unique index on the DB row. Must
  // include every variable in pattern_data so two patterns that differ
  // by any feature get distinct rows.
  fingerprint: string;
}

// Sunday=0..Saturday=6, matching JS Date.getDay() and our pattern_data.
type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// ─── Feature extraction ──────────────────────────────────────────────

// Extract the pattern features from a prior→new reschedule. Returns the
// list (possibly empty) of patterns this single event reinforces. We
// return an array because future versions may emit multiple
// pattern_types per event (e.g. both a weekday_shift AND a
// time_band_shift).
export function extractFeatures(args: {
  priorIso: string | null;
  newIso: string;
  timezone: string;
}): ExtractedFeature[] {
  if (!args.priorIso) return [];
  const features: ExtractedFeature[] = [];
  const priorDay = dayOfWeekInTz(args.priorIso, args.timezone);
  const newDay = dayOfWeekInTz(args.newIso, args.timezone);
  if (priorDay === null || newDay === null) return [];

  // Only emit weekday_shift if the day actually changed — Tue→Tue is
  // not a pattern (the user adjusted time-of-day, not day-of-week).
  if (priorDay !== newDay) {
    features.push({
      pattern_type: "weekday_shift",
      pattern_data: { from_dow: priorDay, to_dow: newDay },
      fingerprint: `weekday_shift:${priorDay}->${newDay}`,
    });
  }

  return features;
}

// ─── Recording ───────────────────────────────────────────────────────

// Persist every feature extracted from a reschedule. Errors swallow —
// pattern learning is observability-flavored; a failed write should
// never block the user's mutation.
export async function recordReschedulePattern(
  supabase: SupabaseClient,
  args: {
    userId: string;
    priorIso: string | null;
    newIso: string;
    timezone: string;
  },
): Promise<void> {
  const features = extractFeatures({
    priorIso: args.priorIso,
    newIso: args.newIso,
    timezone: args.timezone,
  });
  if (features.length === 0) return;

  for (const f of features) {
    try {
      const { error } = await supabase.rpc("olive_record_user_pattern", {
        p_user_id: args.userId,
        p_pattern_type: f.pattern_type,
        p_pattern_data: f.pattern_data,
        p_fingerprint: f.fingerprint,
      });
      if (error) {
        console.warn("[pattern-detector] record failed (non-fatal):", error.message);
      }
    } catch (err) {
      console.warn(
        "[pattern-detector] record threw (non-fatal):",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// ─── Lookup ──────────────────────────────────────────────────────────

// Confidence thresholds for surfacing. Tuned to "I noticed a pattern"
// being TRUE three out of five times you reschedule that kind of task —
// strong enough to feel intentional, not so strict that brand-new
// users never see one.
const MIN_COUNT = 3;
const MIN_CONFIDENCE = 0.5;

export interface MatchedPattern {
  pattern_type: PatternType;
  pattern_data: Record<string, unknown>;
  count: number;
  confidence: number; // count / total_observations
  last_seen_at: string;
}

// Look up strong patterns matching the user's proposed action. Returns
// at most one match per pattern_type (the highest-confidence row),
// already filtered to MIN_COUNT and MIN_CONFIDENCE. Empty array = no
// strong match.
//
// Why this is read-once-no-cache: the table is tiny per user (≤ a
// handful of rows), the planner runs at offer time which is already a
// multi-query path, and surface-after-stale-read is fine — the worst
// case is "didn't show a hint that just qualified," which is
// harmless. Aggressive caching would create coherence headaches
// without measurable latency win.
export async function findMatchingPatterns(
  supabase: SupabaseClient,
  args: {
    userId: string;
    // The proposed new datetime — we match against patterns whose
    // to_dow equals the proposed day-of-week (in the user's tz). i.e.
    // "user usually moves things TO Thursday" only surfaces when the
    // proposal IS to a Thursday.
    proposedIso: string;
    timezone: string;
  },
): Promise<MatchedPattern[]> {
  const proposedDay = dayOfWeekInTz(args.proposedIso, args.timezone);
  if (proposedDay === null) return [];

  const { data, error } = await supabase
    .from("olive_user_patterns")
    .select("pattern_type, pattern_data, count, total_observations, last_seen_at")
    .eq("user_id", args.userId)
    .eq("pattern_type", "weekday_shift")
    .gte("count", MIN_COUNT)
    .order("count", { ascending: false });

  if (error || !data) return [];

  const matches: MatchedPattern[] = [];
  for (const row of data as Array<Record<string, unknown>>) {
    const pd = row.pattern_data as { from_dow?: number; to_dow?: number };
    // Skip patterns that don't point AT the proposed day. We want to
    // tell the user "you usually do this when moving to <today>", not
    // "you usually do unrelated thing X."
    if (pd?.to_dow !== proposedDay) continue;
    const count = row.count as number;
    const total = (row.total_observations as number) || count;
    const confidence = total > 0 ? count / total : 0;
    if (confidence < MIN_CONFIDENCE) continue;
    matches.push({
      pattern_type: row.pattern_type as PatternType,
      pattern_data: pd as Record<string, unknown>,
      count,
      confidence,
      last_seen_at: row.last_seen_at as string,
    });
  }
  // Cap at 1 — one strong hint per offer keeps copy clean; if a user
  // has multiple patterns hitting the same day, we surface the
  // strongest.
  return matches.slice(0, 1);
}

// ─── Internal ─────────────────────────────────────────────────────────

// Get the day-of-week for an ISO string in the user's timezone. Day-of-
// week is timezone-sensitive — e.g. an 11pm UTC event in Madrid is
// Monday locally but Tuesday in Hawaii — so we never use Date.getDay()
// directly on a UTC ISO; that would silently miscount near midnight.
function dayOfWeekInTz(iso: string, timezone: string): DayOfWeek | null {
  try {
    // Date-only strings ("YYYY-MM-DD" from clerk_notes.due_date) need
    // special handling: `new Date("2026-05-12")` parses as UTC
    // midnight, which is the PREVIOUS day in any negative-offset
    // timezone. due_date is conceptually a calendar date — Tuesday
    // should stay Tuesday regardless of the user's tz. Without this
    // guard, every prior_due_date snapshot fed in by the executor
    // would record the wrong from_dow for all-day tasks.
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
      if (!y || !m || !d) return null;
      const literal = new Date(Date.UTC(y, m - 1, d));
      return literal.getUTCDay() as DayOfWeek;
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = getTimeZoneParts(date, timezone);
    // Build a Date at midnight UTC on the local-clock parts so .getUTCDay()
    // returns the same day-of-week as the user's calendar shows.
    const utcMidnight = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    return utcMidnight.getUTCDay() as DayOfWeek;
  } catch {
    return null;
  }
}

// Exposed for tests; lets them assert behavior without re-implementing
// the timezone-aware day extraction.
export const __FOR_TESTS = {
  dayOfWeekInTz,
  MIN_COUNT,
  MIN_CONFIDENCE,
};
