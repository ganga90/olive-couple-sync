// Tests for _shared/task-disambiguation.ts — pure functions only.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  pickDisambiguation,
  scoreCandidate,
  type TaskCandidate,
} from "./task-disambiguation.ts";

const FIXED_NOW = new Date("2026-05-10T12:00:00Z").getTime();

function makeCand(
  id: string,
  summary: string,
  daysAgo: number = 1,
): TaskCandidate {
  return {
    id,
    summary,
    due_date: null,
    reminder_time: null,
    updated_at: new Date(FIXED_NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  };
}

// ─── scoreCandidate ────────────────────────────────────────────────────

Deno.test("scoreCandidate: exact phrase match → high score", () => {
  const c = makeCand("a", "Visit apartment SoHo", 1);
  const s = scoreCandidate("visit apartment soho", c, FIXED_NOW);
  assert(s > 0.85, `expected >0.85, got ${s}`);
});

Deno.test("scoreCandidate: partial overlap → moderate score", () => {
  const c = makeCand("a", "Visit dentist", 1);
  const s = scoreCandidate("visit apartment", c, FIXED_NOW);
  assert(s > 0.1 && s < 0.5, `expected (0.1, 0.5), got ${s}`);
});

Deno.test("scoreCandidate: no overlap → score 0 or near-0", () => {
  const c = makeCand("a", "Pick up dry cleaning", 1);
  const s = scoreCandidate("call mom", c, FIXED_NOW);
  assert(s < 0.15, `expected <0.15, got ${s}`);
});

Deno.test("scoreCandidate: recency boosts among equals", () => {
  const fresh = makeCand("a", "Visit apartment", 1);
  const stale = makeCand("b", "Visit apartment", 90);
  const sFresh = scoreCandidate("visit apartment", fresh, FIXED_NOW);
  const sStale = scoreCandidate("visit apartment", stale, FIXED_NOW);
  assert(sFresh > sStale, `fresh (${sFresh}) should outscore stale (${sStale})`);
});

Deno.test("scoreCandidate: stopwords don't dominate", () => {
  // "the" / "to" / "for" shouldn't make these match.
  const c = makeCand("a", "Buy the milk for the cat", 1);
  const s = scoreCandidate("the for to", c, FIXED_NOW);
  assertEquals(s, 0);
});

Deno.test("scoreCandidate: case-insensitive", () => {
  const c = makeCand("a", "VISIT APARTMENT", 1);
  const s = scoreCandidate("visit apartment", c, FIXED_NOW);
  assert(s > 0.85);
});

// ─── pickDisambiguation ────────────────────────────────────────────────

Deno.test("pickDisambiguation: ordinal '1' → first candidate", () => {
  const cands = [makeCand("a", "Visit SoHo"), makeCand("b", "Visit Brooklyn")];
  const p = pickDisambiguation("1", cands);
  assertEquals(p.kind, "PICKED");
  if (p.kind === "PICKED") assertEquals(p.task.id, "a");
});

Deno.test("pickDisambiguation: ordinal word 'second' → second candidate", () => {
  const cands = [makeCand("a", "Visit SoHo"), makeCand("b", "Visit Brooklyn")];
  const p = pickDisambiguation("second", cands);
  assertEquals(p.kind, "PICKED");
  if (p.kind === "PICKED") assertEquals(p.task.id, "b");
});

Deno.test("pickDisambiguation: free-text matching one candidate uniquely", () => {
  const cands = [makeCand("a", "Visit SoHo apartment"), makeCand("b", "Visit Brooklyn apartment")];
  const p = pickDisambiguation("the soho one", cands);
  assertEquals(p.kind, "PICKED");
  if (p.kind === "PICKED") assertEquals(p.task.id, "a");
});

Deno.test("pickDisambiguation: 'neither' → NONE_OF_THESE", () => {
  const cands = [makeCand("a", "Visit SoHo"), makeCand("b", "Visit Brooklyn")];
  const p = pickDisambiguation("neither", cands);
  assertEquals(p.kind, "NONE_OF_THESE");
});

Deno.test("pickDisambiguation: 'none of those' → NONE_OF_THESE", () => {
  const cands = [makeCand("a", "Visit SoHo"), makeCand("b", "Visit Brooklyn")];
  const p = pickDisambiguation("none of those", cands);
  assertEquals(p.kind, "NONE_OF_THESE");
});

Deno.test("pickDisambiguation: ambiguous free-text → UNCLEAR", () => {
  // Both candidates share most tokens; reply doesn't favor either.
  const cands = [makeCand("a", "Visit apartment"), makeCand("b", "Visit apartment")];
  const p = pickDisambiguation("visit apartment", cands);
  assertEquals(p.kind, "UNCLEAR");
});

Deno.test("pickDisambiguation: out-of-range ordinal → UNCLEAR", () => {
  const cands = [makeCand("a", "x"), makeCand("b", "y")];
  const p = pickDisambiguation("5", cands);
  assertEquals(p.kind, "UNCLEAR");
});

Deno.test("pickDisambiguation: empty reply → UNCLEAR", () => {
  const cands = [makeCand("a", "x"), makeCand("b", "y")];
  const p = pickDisambiguation("   ", cands);
  assertEquals(p.kind, "UNCLEAR");
});
