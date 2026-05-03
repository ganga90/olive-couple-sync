/**
 * Phase D-1.a — pure threshold gating
 * ============================================================================
 * Decides whether a cluster carries enough signal to spend a Gemini Pro
 * call on. Pure function — no I/O, easy to unit test, easy to tune.
 *
 * Why these defaults:
 *
 *   min_size = 5
 *     Anything below 5 reflections in a 7-day window is statistically
 *     too thin to act on. Risk of overfitting to one user's quirks
 *     dominates the lift from prompt evolution.
 *
 *   min_modify_reject_rate = 0.30
 *     If 70%+ of reflections are 'accepted' or 'ignored' (the no-correction
 *     outcomes), the prompt is doing fine. Don't propose a fix to a
 *     non-broken thing — that's how regressions ship.
 *
 *   min_avg_confidence = 0.60
 *     Filters out low-quality reflection sources (e.g. a future heuristic
 *     trigger that fires with confidence=0.3). Prevents Pro from learning
 *     from weak signals.
 *
 * These are tunable: a future admin endpoint can override per-module
 * thresholds (e.g. min_size=20 for a high-traffic module). For V1,
 * the defaults apply uniformly.
 */

import type { ClusterThresholds, ReflectionCluster } from "./types.ts";
import { ACTION_TYPE_TO_MODULE } from "./types.ts";

export const DEFAULT_THRESHOLDS: ClusterThresholds = {
  min_size: 5,
  min_modify_reject_rate: 0.30,
  min_avg_confidence: 0.60,
};

/**
 * Will the proposal generator consider this cluster?
 *
 * False on ANY of:
 *   - cluster smaller than min_size
 *   - too few corrective signals (modified+rejected) in proportion
 *   - average confidence too low
 *   - action_type doesn't map to a registered prompt module
 *
 * True only when ALL gates pass.
 */
export function isClusterActionable(
  cluster: ReflectionCluster,
  thresholds: ClusterThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return getRejectionReason(cluster, thresholds) === null;
}

/**
 * Same logic as isClusterActionable but returns the human-readable
 * reason a cluster was rejected (or null if it passes). Used by the
 * cron's logging so we can see exactly why a cluster was skipped.
 */
export function getRejectionReason(
  cluster: ReflectionCluster,
  thresholds: ClusterThresholds = DEFAULT_THRESHOLDS,
): string | null {
  if (!ACTION_TYPE_TO_MODULE[cluster.action_type]) {
    return `action_type '${cluster.action_type}' has no registered prompt module mapping`;
  }
  if (cluster.total < thresholds.min_size) {
    return `total ${cluster.total} < min_size ${thresholds.min_size}`;
  }
  if (cluster.modify_reject_rate < thresholds.min_modify_reject_rate) {
    return `modify_reject_rate ${cluster.modify_reject_rate.toFixed(2)} < min ${thresholds.min_modify_reject_rate}`;
  }
  if (cluster.avg_confidence < thresholds.min_avg_confidence) {
    return `avg_confidence ${cluster.avg_confidence.toFixed(2)} < min ${thresholds.min_avg_confidence}`;
  }
  return null;
}

/**
 * Compact one-line summary used as olive_prompt_addendums.pattern_signature.
 * Helps with dedup across cron runs and admin scanning.
 */
export function buildPatternSignature(cluster: ReflectionCluster): string {
  const top = cluster.modification_samples[0];
  const change = top
    ? ` ; top: ${top.from ?? "?"} → ${top.to ?? "?"}`
    : "";
  const pct = Math.round(cluster.modify_reject_rate * 100);
  return `${cluster.action_type}: ${cluster.total} refs, ${pct}% modified+rejected${change}`;
}
