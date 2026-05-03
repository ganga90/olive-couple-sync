/**
 * Phase D-1.a — pure clustering function
 * ============================================================================
 * Groups a flat list of ReflectionRow into ReflectionCluster, one per
 * action_type. Computes outcome distribution, modify_reject_rate,
 * avg_confidence, sample modifications, and a composite significance
 * score for ordering.
 *
 * Pure: no I/O, no clock, deterministic for the same input. Fully
 * unit-testable.
 *
 * Significance heuristic (V1):
 *
 *     significance =
 *       0.60 * modify_reject_rate           # corrective signal
 *     + 0.30 * volume_factor                # scale, log-clamped
 *     + 0.10 * avg_confidence               # source quality
 *
 *   where volume_factor = min(log10(total + 1) / log10(51), 1)
 *
 * volume_factor saturates at total >= 50 (above that, more volume
 * doesn't make the cluster more interesting). Below 5, it's already
 * filtered out by the threshold gate, but if a caller bypasses the
 * gate the score won't blow up.
 */

import type {
  ModificationSample,
  ReflectionCluster,
  ReflectionOutcome,
  ReflectionRow,
} from "./types.ts";

const VOLUME_SATURATION = 50; // total reflections beyond which volume_factor saturates
const SAMPLE_LIMIT = 10; // max modification samples per cluster

const ALL_OUTCOMES: ReflectionOutcome[] = ["accepted", "modified", "rejected", "ignored"];

function emptyOutcomeMap(): Record<ReflectionOutcome, number> {
  return { accepted: 0, modified: 0, rejected: 0, ignored: 0 };
}

function computeVolumeFactor(total: number): number {
  if (total <= 0) return 0;
  // log10(50 + 1) ≈ 1.708 — used as the saturation denominator
  const numerator = Math.log10(total + 1);
  const denominator = Math.log10(VOLUME_SATURATION + 1);
  return Math.min(numerator / denominator, 1);
}

function computeSignificance(
  modify_reject_rate: number,
  total: number,
  avg_confidence: number,
): number {
  return (
    0.60 * modify_reject_rate +
    0.30 * computeVolumeFactor(total) +
    0.10 * avg_confidence
  );
}

/**
 * Extract modification samples from a cluster. Prefers reflections
 * that have non-null `user_modification` AND `lesson` (richest signal),
 * falls back to whatever's available. Capped at SAMPLE_LIMIT.
 */
function pickSamples(rows: ReflectionRow[]): ModificationSample[] {
  // Sort: rich samples first (both user_modification and lesson present),
  // then by confidence descending. Stable secondary by created_at desc.
  const scored = rows.map((r) => {
    const hasModification = r.user_modification !== null && r.user_modification !== "";
    const hasLesson = r.lesson !== null && r.lesson !== "";
    const richness = (hasModification ? 2 : 0) + (hasLesson ? 1 : 0);
    return { row: r, richness };
  });

  scored.sort((a, b) => {
    if (b.richness !== a.richness) return b.richness - a.richness;
    if (b.row.confidence !== a.row.confidence) return b.row.confidence - a.row.confidence;
    return b.row.created_at.localeCompare(a.row.created_at);
  });

  const out: ModificationSample[] = [];
  for (const { row } of scored) {
    if (out.length >= SAMPLE_LIMIT) break;
    // Only include samples with at least *some* signal — pure 'ignored'
    // rows with no modification or lesson contribute no learning material
    // to the proposal generator and just inflate token cost.
    const hasAnyText = (row.user_modification && row.user_modification.length > 0) ||
      (row.lesson && row.lesson.length > 0);
    if (!hasAnyText) continue;

    // Try to extract `from_category`/`to_category` from action_detail when
    // user_modification is just a single category string (the C-1.b trigger
    // shape). This makes samples self-explanatory.
    const detail = row.action_detail as Record<string, unknown> | null;
    const from = (detail?.from_category as string) || row.user_modification;
    const to = (detail?.to_category as string) || null;

    out.push({
      from: from ?? null,
      to: to ?? null,
      lesson: row.lesson,
    });
  }
  return out;
}

/**
 * Cluster reflections by action_type. Returns one cluster per group,
 * sorted by significance descending so callers can iterate from
 * highest-signal to lowest.
 *
 * Empty input → empty output.
 */
export function clusterReflections(
  reflections: ReflectionRow[],
): ReflectionCluster[] {
  if (!reflections || reflections.length === 0) return [];

  // Group by action_type
  const groups = new Map<string, ReflectionRow[]>();
  for (const r of reflections) {
    const key = r.action_type;
    const list = groups.get(key);
    if (list) {
      list.push(r);
    } else {
      groups.set(key, [r]);
    }
  }

  const clusters: ReflectionCluster[] = [];
  for (const [action_type, rows] of groups) {
    const total = rows.length;
    const byOutcome = emptyOutcomeMap();
    let confidenceSum = 0;
    for (const r of rows) {
      if (ALL_OUTCOMES.includes(r.outcome)) {
        byOutcome[r.outcome]++;
      }
      // Defensive clamp — schema allows 0..1 but tests may inject anything
      const c = Math.max(0, Math.min(1, Number(r.confidence) || 0));
      confidenceSum += c;
    }

    const avg_confidence = total > 0 ? confidenceSum / total : 0;
    const modify_reject_rate =
      total > 0 ? (byOutcome.modified + byOutcome.rejected) / total : 0;

    clusters.push({
      action_type,
      total,
      by_outcome: byOutcome,
      modify_reject_rate,
      avg_confidence,
      modification_samples: pickSamples(rows),
      significance: computeSignificance(modify_reject_rate, total, avg_confidence),
    });
  }

  clusters.sort((a, b) => b.significance - a.significance);
  return clusters;
}

// Re-export the volume helper for tests
export { computeSignificance, computeVolumeFactor };
