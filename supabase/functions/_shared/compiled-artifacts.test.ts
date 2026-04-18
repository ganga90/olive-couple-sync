/**
 * Deno tests for compiled-artifacts.ts (Phase 4-A/B).
 *
 * Covered:
 *   - Token estimation + boundary-aware truncation
 *   - Source-citation validator (grounded / ungrounded / no sources)
 *   - Sentence splitter
 *   - Keyword tokenizer (stopword filtering, short-word filtering)
 *   - `assembleCompiledSlot` staleness and freshness handling
 *   - `assembleCompiledSlot` per-artifact and total budget enforcement
 *   - `assembleUserSlot` orchestrator with mocked ArtifactDB
 *
 * Run: deno test supabase/functions/_shared/compiled-artifacts.test.ts
 */

import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  ARTIFACT_BUDGETS,
  COMPILED_STALE_MS,
  COMPILED_USER_BUDGET,
  assembleCompiledSlot,
  assembleUserSlot,
  estimateArtifactTokens,
  splitIntoSentences,
  tokenizeForGrounding,
  truncateArtifact,
  validateCompiledAgainstSources,
  type ArtifactDB,
  type CompiledArtifact,
} from "./compiled-artifacts.ts";

// ─── Token + truncation ────────────────────────────────────────────

Deno.test("estimateArtifactTokens: empty string returns 0", () => {
  assertEquals(estimateArtifactTokens(""), 0);
});

Deno.test("estimateArtifactTokens: ~4 chars per token", () => {
  // 40 chars → 10 tokens
  assertEquals(estimateArtifactTokens("a".repeat(40)), 10);
});

Deno.test("truncateArtifact: under budget is unchanged", () => {
  const text = "Short sentence.";
  assertEquals(truncateArtifact(text, 100), text);
});

Deno.test("truncateArtifact: breaks at sentence boundary when possible", () => {
  const text =
    "First sentence here. Second sentence is longer and has more content. Third sentence wraps up.";
  const result = truncateArtifact(text, 10); // ~40 chars
  // Should end at a period + (truncated) marker
  assert(
    result.includes("...(truncated)"),
    "expected truncation marker in: " + result
  );
  assert(
    result.startsWith("First sentence here."),
    "expected to keep the first sentence: " + result
  );
});

Deno.test("truncateArtifact: falls back to hard cut when no good break", () => {
  const text = "a".repeat(200); // no boundaries at all
  const result = truncateArtifact(text, 10); // 40 chars
  assert(result.endsWith("...(truncated)"));
  // body itself should be <= 40 chars before the marker
  const body = result.replace("\n...(truncated)", "").replace("...(truncated)", "");
  assert(body.length <= 40);
});

// ─── Tokenizer ─────────────────────────────────────────────────────

Deno.test("tokenizeForGrounding: filters short words and stopwords", () => {
  const tokens = tokenizeForGrounding("The quick cat sat with her pet");
  // "the", "with", "her" are stopwords. "cat", "sat", "pet" are <4 chars and dropped.
  // Only "quick" (5 chars, not a stopword) should survive.
  assert(tokens.includes("quick"), "expected 'quick' in tokens: " + tokens.join(","));
  assert(!tokens.includes("the"), "stopword 'the' should be filtered");
  assert(!tokens.includes("with"), "stopword 'with' should be filtered");
  assert(!tokens.includes("cat"), "short word 'cat' should be filtered (<4 chars)");
});

Deno.test("tokenizeForGrounding: removes punctuation", () => {
  const tokens = tokenizeForGrounding("Hello, world! It's fine; okay?");
  // No punctuation survives
  for (const t of tokens) {
    assertEquals(t, t.replace(/[^\w]/g, ""));
  }
});

// ─── Sentence splitter ────────────────────────────────────────────

Deno.test("splitIntoSentences: splits on . ! ? and newlines", () => {
  const text = "First one. Second one! Third one?\nFourth on a new line.";
  const sents = splitIntoSentences(text);
  assertEquals(sents.length, 4);
});

Deno.test("splitIntoSentences: skips fragments under 8 chars", () => {
  const text = "Yes. This is a longer sentence.";
  const sents = splitIntoSentences(text);
  assertEquals(sents.length, 1);
  assertEquals(sents[0], "This is a longer sentence.");
});

// ─── Validator ─────────────────────────────────────────────────────

Deno.test("validateCompiledAgainstSources: empty compiled → score 0", () => {
  const result = validateCompiledAgainstSources("", [{ content: "anything" }]);
  assertEquals(result.score, 0);
  assertEquals(result.notes, "empty_compiled_text");
});

Deno.test("validateCompiledAgainstSources: no sources → score 0", () => {
  const result = validateCompiledAgainstSources("Some compiled text here.", []);
  assertEquals(result.score, 0);
  assertEquals(result.notes, "no_source_chunks_provided");
});

Deno.test("validateCompiledAgainstSources: fully grounded output → score 1.0", () => {
  const sources = [
    {
      content:
        "User prefers morning coffee, typically Italian espresso. Sleeps late on Sundays.",
    },
    {
      content:
        "Partner is named Sarah. She handles grocery shopping on weekends.",
    },
  ];
  const compiled =
    "User prefers morning espresso coffee. Partner Sarah handles weekend grocery shopping.";
  const result = validateCompiledAgainstSources(compiled, sources);
  assertEquals(result.score, 1.0);
  assertEquals(result.ungroundedSentences.length, 0);
});

Deno.test("validateCompiledAgainstSources: partially grounded → partial score", () => {
  const sources = [
    { content: "User drinks coffee every morning before work." },
  ];
  const compiled =
    "User drinks coffee every morning. The user has a pet kangaroo named Fernando that he walks on weekends.";
  const result = validateCompiledAgainstSources(compiled, sources);
  // First sentence is grounded (drinks+coffee+morning overlap).
  // Second sentence is hallucinated (kangaroo/Fernando not in source).
  assert(result.score < 1.0, "expected partial score, got " + result.score);
  assert(result.score > 0, "expected >0 score, got " + result.score);
  assert(result.ungroundedSentences.length >= 1);
});

Deno.test("validateCompiledAgainstSources: fully ungrounded → score 0", () => {
  const sources = [{ content: "User prefers quiet evenings at home." }];
  const compiled = "Eighteen pelicans migrate across Antarctica each December.";
  const result = validateCompiledAgainstSources(compiled, sources);
  assertEquals(result.score, 0);
});

// ─── assembleCompiledSlot — pure logic ────────────────────────────

function mkArtifact(
  type: CompiledArtifact["file_type"],
  content: string,
  ageHours: number
): CompiledArtifact {
  return {
    file_type: type,
    content,
    updated_at: new Date(Date.now() - ageHours * 3600 * 1000).toISOString(),
  };
}

Deno.test("assembleCompiledSlot: all empty artifacts → empty result", () => {
  const result = assembleCompiledSlot([]);
  assertEquals(result.content, "");
  assertEquals(result.source, "empty");
  assertEquals(result.estimatedTokens, 0);
});

Deno.test("assembleCompiledSlot: fresh artifacts produce compiled source", () => {
  const artifacts = [
    mkArtifact("profile", "User loves dark chocolate and espresso.", 1),
    mkArtifact("patterns", "Morning walks are a daily habit.", 2),
  ];
  const result = assembleCompiledSlot(artifacts);
  assertEquals(result.source, "compiled");
  assertEquals(result.fresh, true);
  assert(result.content.includes("## COMPILED USER PROFILE"));
  assert(result.content.includes("## COMPILED BEHAVIORAL PATTERNS"));
  // profile comes before patterns in the output
  const profileIdx = result.content.indexOf("## COMPILED USER PROFILE");
  const patternsIdx = result.content.indexOf("## COMPILED BEHAVIORAL PATTERNS");
  assert(profileIdx < patternsIdx);
});

Deno.test("assembleCompiledSlot: stale artifacts flagged but still used", () => {
  const stale = mkArtifact(
    "profile",
    "User fact from old compilation.",
    COMPILED_STALE_MS / (3600 * 1000) + 1 // 25h
  );
  const result = assembleCompiledSlot([stale]);
  assertEquals(result.source, "dynamic"); // all-stale → dynamic label
  assertEquals(result.fresh, false);
  assert(result.content.includes("User fact from old compilation"));
});

Deno.test("assembleCompiledSlot: mixed fresh+stale → 'mixed' source", () => {
  const fresh = mkArtifact("profile", "Fresh profile content here.", 1);
  const stale = mkArtifact(
    "patterns",
    "Stale pattern content from a week ago.",
    200
  );
  const result = assembleCompiledSlot([fresh, stale]);
  assertEquals(result.source, "mixed");
});

Deno.test("assembleCompiledSlot: per-artifact cap respected", () => {
  // profile budget is 400 tokens = ~1600 chars. Create content 2x that.
  const big = "a very long profile fact repeated over and over. ".repeat(100);
  const result = assembleCompiledSlot([mkArtifact("profile", big, 1)]);
  const profileStatus = result.artifactStatus.find((s) => s.type === "profile")!;
  assert(
    profileStatus.tokens <= ARTIFACT_BUDGETS.profile + 5,
    `profile section exceeded per-type budget: ${profileStatus.tokens}`
  );
});

Deno.test("assembleCompiledSlot: total budget capped at COMPILED_USER_BUDGET", () => {
  // Fill all 4 artifacts with content far exceeding the combined budget.
  const big = "x".repeat(5000);
  const artifacts: CompiledArtifact[] = [
    mkArtifact("profile", big, 1),
    mkArtifact("patterns", big, 1),
    mkArtifact("relationship", big, 1),
    mkArtifact("household", big, 1),
  ];
  const result = assembleCompiledSlot(artifacts);
  assert(
    result.estimatedTokens <= COMPILED_USER_BUDGET + 10,
    `total tokens ${result.estimatedTokens} exceeded budget ${COMPILED_USER_BUDGET}`
  );
});

Deno.test("assembleCompiledSlot: missing artifact types don't break output", () => {
  const result = assembleCompiledSlot([
    mkArtifact("profile", "Just a profile, no other artifacts.", 1),
  ]);
  assertEquals(result.source, "compiled");
  const profileStatus = result.artifactStatus.find((s) => s.type === "profile")!;
  assertEquals(profileStatus.status, "used");
  const patternsStatus = result.artifactStatus.find((s) => s.type === "patterns")!;
  assertEquals(patternsStatus.status, "missing");
});

// ─── assembleUserSlot orchestrator ────────────────────────────────

function mkMockDB(artifacts: CompiledArtifact[]): ArtifactDB {
  return {
    async fetchCompiledArtifacts() {
      return artifacts;
    },
    async fetchDynamicMemoryFiles() {
      return artifacts;
    },
  };
}

Deno.test("assembleUserSlot: empty userId → empty result", async () => {
  const db = mkMockDB([]);
  const result = await assembleUserSlot(db, "");
  assertEquals(result.source, "empty");
  assertEquals(result.content, "");
});

Deno.test("assembleUserSlot: DB error degrades to empty (never throws)", async () => {
  const brokenDB: ArtifactDB = {
    async fetchCompiledArtifacts(): Promise<CompiledArtifact[]> {
      throw new Error("simulated DB outage");
    },
    async fetchDynamicMemoryFiles() {
      return [];
    },
  };
  const result = await assembleUserSlot(brokenDB, "user-123");
  assertEquals(result.source, "empty");
  assertEquals(result.content, "");
});

Deno.test("assembleUserSlot: happy path returns compiled content", async () => {
  const db = mkMockDB([
    mkArtifact("profile", "User profile compiled text.", 1),
    mkArtifact("patterns", "User patterns compiled text.", 1),
  ]);
  const result = await assembleUserSlot(db, "user-123");
  assertEquals(result.source, "compiled");
  assert(result.content.length > 0);
  assert(result.estimatedTokens > 0);
});
