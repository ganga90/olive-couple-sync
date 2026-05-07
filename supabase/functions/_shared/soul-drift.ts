/**
 * Soul drift detection — pure helpers
 * ====================================
 * Computes how much a soul layer has changed between two snapshots and whether
 * the change is safe to auto-apply. Used by `olive-soul-evolve` (D-5 safety
 * floor) before writing the cumulative result of minor changes to the live
 * layer.
 *
 * Mirrors the thresholds enforced by `olive-soul-safety/check_drift` so that
 * the auto-apply path and the user-facing safety endpoint agree on what
 * counts as "too much change at once". Kept pure (no DB, no network) so it's
 * cheap to call inline and trivially testable. The HTTP endpoint remains the
 * canonical user-facing API; this module is the in-process equivalent for
 * service-role callers (avoids the function-to-function JWT issue).
 */

// Thresholds — must stay in sync with olive-soul-safety/index.ts.
// Any change here should land alongside the equivalent change there.
export const MAX_DRIFT_SCORE = 0.6;
export const MAX_TOKEN_DELTA_PERCENT = 50;
export const MAX_FIELDS_CHANGED_PER_CYCLE = 5;

export interface DriftResult {
  drift_score: number;        // 0.0–1.0, weighted blend of field + token drift
  fields_changed: string[];
  token_delta: number;
  token_delta_percent: number;
  is_safe: boolean;
  blocked_reasons: string[];
  details: {
    before_tokens: number;
    after_tokens: number;
    field_drift: number;
    token_drift: number;
  };
}

export function computeFieldsChanged(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};
  const allKeys = new Set([
    ...Object.keys(beforeObj),
    ...Object.keys(afterObj),
  ]);

  const changed: string[] = [];
  for (const key of allKeys) {
    const beforeVal = JSON.stringify(beforeObj[key]);
    const afterVal = JSON.stringify(afterObj[key]);
    if (beforeVal !== afterVal) {
      changed.push(key);
    }
  }
  return changed;
}

export function estimateTokens(text: string): number {
  return Math.ceil((text || "").length / 4);
}

/**
 * Compare two soul snapshots and decide whether the diff is small enough to
 * auto-apply. Returns a structured result so callers can both gate the write
 * and log the reason for blocking.
 */
export function computeDrift(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): DriftResult {
  const beforeObj = before ?? {};
  const afterObj = after ?? {};

  const fieldsChanged = computeFieldsChanged(beforeObj, afterObj);
  const beforeTokens = estimateTokens(JSON.stringify(beforeObj));
  const afterTokens = estimateTokens(JSON.stringify(afterObj));
  const tokenDelta = afterTokens - beforeTokens;
  const tokenDeltaPercent = beforeTokens > 0
    ? Math.abs(tokenDelta / beforeTokens) * 100
    : 0;

  const totalFields = new Set([
    ...Object.keys(beforeObj),
    ...Object.keys(afterObj),
  ]).size;
  const fieldDrift = totalFields > 0 ? fieldsChanged.length / totalFields : 0;
  const tokenDrift = Math.min(1, tokenDeltaPercent / 100);
  const driftScore = Math.min(1, fieldDrift * 0.6 + tokenDrift * 0.4);

  const blockedReasons: string[] = [];
  if (driftScore > MAX_DRIFT_SCORE) {
    blockedReasons.push(
      `Drift score ${driftScore.toFixed(2)} exceeds threshold ${MAX_DRIFT_SCORE}`,
    );
  }
  if (fieldsChanged.length > MAX_FIELDS_CHANGED_PER_CYCLE) {
    blockedReasons.push(
      `${fieldsChanged.length} fields changed exceeds limit of ${MAX_FIELDS_CHANGED_PER_CYCLE}`,
    );
  }
  if (tokenDeltaPercent > MAX_TOKEN_DELTA_PERCENT) {
    blockedReasons.push(
      `Token count changed by ${tokenDeltaPercent.toFixed(0)}% (limit: ${MAX_TOKEN_DELTA_PERCENT}%)`,
    );
  }

  return {
    drift_score: Math.round(driftScore * 100) / 100,
    fields_changed: fieldsChanged,
    token_delta: tokenDelta,
    token_delta_percent: Math.round(tokenDeltaPercent * 10) / 10,
    is_safe: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    details: {
      before_tokens: beforeTokens,
      after_tokens: afterTokens,
      field_drift: Math.round(fieldDrift * 100) / 100,
      token_drift: Math.round(tokenDrift * 100) / 100,
    },
  };
}
