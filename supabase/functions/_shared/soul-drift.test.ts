import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  computeDrift,
  computeFieldsChanged,
  estimateTokens,
  MAX_DRIFT_SCORE,
  MAX_FIELDS_CHANGED_PER_CYCLE,
  MAX_TOKEN_DELTA_PERCENT,
} from "./soul-drift.ts";

Deno.test("computeFieldsChanged: identical objects → no fields changed", () => {
  const obj = { a: 1, b: "two", c: [1, 2, 3] };
  assertEquals(computeFieldsChanged(obj, obj), []);
});

Deno.test("computeFieldsChanged: value diff in one field", () => {
  const before = { tone: "warm", proactive: 3 };
  const after = { tone: "warm", proactive: 4 };
  assertEquals(computeFieldsChanged(before, after), ["proactive"]);
});

Deno.test("computeFieldsChanged: added and removed fields both count", () => {
  const before = { a: 1, b: 2 };
  const after = { b: 2, c: 3 };
  const changed = computeFieldsChanged(before, after).sort();
  assertEquals(changed, ["a", "c"]);
});

Deno.test("computeFieldsChanged: nested array reorder is a change (JSON-stable comparison)", () => {
  const before = { tags: ["a", "b"] };
  const after = { tags: ["b", "a"] };
  assertEquals(computeFieldsChanged(before, after), ["tags"]);
});

Deno.test("computeFieldsChanged: null/undefined inputs treated as empty", () => {
  assertEquals(computeFieldsChanged(null, null), []);
  assertEquals(computeFieldsChanged(undefined, { a: 1 }), ["a"]);
  assertEquals(computeFieldsChanged({ a: 1 }, undefined), ["a"]);
});

Deno.test("estimateTokens: rough char/4 estimate, ceil", () => {
  assertEquals(estimateTokens(""), 0);
  assertEquals(estimateTokens("abc"), 1);  // ceil(3/4)
  assertEquals(estimateTokens("abcd"), 1); // ceil(4/4)
  assertEquals(estimateTokens("abcde"), 2); // ceil(5/4)
});

Deno.test("computeDrift: identical snapshots → safe, zero drift", () => {
  const soul = {
    identity: { tone: "warm", style: "concise" },
    domain_knowledge: [{ area: "cooking", confidence: 0.7 }],
  };
  const result = computeDrift(soul, soul);
  assertEquals(result.is_safe, true);
  assertEquals(result.drift_score, 0);
  assertEquals(result.fields_changed, []);
  assertEquals(result.blocked_reasons, []);
  assertEquals(result.token_delta, 0);
});

Deno.test("computeDrift: tiny tweak (one field, small token delta) → safe", () => {
  const before = {
    identity: { tone: "warm" },
    communication: { max_proactive_per_day: 3 },
    domain_knowledge: [{ area: "cooking" }],
    relationships: [{ name: "Sara" }],
    skills_active: ["recipe-helper"],
  };
  const after = {
    ...before,
    communication: { max_proactive_per_day: 4 },
  };
  const result = computeDrift(before, after);
  assertEquals(result.is_safe, true);
  assertEquals(result.fields_changed, ["communication"]);
});

Deno.test("computeDrift: too many fields changed → blocked", () => {
  // 6 fields all change → exceeds MAX_FIELDS_CHANGED_PER_CYCLE (5)
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (let i = 0; i < 6; i++) {
    before[`field${i}`] = "old";
    after[`field${i}`] = "new";
  }
  const result = computeDrift(before, after);
  assertEquals(result.is_safe, false);
  assertEquals(result.fields_changed.length, 6);
  // Should include the field-count reason
  const hasFieldReason = result.blocked_reasons.some((r) =>
    r.includes("fields changed exceeds limit")
  );
  assertEquals(hasFieldReason, true);
});

Deno.test("computeDrift: large token delta → blocked", () => {
  // Same single field, but value grows ~10x → token delta way over 50%
  const before = { bio: "short bio" };
  const after = { bio: "x".repeat(500) };
  const result = computeDrift(before, after);
  assertEquals(result.is_safe, false);
  const hasTokenReason = result.blocked_reasons.some((r) =>
    r.includes("Token count changed")
  );
  assertEquals(hasTokenReason, true);
});

Deno.test("computeDrift: high drift_score → blocked with score reason", () => {
  // 3-of-3 fields changed → field_drift = 1.0 → score >= 0.6
  const before = { a: 1, b: 2, c: 3 };
  const after = { a: 99, b: 88, c: 77 };
  const result = computeDrift(before, after);
  assertEquals(result.is_safe, false);
  const hasScoreReason = result.blocked_reasons.some((r) =>
    r.includes("Drift score")
  );
  assertEquals(hasScoreReason, true);
});

Deno.test("computeDrift: empty → populated soul is flagged as drift-heavy (does not crash)", () => {
  // Going from {} to {a:1} is a "first write" — every field is new, and the
  // token count expands from 1 (JSON.stringify({}) = '{}' = 2 chars / 4) to
  // 2. So field_drift = 1.0 and token_drift = 1.0 → score = 1.0 → blocked.
  // soul-evolve never hits this case (it only runs after getUserSoulContent
  // returned a non-null layer), but the helper must handle it without
  // crashing. We assert the computed shape so a future refactor of the
  // formula is caught here.
  const result = computeDrift({}, { a: 1 });
  assertEquals(result.fields_changed, ["a"]);
  assertEquals(result.is_safe, false);
  // At least one reason should fire; we don't pin which one (formula detail).
  assertEquals(result.blocked_reasons.length > 0, true);
});

Deno.test("computeDrift: null/undefined inputs do not throw", () => {
  const r1 = computeDrift(null, null);
  assertEquals(r1.is_safe, true);
  assertEquals(r1.fields_changed, []);

  const r2 = computeDrift(undefined, { a: 1 });
  assertEquals(r2.fields_changed, ["a"]);
});

Deno.test("computeDrift: deterministic — same input twice yields identical result", () => {
  const before = { x: [1, 2, 3], y: { nested: true } };
  const after = { x: [1, 2, 4], y: { nested: false } };
  const r1 = computeDrift(before, after);
  const r2 = computeDrift(before, after);
  assertEquals(r1, r2);
});

Deno.test("threshold constants match olive-soul-safety inline values", () => {
  // Tripwire: if olive-soul-safety/index.ts changes any of these constants
  // and this module isn't updated, the auto-apply path and user-facing
  // endpoint would disagree. This test exists so the next reader notices.
  assertEquals(MAX_DRIFT_SCORE, 0.6);
  assertEquals(MAX_TOKEN_DELTA_PERCENT, 50);
  assertEquals(MAX_FIELDS_CHANGED_PER_CYCLE, 5);
});

Deno.test("computeDrift: blocked_reasons are human-readable", () => {
  const before = { a: "x" };
  const after = { a: "x".repeat(1000) };
  const result = computeDrift(before, after);
  assertEquals(result.is_safe, false);
  // Sanity: at least one reason mentions the actual numeric threshold
  assertStringIncludes(result.blocked_reasons.join(" "), "limit");
});
