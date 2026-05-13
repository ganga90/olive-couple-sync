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
  classifyListMode,
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
  // Checklist headers always stay in siblings mode — each pet errand is
  // its own task, not a sub-bullet of a parent note.
  assertEquals(result!.mode, "siblings");
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

// ─── ListMode classifier — sub-items vs siblings ─────────────────────
//
// Why these tests matter: the screenshot bug had a *second* failure
// behind the missed header — once Olive recognized "Examples for hard
// rock stadium" as a header, the brain dump below it was still being
// saved as five SIBLING tasks ("Replay", "Suite support", "Music", …)
// scattered through the user's list, rather than as one parent note
// with the five items as sub-bullets. The classifier decides which
// shape a list takes; these tests pin that decision down for the
// patterns we expect to see in the wild while preserving the legacy
// "siblings" mode for every existing checklist-style input.

Deno.test("noun-phrase header (the second screenshot bug) — Examples for X → subitems", () => {
  // This is the exact message from the production WhatsApp screenshot.
  // Before the fix: 6 sibling notes including "Examples for hard rock
  // stadium" as a phantom row. After: one parent note titled by the
  // header, with the five brain-dump items as sub-bullets.
  const input =
    "Examples for hard rock stadium\n\n" +
    "Replay\n" +
    "Find distance to position concessions and concession maps\n" +
    "Suite support\n" +
    "Music\n" +
    "Partner/sponsorship";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Examples for hard rock stadium");
  assertEquals(result!.items.length, 5);
  assertEquals(result!.items[0], "Replay");
  assertEquals(result!.items[4], "Partner/sponsorship");
  assertEquals(result!.mode, "subitems");
});

Deno.test("conceptual header — Ideas for the trip → subitems", () => {
  const input =
    "Ideas for the trip\n" +
    "beach day\n" +
    "wine tour\n" +
    "fishing charter\n" +
    "sunset cruise";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Ideas for the trip");
  assertEquals(result!.mode, "subitems");
});

Deno.test("conceptual header — Topics with colon and bullets → subitems", () => {
  const input =
    "Topics for the meeting:\n" +
    "- pricing tier\n" +
    "- team structure\n" +
    "- launch timeline";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Topics for the meeting:");
  assertEquals(result!.items, ["pricing tier", "team structure", "launch timeline"]);
  assertEquals(result!.mode, "subitems");
});

Deno.test("conceptual header in Spanish — Ejemplos para X → subitems", () => {
  const input =
    "Ejemplos para Madrid\n" +
    "Plaza Mayor\n" +
    "Retiro\n" +
    "Museo del Prado\n" +
    "Mercado de San Miguel";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Ejemplos para Madrid");
  assertEquals(result!.mode, "subitems");
});

Deno.test("conceptual header in Italian — Idee per la cena → subitems", () => {
  const input =
    "Idee per la cena\n" +
    "pasta al pesto\n" +
    "insalata di tonno\n" +
    "tiramisù";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Idee per la cena");
  assertEquals(result!.mode, "subitems");
});

Deno.test("conceptual header but items are action verbs → siblings", () => {
  // "Action items" is a conceptual-sounding header, BUT the items
  // themselves are all verb-led tasks. We must not bundle five
  // discrete to-dos into one parent — that would hide real work
  // inside a JSONB blob.
  const input =
    "Action items from the call:\n" +
    "Call vendor about pricing\n" +
    "Send proposal to Sarah\n" +
    "Schedule follow-up\n" +
    "Update the spec doc";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.mode, "siblings");
});

Deno.test("conceptual header but an item carries its own date → siblings", () => {
  // Items with independent time anchors are scheduled tasks regardless
  // of how the header reads. Saving them as sub-bullets would lose the
  // due date in the user's reminders surface.
  const input =
    "Topics for next week\n" +
    "pricing review tomorrow\n" +
    "team offsite\n" +
    "vendor demo";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.mode, "siblings");
});

Deno.test("shopping list explicit header → siblings (regression)", () => {
  // Hard-coded protection: a user who literally typed "Shopping list"
  // wants discrete grocery tasks, even though the items are short noun
  // phrases that otherwise look subitem-shaped.
  const input =
    "Shopping list:\n" +
    "milk\n" +
    "eggs\n" +
    "bread";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.header, "Shopping list:");
  assertEquals(result!.mode, "siblings");
});

Deno.test("things to do header → siblings (regression)", () => {
  const input =
    "Things to do tomorrow:\n" +
    "Buy milk\n" +
    "Call dentist\n" +
    "Book restaurant";
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.mode, "siblings");
});

Deno.test("prose with header keyword mid-sentence is NOT a header", () => {
  // "discussion" was added to HEADER_KEYWORDS to catch headers like
  // "Discussion topics:". But the keyword check is anchored to the
  // start of the line so this paragraph-shaped sentence — which
  // happens to contain "discussion" at character 51 — must NOT be
  // misread as a header.
  const input =
    "I want to talk about a few examples we ran in the discussion\n" +
    "tipo A\n" +
    "tipo B";
  const result = detectMultiItem(input);
  // First line is 60+ chars and doesn't start with a keyword → no
  // header. Pattern 3 may still split if avg length permits, but no
  // header should be detected.
  if (result !== null) {
    assertEquals(result.header, null);
  }
});

Deno.test("conceptual header but too many items → siblings (defensive cap)", () => {
  // Lists with > 10 items are almost always task lists, not brain
  // dumps. Defensive cap so a long actionable list never gets buried
  // inside a sub-items array.
  const items = [
    "Item one",
    "Item two",
    "Item three",
    "Item four",
    "Item five",
    "Item six",
    "Item seven",
    "Item eight",
    "Item nine",
    "Item ten",
    "Item eleven",
  ];
  const input = "Topics for the project\n" + items.join("\n");
  const result = detectMultiItem(input);
  assertNotEquals(result, null);
  assertEquals(result!.mode, "siblings");
});

Deno.test("conceptual header with one item → null (need ≥ 2 items for a list)", () => {
  // detectHeader already requires ≥ 2 following lines. This test
  // documents that the mode classifier never gets a chance to fire
  // on degenerate single-item input.
  const input =
    "Examples for the meeting:\n" +
    "topic A";
  const result = detectMultiItem(input);
  // Pattern 3 needs 2 lines AND avg < 80 — this passes, but the
  // header detector requires 2+ following lines. Result: 2-line
  // split with no header, mode siblings.
  assertNotEquals(result, null);
  assertEquals(result!.header, null);
  assertEquals(result!.mode, "siblings");
});

// ─── classifyListMode — unit tests on the classifier itself ───────────

Deno.test("classifyListMode: null header → siblings", () => {
  assertEquals(classifyListMode(null, ["a", "b", "c"]), "siblings");
});

Deno.test("classifyListMode: checklist header → siblings even with noun-phrase items", () => {
  assertEquals(
    classifyListMode("Shopping list:", ["milk", "eggs", "bread"]),
    "siblings",
  );
});

Deno.test("classifyListMode: conceptual header + noun-phrase items → subitems", () => {
  assertEquals(
    classifyListMode("Examples for Madrid", ["Retiro", "Plaza Mayor", "Prado"]),
    "subitems",
  );
});

Deno.test("classifyListMode: conceptual header + verb-led items → siblings", () => {
  assertEquals(
    classifyListMode("Ideas for the launch", [
      "Call the vendor",
      "Schedule the demo",
      "Send the proposal",
    ]),
    "siblings",
  );
});

Deno.test("classifyListMode: items carrying their own dates → siblings", () => {
  assertEquals(
    classifyListMode("Topics for next week", [
      "design review tomorrow",
      "vendor call",
      "offsite",
    ]),
    "siblings",
  );
});

Deno.test("classifyListMode: too few or too many items → siblings", () => {
  // < 2 items
  assertEquals(classifyListMode("Examples", ["one"]), "siblings");
  // > 10 items
  const many = Array.from({ length: 11 }, (_, i) => `item ${i}`);
  assertEquals(classifyListMode("Examples", many), "siblings");
});

Deno.test("classifyListMode: very long items on average → siblings", () => {
  // Long items look more like prose tasks than sub-bullets of one
  // concept; don't bundle them into a single note.
  const longItems = [
    "this is a much longer item that reads more like a sentence than a label",
    "another longer item that probably represents a real task",
    "yet another long-form description that doesn't belong in a sub-bullet",
  ];
  assertEquals(classifyListMode("Examples for X", longItems), "siblings");
});
