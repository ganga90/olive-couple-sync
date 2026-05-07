// Tests for the multi-item / header detector used by process-note.
//
// Why these tests matter: the detector runs BEFORE the AI on every
// inbound brain dump. If it splits incorrectly, the user sees a phantom
// task (the bug case below) or — worse — a real task gets silently
// merged into the wrong note. We lock down both the legacy split
// behavior (numbered, bullet, multi-line, comma, "and" patterns) and
// the new header-stripping logic, including conservative rejections
// that prevent over-eager stripping of a real first task.

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  detectMultiItem,
  detectMultiItemInput,
} from "./multi-item-detect.ts";

// ─── Header detection — the bug case and its cousins ─────────────────

Deno.test("header + plain newline-separated items (the screenshot bug)", () => {
  const input =
    "Check-list for the pets tomorrow before leaving:\n" +
    "Milka food\n" +
    "Change cat litter\n" +
    "Videos of the house\n" +
    "Ring camera\n" +
    "Check water fountains";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Check-list for the pets tomorrow before leaving:");
  assertEquals(result!.items.length, 5);
  assertEquals(result!.items[0], "Milka food");
  assertEquals(result!.items[4], "Check water fountains");
});

Deno.test("header + numbered list strips the heading", () => {
  const input =
    "Things to do tomorrow:\n" +
    "1. Buy milk\n" +
    "2. Call dentist\n" +
    "3. Book restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Things to do tomorrow:");
  assertEquals(result!.items.length, 3);
  assertEquals(result!.items[0], "Buy milk");
});

Deno.test("header + bullet list strips the heading", () => {
  const input =
    "Shopping list:\n" +
    "- milk\n" +
    "- eggs\n" +
    "- bread";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Shopping list:");
  assertEquals(result!.items, ["milk", "eggs", "bread"]);
});

Deno.test("header without colon but with header keyword (Spanish)", () => {
  const input =
    "Lista de compras\n" +
    "leche\n" +
    "pan\n" +
    "huevos";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Lista de compras");
  assertEquals(result!.items.length, 3);
});

Deno.test("header in Italian with colon", () => {
  const input =
    "Cose da fare domani:\n" +
    "comprare il latte\n" +
    "chiamare il medico\n" +
    "prenotare il ristorante";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Cose da fare domani:");
  assertEquals(result!.items.length, 3);
});

// ─── Conservative rejections — don't strip a real task ───────────────

Deno.test("first line starts with action verb is NOT a header", () => {
  // "Buy these for dinner:" is itself a task to buy things; it must
  // remain in the items list, not be stripped as a header.
  const input =
    "Buy these for dinner:\n" +
    "milk\n" +
    "eggs";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 3);
  assertEquals(result!.items[0], "Buy these for dinner:");
});

Deno.test("only ONE item below the candidate header → don't strip", () => {
  // We require ≥2 items below to be confident it's a list, not just
  // a 2-line note where the first line happens to end in ":".
  const input =
    "Reminder for the meeting:\n" +
    "bring slides";
  const result = detectMultiItem(input);
  // 2-line input still goes through Pattern 3 multi-line split, but
  // header is NOT detected (only 1 line follows).
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 2);
});

Deno.test("colon in the middle of the line (a time) is not a header", () => {
  // "Meeting at 9:00 AM tomorrow" has a colon but it's a time, not a
  // header marker. The line doesn't END in ":".
  const input = "Meeting at 9:00 AM tomorrow";
  const result = detectMultiItem(input);
  // Single line, length > 10 — Pattern 3 needs ≥ 2 lines, so this
  // returns null (single-task path).
  assertEquals(result, null);
});

Deno.test("first line is a long sentence, not a header", () => {
  const input =
    "I was thinking about going to the store later today and maybe picking up a few things\n" +
    "milk\n" +
    "eggs";
  const result = detectMultiItem(input);
  // First line is > 80 chars → falls out of Pattern 3 (avgLen check).
  // The detector returns null and the AI handles it.
  assertEquals(result, null);
});

Deno.test("paragraph-style first line ending in colon is rejected when no keywords", () => {
  // Long line ends in ":" but has no header keywords or time hints —
  // ambiguous, fall through to AI.
  const input =
    "Here is everything I want to talk about during our discussion later this evening with the whole team:\n" +
    "topic A\n" +
    "topic B";
  const result = detectMultiItem(input);
  // First line is > 120 chars → fails the trimmed.every(< 120) check
  // in Pattern 3, falls through entirely to null.
  assertEquals(result, null);
});

// ─── Legacy behavior preservation ────────────────────────────────────

Deno.test("plain numbered list (no header) still splits all items", () => {
  const input = "1. Buy milk\n2. Call dentist\n3. Book restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 3);
});

Deno.test("plain bullet list (no header) still splits all items", () => {
  const input = "- milk\n- eggs\n- bread";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items, ["milk", "eggs", "bread"]);
});

Deno.test("plain multi-line tasks with no header still split", () => {
  const input = "Buy milk\nCall dentist\nBook restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 3);
  // First line starts with action verb — not a header.
  assertEquals(result!.items[0], "Buy milk");
});

Deno.test("comma-separated tasks still split", () => {
  const input = "buy milk, call doctor, book restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 3);
});

Deno.test("'and'-joined distinct actions still split", () => {
  const input = "buy milk and call doctor and book restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.items.length, 3);
});

Deno.test("single short task returns null (no split)", () => {
  const input = "fix the sink";
  const result = detectMultiItem(input);
  assertEquals(result, null);
});

Deno.test("very short input returns null", () => {
  const input = "milk";
  const result = detectMultiItem(input);
  assertEquals(result, null);
});

// ─── Legacy-compat wrapper ────────────────────────────────────────────

Deno.test("detectMultiItemInput wrapper returns plain array for non-header input", () => {
  const input = "1. Buy milk\n2. Call dentist";
  const result = detectMultiItemInput(input);
  assertNotEquals(result, null);
  assertEquals(result!.length, 2);
});

Deno.test("detectMultiItemInput wrapper returns items WITHOUT header for header input", () => {
  // Backwards compat: callers using the legacy shape get only the
  // items, header is silently dropped. They lose context propagation
  // but at least don't see the header as a phantom task.
  const input =
    "Pets checklist for tomorrow:\n" +
    "Milka food\n" +
    "Change cat litter\n" +
    "Check water fountains";
  const result = detectMultiItemInput(input);
  assertNotEquals(result, null);
  assertEquals(result!.length, 3);
  assertEquals(result![0], "Milka food");
});

Deno.test("detectMultiItemInput wrapper returns null when no structure detected", () => {
  const input = "fix the sink";
  const result = detectMultiItemInput(input);
  assertEquals(result, null);
});
