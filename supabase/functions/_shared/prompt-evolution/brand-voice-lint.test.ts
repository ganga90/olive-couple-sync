import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { lintBrandVoice } from "./brand-voice-lint.ts";

// ─── Happy path ────────────────────────────────────────────────────────

Deno.test("Clean instruction prose → ok, no violations", () => {
  const text = `When the user provides a corrected category, accept it without
restating their reasoning. Move on to the next item.`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, true);
  assertEquals(result.violations, []);
});

Deno.test("Addendum with one or two exclamation marks → ok", () => {
  const text = `Acknowledge the user briefly. Don't add filler phrases like
"sure thing!" or "happy to help!" Just produce the output.`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, true);
});

Deno.test("Addendum with the 🌿 motif → ok (it's the one allowed emoji)", () => {
  const text = `Olive's response prefix is 🌿. Use it consistently.`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, true);
});

Deno.test("Empty string → ok (nothing to violate)", () => {
  const result = lintBrandVoice("");
  assertEquals(result.ok, true);
  assertEquals(result.violations, []);
});

Deno.test("Non-string input does not crash", () => {
  // deno-lint-ignore no-explicit-any
  const result = lintBrandVoice(undefined as any);
  assertEquals(result.ok, true);
});

// ─── Forbidden phrases ─────────────────────────────────────────────────

Deno.test('Detects "supercharge" (case-insensitive)', () => {
  const result = lintBrandVoice("Supercharge your responses with more enthusiasm");
  assertEquals(result.ok, false);
  assertStringIncludes(result.violations[0], "supercharge");
});

Deno.test('Detects "supercharged" / "supercharging" via word-boundary regex', () => {
  assertEquals(lintBrandVoice("supercharged interactions").ok, false);
  assertEquals(lintBrandVoice("supercharging the workflow").ok, false);
});

Deno.test('Detects "10x"', () => {
  const result = lintBrandVoice("Make Olive 10x more helpful");
  assertEquals(result.ok, false);
  assertStringIncludes(result.violations[0], "10x");
});

Deno.test('Detects "AI-powered" with hyphen, space, or no separator', () => {
  for (const variant of ["AI-powered", "AI powered", "AIpowered", "ai-Powered"]) {
    const result = lintBrandVoice(`Position Olive as an ${variant} assistant`);
    assertEquals(result.ok, false, `failed on variant: ${variant}`);
  }
});

Deno.test('Detects "leveraging machine learning" as a phrase', () => {
  const result = lintBrandVoice(
    "Olive succeeds by leveraging machine learning across user interactions",
  );
  assertEquals(result.ok, false);
});

Deno.test('Does NOT flag bare "leverage" — too many legitimate uses', () => {
  const result = lintBrandVoice("Leverage the user's prior context");
  assertEquals(result.ok, true);
});

Deno.test('Does NOT flag bare "platform" — too many legitimate uses', () => {
  const result = lintBrandVoice("Treat the messaging platform as input only");
  assertEquals(result.ok, true);
});

Deno.test('Detects "next-gen" / "nextgen"', () => {
  assertEquals(lintBrandVoice("Olive is a next-gen assistant").ok, false);
  assertEquals(lintBrandVoice("Adopt nextgen patterns").ok, false);
});

Deno.test('Detects "leading provider"', () => {
  const result = lintBrandVoice("Olive is the leading provider of family memory");
  assertEquals(result.ok, false);
});

Deno.test('Word boundaries prevent false positives on substrings', () => {
  // "tense" should NOT match "intense"; "10x" should NOT match "1010xyz".
  assertEquals(lintBrandVoice("the user is intense about this").ok, true);
  assertEquals(lintBrandVoice("identifier 1010xyz appears").ok, true);
});

// ─── Exclamation-mark threshold ────────────────────────────────────────

Deno.test("Three exclamation marks → ok (boundary)", () => {
  const text = `Be warm! Be direct! Be helpful!`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, true);
});

Deno.test("Four exclamation marks → flagged", () => {
  const text = `Be warm! Be direct! Be helpful! Be quick!`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, false);
  assertStringIncludes(result.violations[0], "exclamation");
});

Deno.test("Many exclamation marks → flagged with count", () => {
  const text = `Wow! Amazing! Fantastic! Incredible! Excellent! Outstanding!`;
  const result = lintBrandVoice(text);
  assertEquals(result.ok, false);
  // Should report the actual count
  assertStringIncludes(result.violations[0], "6");
});

// ─── Non-🌿 emoji ──────────────────────────────────────────────────────

Deno.test("Any non-🌿 emoji → flagged", () => {
  for (const emoji of ["🎉", "✨", "🛒", "💝", "🚀", "💪"]) {
    const result = lintBrandVoice(`Add ${emoji} to make responses pop`);
    assertEquals(result.ok, false, `failed on emoji: ${emoji}`);
    assertStringIncludes(result.violations[0], "emoji");
  }
});

Deno.test("Multiple non-🌿 emojis → flagged with distinct list", () => {
  const text = "Use 🎉 and ✨ and 🛒 to make things pop 🎉🎉🎉";
  const result = lintBrandVoice(text);
  assertEquals(result.ok, false);
  // Should mention the count
  assertStringIncludes(result.violations[0], "6 occurrences");
  // Should de-dupe in the listed examples
  assertStringIncludes(result.violations[0], "🎉");
});

Deno.test("🌿 with non-🌿 emoji → still flagged for the non-🌿 one", () => {
  const text = "Olive's prefix is 🌿 but never 🎉";
  const result = lintBrandVoice(text);
  assertEquals(result.ok, false);
  // 🎉 is the violation; 🌿 isn't
  assertStringIncludes(result.violations[0], "🎉");
});

// ─── Composite cases ───────────────────────────────────────────────────

Deno.test("Multiple violations → all reported", () => {
  const text = "Supercharge Olive with 10x AI-powered enthusiasm! ✨!!!";
  const result = lintBrandVoice(text);
  assertEquals(result.ok, false);
  // At least 4 distinct violations expected: supercharge, 10x, AI-powered, exclamations, emoji
  // (the exact number depends on how the patterns count, but should be ≥ 4)
  assertEquals(result.violations.length >= 4, true);
});

Deno.test("Deterministic: same input twice yields identical result", () => {
  const text = "Supercharge with 10x energy! 🎉 Wow!! 🎉🎉";
  const r1 = lintBrandVoice(text);
  const r2 = lintBrandVoice(text);
  assertEquals(r1, r2);
});
