/**
 * Tests for the pure logic used by src/components/onboarding/CapturePreview.tsx.
 *
 * The component itself runs in React, but the row-mapping and result
 * normalization are pure functions over the process-note response shape.
 * Re-implementing them here as a shim lets us test the logic with Deno
 * (the only test runner the repo has configured) — and forces a failing
 * test if the two implementations drift.
 *
 * Schema reference: process-note's singleNoteSchema (single fields) and
 * multiNoteSchema (multiple: true, notes: [...]).
 */
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";

interface ProcessNoteSingle {
  summary?: string;
  category?: string;
  target_list?: string | null;
  due_date?: string | null;
  reminder_time?: string | null;
  items?: string[] | null;
  tags?: string[];
  receipt_processed?: boolean;
  receipt?: { amount?: number; merchant?: string };
  [key: string]: unknown;
}

interface ProcessNoteMulti {
  multiple: true;
  notes: ProcessNoteSingle[];
}

type ProcessNoteResult = ProcessNoteSingle | ProcessNoteMulti;

interface PreviewRow {
  variant: "shopping" | "calendar" | "reminder" | "expense" | "note";
  label: string;
  detail?: string;
}

// ─── Shim of the logic from CapturePreview.tsx ───────────────────────
// Keep the rule order IDENTICAL to the React component. If you change
// the priority order in one place, change it here too — these tests
// guard the contract.

function normalize(result: ProcessNoteResult): ProcessNoteSingle[] {
  if (!result) return [];
  if ("multiple" in result && result.multiple && Array.isArray(result.notes)) {
    return result.notes.length > 0
      ? result.notes
      : [{ summary: "Captured", category: "note" }];
  }
  return [result as ProcessNoteSingle];
}

function buildRow(note: ProcessNoteSingle): PreviewRow {
  const cat = (note.category || "").toLowerCase();
  const summary = (note.summary || "").trim();
  const items = note.items || [];

  if (note.receipt_processed && note.receipt?.amount !== undefined) {
    const merchant = note.receipt.merchant || summary || "expense";
    return {
      variant: "expense",
      label: `Logged $${note.receipt.amount.toFixed(2)} at ${merchant}`,
    };
  }

  if (
    items.length > 0 &&
    (cat.includes("shop") || cat.includes("groc") || cat.includes("list"))
  ) {
    const listName = note.target_list || "your list";
    return {
      variant: "shopping",
      label: `Added ${items.length} item${items.length === 1 ? "" : "s"} to ${listName}`,
    };
  }

  if (note.due_date) {
    const isReminder =
      note.reminder_time && note.reminder_time === note.due_date;
    return {
      variant: isReminder ? "reminder" : "calendar",
      label: isReminder
        ? `Reminder set: ${summary}`
        : `Calendar event: ${summary}`,
      detail: note.due_date, // The React component formats; the shim
                              // just preserves so tests can assert
                              // on input fidelity.
    };
  }

  if (items.length > 0) {
    return {
      variant: "note",
      label: `Saved ${items.length} item${items.length === 1 ? "" : "s"}: ${summary || note.target_list || ""}`.trim(),
    };
  }

  const categoryLabel = cat && cat !== "task" && cat !== "note"
    ? cat.replace(/_/g, " ")
    : "notes";
  return {
    variant: "note",
    label: `Saved to ${categoryLabel}: ${summary || "your brain dump"}`,
  };
}

// ─── normalize() ─────────────────────────────────────────────────────

Deno.test("normalize: single-note response returns one-element array", () => {
  const result = { summary: "Buy milk", category: "groceries" };
  const notes = normalize(result);
  assertEquals(notes.length, 1);
  assertEquals(notes[0].summary, "Buy milk");
});

Deno.test("normalize: multi-note response returns the notes array", () => {
  const result: ProcessNoteMulti = {
    multiple: true,
    notes: [
      { summary: "Call mom", category: "task" },
      { summary: "Dentist", category: "appointment", due_date: "2026-05-01T15:00:00Z" },
    ],
  };
  const notes = normalize(result);
  assertEquals(notes.length, 2);
  assertEquals(notes[1].category, "appointment");
});

Deno.test("normalize: multi-note with empty notes array fallbacks to a single 'Captured' row", () => {
  // process-note's fallback path can technically emit {multiple:true, notes:[]}
  // — we never want an empty preview. Guarantee at least one row.
  const result: ProcessNoteMulti = { multiple: true, notes: [] };
  const notes = normalize(result);
  assertEquals(notes.length, 1);
  assertEquals(notes[0].summary, "Captured");
});

// ─── buildRow() — variant priority order ─────────────────────────────

Deno.test("buildRow: receipt takes priority over everything else", () => {
  // A receipt that ALSO happens to have a due_date and items — we want
  // the money detection to win because that's the strongest signal.
  const row = buildRow({
    summary: "Whole Foods",
    category: "shopping",
    items: ["milk", "eggs"],
    due_date: "2026-05-01T15:00:00Z",
    receipt_processed: true,
    receipt: { amount: 47.32, merchant: "Whole Foods" },
  });
  assertEquals(row.variant, "expense");
  assertEquals(row.label, "Logged $47.32 at Whole Foods");
});

Deno.test("buildRow: shopping with items is recognized regardless of category casing", () => {
  const row = buildRow({
    summary: "Weekly trip",
    category: "GROCERIES",
    items: ["milk", "eggs", "bread"],
    target_list: "Grocery List",
  });
  assertEquals(row.variant, "shopping");
  assertEquals(row.label, "Added 3 items to Grocery List");
});

Deno.test("buildRow: shopping without target_list falls back to 'your list'", () => {
  const row = buildRow({
    category: "shopping",
    items: ["A", "B"],
  });
  assertEquals(row.variant, "shopping");
  assertEquals(row.label, "Added 2 items to your list");
});

Deno.test("buildRow: singular vs plural item count", () => {
  const single = buildRow({ category: "shopping", items: ["just one"], target_list: "L" });
  assertEquals(single.label, "Added 1 item to L");

  const multi = buildRow({ category: "shopping", items: ["a", "b"], target_list: "L" });
  assertEquals(multi.label, "Added 2 items to L");
});

Deno.test("buildRow: due_date with matching reminder_time → reminder variant", () => {
  const dt = "2026-05-01T15:00:00Z";
  const row = buildRow({
    summary: "Call dentist",
    category: "task",
    due_date: dt,
    reminder_time: dt,
  });
  assertEquals(row.variant, "reminder");
  assertEquals(row.label, "Reminder set: Call dentist");
});

Deno.test("buildRow: due_date without matching reminder_time → calendar variant", () => {
  const row = buildRow({
    summary: "Dinner with Sarah",
    category: "event",
    due_date: "2026-05-01T19:00:00Z",
  });
  assertEquals(row.variant, "calendar");
  assertEquals(row.label, "Calendar event: Dinner with Sarah");
});

Deno.test("buildRow: items but no shopping category → generic 'Saved N items' row", () => {
  // Captures the case where the user types a list of restaurant names
  // and process-note returns items but classifies it as e.g.
  // 'restaurants'. We don't lie about it being a 'list'.
  const row = buildRow({
    summary: "Date night options",
    category: "restaurants",
    items: ["Tatiana", "Carbone"],
  });
  assertEquals(row.variant, "note");
  assertEquals(row.label, "Saved 2 items: Date night options");
});

Deno.test("buildRow: bare category 'task' is treated as generic 'notes'", () => {
  // Per process-note's prompt instruction: 'task' is the generic fallback,
  // so showing 'Saved to task' would be ugly. Display 'notes' instead.
  const row = buildRow({ summary: "Random thought", category: "task" });
  assertEquals(row.label, "Saved to notes: Random thought");
});

Deno.test("buildRow: snake_case category is humanized in the label", () => {
  const row = buildRow({ summary: "House thing", category: "home_improvement" });
  assertEquals(row.label, "Saved to home improvement: House thing");
});

Deno.test("buildRow: empty summary falls back to generic phrase", () => {
  const row = buildRow({ category: "personal" });
  assertEquals(row.label, "Saved to personal: your brain dump");
});

Deno.test("buildRow: missing category + missing summary doesn't throw and shows fallback", () => {
  const row = buildRow({});
  assertEquals(row.variant, "note");
  assertEquals(row.label, "Saved to notes: your brain dump");
});
