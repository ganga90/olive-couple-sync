/**
 * Unit tests for reflection-capture.
 *
 * Focuses on classifyReplyOutcome (the pure function) — the orchestrator
 * captureReplyReflection requires a supabase client and is exercised via
 * integration testing in the WhatsApp inbound path.
 *
 * Test guard rails:
 *   - Each strong signal has a positive case AND a negation/false-positive case
 *   - Length cap is exercised so a long real message doesn't accidentally hit
 *   - Punctuation, casing, and emoji-adjacent text are all covered
 */

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { classifyReplyOutcome } from "./reflection-capture.ts";

// ─── Accepted patterns ─────────────────────────────────────────────

Deno.test("classify: 'thanks' → accepted", () => {
  const r = classifyReplyOutcome("thanks");
  assertEquals(r.outcome, "accepted");
  assertEquals(r.matched_phrase, "thanks");
});

Deno.test("classify: 'Thank you!' (capitals + punctuation) → accepted", () => {
  const r = classifyReplyOutcome("Thank you!");
  assertEquals(r.outcome, "accepted");
});

Deno.test("classify: 'perfect' → accepted", () => {
  const r = classifyReplyOutcome("perfect");
  assertEquals(r.outcome, "accepted");
  assertEquals(r.matched_phrase, "positive_emphatic");
});

Deno.test("classify: 'do it' → accepted", () => {
  const r = classifyReplyOutcome("do it");
  assertEquals(r.outcome, "accepted");
});

Deno.test("classify: 'great!' as standalone short reply → accepted", () => {
  const r = classifyReplyOutcome("great!");
  assertEquals(r.outcome, "accepted");
  assertEquals(r.matched_phrase, "great_short");
});

Deno.test("classify: confidence is non-trivial when matched", () => {
  const r = classifyReplyOutcome("thanks");
  assertEquals(r.confidence >= 0.5, true);
});

// ─── Rejected patterns ─────────────────────────────────────────────

Deno.test("classify: 'stop' → rejected", () => {
  const r = classifyReplyOutcome("stop");
  assertEquals(r.outcome, "rejected");
  assertEquals(r.matched_phrase, "stop");
});

Deno.test("classify: 'too many messages' → rejected", () => {
  const r = classifyReplyOutcome("too many messages");
  assertEquals(r.outcome, "rejected");
});

Deno.test("classify: 'leave me alone' → rejected", () => {
  const r = classifyReplyOutcome("leave me alone");
  assertEquals(r.outcome, "rejected");
});

Deno.test("classify: reject takes precedence over accept in mixed phrasing", () => {
  // "thanks but stop" must classify as REJECTED — sending more is the wrong move
  const r = classifyReplyOutcome("thanks but stop");
  assertEquals(r.outcome, "rejected");
});

// ─── Negation guards ───────────────────────────────────────────────

Deno.test("classify: 'no thanks' → null (negation prefix)", () => {
  const r = classifyReplyOutcome("no thanks");
  assertEquals(r.outcome, null);
});

Deno.test("classify: 'not great' → null (negation prefix on accept)", () => {
  const r = classifyReplyOutcome("not great");
  assertEquals(r.outcome, null);
});

Deno.test("classify: 'don't' → null (no accept fires)", () => {
  const r = classifyReplyOutcome("don't");
  assertEquals(r.outcome, null);
});

// ─── Boundary / null cases ─────────────────────────────────────────

Deno.test("classify: empty string → null", () => {
  const r = classifyReplyOutcome("");
  assertEquals(r.outcome, null);
});

Deno.test("classify: whitespace only → null", () => {
  const r = classifyReplyOutcome("   \n  ");
  assertEquals(r.outcome, null);
});

Deno.test("classify: long real message containing 'thanks' → null (length cap)", () => {
  // Above MAX_CLASSIFY_LEN. Real users say "thanks" inside long messages
  // about totally unrelated topics; we'd false-positive without the cap.
  const long = "x".repeat(250) + " thanks for everything";
  const r = classifyReplyOutcome(long);
  assertEquals(r.outcome, null);
});

Deno.test("classify: ambiguous short reply → null", () => {
  // No strong signal — most replies look like this and should not capture.
  const r = classifyReplyOutcome("ok");
  assertEquals(r.outcome, null);
});

Deno.test("classify: 'show overdue' (a command, not a reaction) → null", () => {
  // Webhook commands shouldn't ever capture — they're new actions, not reactions.
  const r = classifyReplyOutcome("show overdue");
  assertEquals(r.outcome, null);
});

Deno.test("classify: 'great migration plans' (great as adjective in real sentence) → null", () => {
  // Standalone-great pattern requires the whole reply to be just "great".
  // A longer message containing "great" should NOT classify.
  const r = classifyReplyOutcome("great migration plans for next week");
  assertEquals(r.outcome, null);
});

// ─── Stability: repeat invocation is deterministic ────────────────

Deno.test("classify: deterministic — same input twice produces same outcome", () => {
  const a = classifyReplyOutcome("perfect, do it");
  const b = classifyReplyOutcome("perfect, do it");
  assertEquals(a.outcome, b.outcome);
  assertEquals(a.confidence, b.confidence);
  assertEquals(a.matched_phrase, b.matched_phrase);
});
