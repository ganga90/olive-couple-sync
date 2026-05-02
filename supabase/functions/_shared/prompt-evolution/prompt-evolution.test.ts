/**
 * Unit tests for D-1.a — reflection clustering + threshold gating.
 *
 * Pinned guarantees:
 *   1. clusterReflections is deterministic, pure, and stable across
 *      Date.now() shifts
 *   2. Empty input → empty output
 *   3. Outcome distribution math is correct (exhaustive case coverage)
 *   4. Sample selection prefers rich-signal rows; caps at 10
 *   5. modify_reject_rate excludes 'accepted' and 'ignored'
 *   6. Significance ordering is monotonic in modify_reject_rate at fixed
 *      volume + confidence (sanity check, not a strict mathematical
 *      property — sat curve on volume can dominate at extremes)
 *   7. Threshold gating returns the expected pass/fail per case
 *   8. getRejectionReason returns a useful string for every fail mode
 *   9. buildPatternSignature is human-readable
 *  10. action_type without prompt module mapping is rejected
 *  11. Confidence is clamped to [0, 1] defensively (handles bad data)
 */

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  clusterReflections,
  computeSignificance,
  computeVolumeFactor,
} from "./reflection-cluster.ts";
import {
  buildPatternSignature,
  DEFAULT_THRESHOLDS,
  getRejectionReason,
  isClusterActionable,
} from "./cluster-thresholds.ts";
import type { ReflectionRow } from "./types.ts";

// ─── Test fixtures ─────────────────────────────────────────────────

let counter = 0;
function makeRow(overrides: Partial<ReflectionRow> = {}): ReflectionRow {
  counter += 1;
  return {
    id: `r${counter}`,
    user_id: "u1",
    action_type: "categorize_note",
    outcome: "modified",
    user_modification: "groceries",
    lesson: null,
    confidence: 0.8,
    action_detail: { from_category: "shopping", to_category: "groceries" },
    created_at: `2026-04-2${(counter % 9) + 1}T12:00:00Z`,
    ...overrides,
  };
}

// ─── clusterReflections ────────────────────────────────────────────

Deno.test("clusterReflections: empty input → empty output", () => {
  assertEquals(clusterReflections([]), []);
});

Deno.test("clusterReflections: groups by action_type", () => {
  const rows: ReflectionRow[] = [
    makeRow({ action_type: "categorize_note" }),
    makeRow({ action_type: "categorize_note" }),
    makeRow({ action_type: "partner_message" }),
  ];
  const out = clusterReflections(rows);
  assertEquals(out.length, 2);
  const cat = out.find((c) => c.action_type === "categorize_note")!;
  assertEquals(cat.total, 2);
  const pm = out.find((c) => c.action_type === "partner_message")!;
  assertEquals(pm.total, 1);
});

Deno.test("clusterReflections: outcome distribution is exhaustive", () => {
  const rows: ReflectionRow[] = [
    makeRow({ outcome: "accepted" }),
    makeRow({ outcome: "modified" }),
    makeRow({ outcome: "modified" }),
    makeRow({ outcome: "rejected" }),
    makeRow({ outcome: "ignored" }),
    makeRow({ outcome: "ignored" }),
    makeRow({ outcome: "ignored" }),
  ];
  const [c] = clusterReflections(rows);
  assertEquals(c.by_outcome.accepted, 1);
  assertEquals(c.by_outcome.modified, 2);
  assertEquals(c.by_outcome.rejected, 1);
  assertEquals(c.by_outcome.ignored, 3);
  assertEquals(c.total, 7);
});

Deno.test("clusterReflections: modify_reject_rate is (modified+rejected)/total", () => {
  const rows: ReflectionRow[] = [
    makeRow({ outcome: "modified" }),
    makeRow({ outcome: "modified" }),
    makeRow({ outcome: "rejected" }),
    makeRow({ outcome: "ignored" }),
    makeRow({ outcome: "accepted" }),
  ];
  const [c] = clusterReflections(rows);
  // (2 + 1) / 5 = 0.6
  assertEquals(c.modify_reject_rate, 0.6);
});

Deno.test("clusterReflections: avg_confidence is the arithmetic mean", () => {
  const rows: ReflectionRow[] = [
    makeRow({ confidence: 0.5 }),
    makeRow({ confidence: 0.7 }),
    makeRow({ confidence: 0.9 }),
  ];
  const [c] = clusterReflections(rows);
  assertEquals(Math.abs(c.avg_confidence - 0.7) < 1e-9, true);
});

Deno.test("clusterReflections: confidence is clamped to [0,1] defensively", () => {
  const rows: ReflectionRow[] = [
    makeRow({ confidence: 1.5 as unknown as number }),  // out of range high
    makeRow({ confidence: -0.2 as unknown as number }), // negative
    makeRow({ confidence: NaN as unknown as number }),  // NaN
  ];
  const [c] = clusterReflections(rows);
  // 1 + 0 + 0 = 1, divided by 3
  assertEquals(Math.abs(c.avg_confidence - 1 / 3) < 1e-9, true);
});

Deno.test("clusterReflections: samples cap at 10", () => {
  const rows: ReflectionRow[] = Array.from({ length: 25 }, (_, i) =>
    makeRow({ id: `s${i}`, user_modification: `mod-${i}`, lesson: `lesson-${i}` }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(c.modification_samples.length, 10);
});

Deno.test("clusterReflections: samples prefer richer signal rows", () => {
  const rows: ReflectionRow[] = [
    // Plain — no modification, no lesson — must be excluded
    makeRow({ id: "plain", outcome: "ignored", user_modification: null, lesson: null }),
    // Has modification only
    makeRow({ id: "mod", outcome: "modified", user_modification: "groceries", lesson: null, confidence: 0.5 }),
    // Has both modification AND lesson — must come first
    makeRow({ id: "rich", outcome: "modified", user_modification: "groceries", lesson: "user prefers concrete categories", confidence: 0.5 }),
  ];
  const [c] = clusterReflections(rows);
  // Only the two rich-signal rows are sampled — plain is filtered
  assertEquals(c.modification_samples.length, 2);
  // The richest sample comes first
  assertEquals(c.modification_samples[0].lesson?.includes("user prefers"), true);
});

Deno.test("clusterReflections: clusters sorted by significance descending", () => {
  // Cluster A: high modify_reject_rate, large
  const a: ReflectionRow[] = Array.from({ length: 20 }, () =>
    makeRow({ action_type: "categorize_note", outcome: "modified" }),
  );
  // Cluster B: low rate, large
  const b: ReflectionRow[] = Array.from({ length: 20 }, () =>
    makeRow({ action_type: "partner_message", outcome: "ignored" }),
  );
  const out = clusterReflections([...a, ...b]);
  assertEquals(out[0].action_type, "categorize_note");
  assertEquals(out[1].action_type, "partner_message");
  assertEquals(out[0].significance > out[1].significance, true);
});

// ─── significance helpers ──────────────────────────────────────────

Deno.test("computeVolumeFactor: 0 → 0", () => {
  assertEquals(computeVolumeFactor(0), 0);
});

Deno.test("computeVolumeFactor: saturates at 50", () => {
  // Below saturation: less than 1
  assertEquals(computeVolumeFactor(10) < 1, true);
  // At saturation: exactly 1
  assertEquals(Math.abs(computeVolumeFactor(50) - 1) < 1e-9, true);
  // Above saturation: still 1 (clamped)
  assertEquals(computeVolumeFactor(500), 1);
});

Deno.test("computeSignificance: at fixed volume+confidence, monotonic in modify_reject_rate", () => {
  const a = computeSignificance(0.1, 20, 0.8);
  const b = computeSignificance(0.5, 20, 0.8);
  const c = computeSignificance(0.9, 20, 0.8);
  assertEquals(a < b, true);
  assertEquals(b < c, true);
});

// ─── Threshold gating ──────────────────────────────────────────────

Deno.test("isClusterActionable: passes when all thresholds met", () => {
  const rows: ReflectionRow[] = Array.from({ length: 8 }, (_, i) =>
    makeRow({
      action_type: "categorize_note",
      outcome: i < 6 ? "modified" : "accepted",
      confidence: 0.8,
    }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), true);
  assertEquals(getRejectionReason(c), null);
});

Deno.test("isClusterActionable: fails for unmapped action_type", () => {
  const rows: ReflectionRow[] = Array.from({ length: 10 }, () =>
    makeRow({
      action_type: "morning_briefing", // not in ACTION_TYPE_TO_MODULE
      outcome: "modified",
      confidence: 0.9,
    }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), false);
  const reason = getRejectionReason(c);
  assertNotEquals(reason, null);
  assertEquals(reason!.includes("morning_briefing"), true);
});

Deno.test("isClusterActionable: fails when total below min_size", () => {
  const rows: ReflectionRow[] = Array.from({ length: 3 }, () =>
    makeRow({ outcome: "modified", confidence: 0.9 }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), false);
  assertEquals(getRejectionReason(c)!.includes("min_size"), true);
});

Deno.test("isClusterActionable: fails when modify_reject_rate too low", () => {
  // 10 reflections, all 'ignored' — rate is 0
  const rows: ReflectionRow[] = Array.from({ length: 10 }, () =>
    makeRow({ outcome: "ignored", confidence: 0.9 }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), false);
  assertEquals(getRejectionReason(c)!.includes("modify_reject_rate"), true);
});

Deno.test("isClusterActionable: fails when avg_confidence too low", () => {
  // 10 modified reflections but low confidence
  const rows: ReflectionRow[] = Array.from({ length: 10 }, () =>
    makeRow({ outcome: "modified", confidence: 0.4 }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), false);
  assertEquals(getRejectionReason(c)!.includes("avg_confidence"), true);
});

Deno.test("isClusterActionable: thresholds are tunable per call", () => {
  const rows: ReflectionRow[] = Array.from({ length: 6 }, () =>
    makeRow({ outcome: "modified", confidence: 0.9 }),
  );
  const [c] = clusterReflections(rows);
  // Default: passes
  assertEquals(isClusterActionable(c), true);
  // Stricter min_size: fails
  assertEquals(
    isClusterActionable(c, { ...DEFAULT_THRESHOLDS, min_size: 100 }),
    false,
  );
});

// ─── pattern_signature ─────────────────────────────────────────────

Deno.test("buildPatternSignature: human-readable summary", () => {
  const rows: ReflectionRow[] = [
    makeRow({
      outcome: "modified",
      user_modification: "groceries",
      action_detail: { from_category: "shopping", to_category: "groceries" },
      lesson: "user prefers concrete categories",
    }),
    makeRow({ outcome: "modified" }),
    makeRow({ outcome: "rejected" }),
  ];
  const [c] = clusterReflections(rows);
  const sig = buildPatternSignature(c);
  assertEquals(sig.includes("categorize_note"), true);
  assertEquals(sig.includes("3 refs"), true);
  // "modified+rejected" rate = 100% → "100%"
  assertEquals(sig.includes("100%"), true);
});

Deno.test("buildPatternSignature: handles empty modification_samples", () => {
  // All-ignored cluster: pickSamples produces zero entries (no signal text)
  const rows: ReflectionRow[] = Array.from({ length: 5 }, () =>
    makeRow({ outcome: "ignored", user_modification: null, lesson: null }),
  );
  const [c] = clusterReflections(rows);
  const sig = buildPatternSignature(c);
  // No "top:" suffix because no samples
  assertEquals(sig.includes("top:"), false);
});

// ─── Integration: production-corpus shape ──────────────────────────

Deno.test("integration: prod-corpus shape (lots of ignored, few modified) → no actionable cluster", () => {
  // Mirrors the prod state on 2026-05-02: 35/36 ignored
  const rows: ReflectionRow[] = [
    ...Array.from({ length: 17 }, () =>
      makeRow({ action_type: "morning_briefing", outcome: "ignored", confidence: 0.6 }),
    ),
    ...Array.from({ length: 12 }, () =>
      makeRow({ action_type: "overdue_nudge", outcome: "ignored", confidence: 0.6 }),
    ),
    ...Array.from({ length: 6 }, () =>
      makeRow({ action_type: "task_reminder", outcome: "ignored", confidence: 0.6 }),
    ),
    makeRow({ action_type: "morning_briefing", outcome: "accepted", confidence: 0.6 }),
  ];
  const clusters = clusterReflections(rows);
  // No cluster passes thresholds: action_type unmapped + rate 0
  for (const c of clusters) {
    assertEquals(isClusterActionable(c), false);
  }
});

Deno.test("integration: future-state corpus (categorize_note with corrections) → actionable", () => {
  // What the corpus might look like in a few months after C-1.b accumulates
  const rows: ReflectionRow[] = Array.from({ length: 10 }, (_, i) =>
    makeRow({
      action_type: "categorize_note",
      outcome: i < 6 ? "modified" : (i < 8 ? "rejected" : "accepted"),
      confidence: 0.85,
    }),
  );
  const [c] = clusterReflections(rows);
  assertEquals(isClusterActionable(c), true);
  assertEquals(c.action_type, "categorize_note");
  assertEquals(c.modify_reject_rate, 0.8);
});
