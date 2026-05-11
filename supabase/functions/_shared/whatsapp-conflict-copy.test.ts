// Tests for _shared/whatsapp-conflict-copy.ts
// WhatsApp's voice diverges from web's markdown style — these pin the
// emoji + en/es/it copy contract.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildWhatsAppConflictSuffix } from "./whatsapp-conflict-copy.ts";
import type { ConflictSummary } from "./conflict-detector.ts";

const tz = "America/New_York";

function timed(title: string, startIso: string): ConflictSummary {
  return {
    id: "id",
    title,
    start_time: startIso,
    end_time: startIso,
    all_day: false,
    note_id: null,
    overlap_minutes: 30,
    severity: "overlap",
  };
}

function allDay(title: string): ConflictSummary {
  return {
    id: "id",
    title,
    start_time: "2026-05-14T00:00:00Z",
    end_time: "2026-05-15T00:00:00Z",
    all_day: true,
    note_id: null,
    overlap_minutes: 60,
    severity: "overlap",
  };
}

function adjacent(title: string, startIso: string, after: boolean): ConflictSummary {
  return {
    id: "id",
    title,
    start_time: startIso,
    end_time: startIso,
    all_day: false,
    note_id: null,
    overlap_minutes: after ? 5 : -5,
    severity: "adjacent",
  };
}

// ─── Empty / undefined ────────────────────────────────────────────────

Deno.test("buildWhatsAppConflictSuffix: undefined → empty", () => {
  assertEquals(buildWhatsAppConflictSuffix(undefined, "en", tz), "");
});

Deno.test("buildWhatsAppConflictSuffix: empty array → empty", () => {
  assertEquals(buildWhatsAppConflictSuffix([], "en", tz), "");
});

// ─── Single conflicts ─────────────────────────────────────────────────

Deno.test("buildWhatsAppConflictSuffix: 1 timed (en) → ⚠️ + 'Heads up' + title", () => {
  const out = buildWhatsAppConflictSuffix([timed("Dinner with Sara", "2026-05-14T22:30:00Z")], "en", tz);
  assert(out.includes("⚠️"));
  assert(out.toLowerCase().includes("heads up"));
  assert(out.includes("Dinner with Sara"));
});

Deno.test("buildWhatsAppConflictSuffix: 1 timed (es) → 'Aviso' lead", () => {
  const out = buildWhatsAppConflictSuffix([timed("Cena", "2026-05-14T22:30:00Z")], "es", tz);
  assert(out.includes("Aviso"));
  assert(out.includes("Cena"));
});

Deno.test("buildWhatsAppConflictSuffix: 1 timed (it) → 'Attenzione' lead", () => {
  const out = buildWhatsAppConflictSuffix([timed("Cena", "2026-05-14T22:30:00Z")], "it", tz);
  assert(out.includes("Attenzione"));
});

Deno.test("buildWhatsAppConflictSuffix: BCP-47 'es-ES' normalizes", () => {
  const out = buildWhatsAppConflictSuffix([timed("Cena", "2026-05-14T22:30:00Z")], "es-ES", tz);
  assert(out.includes("Aviso"));
});

// ─── All-day ──────────────────────────────────────────────────────────

Deno.test("buildWhatsAppConflictSuffix: all-day (en) → 'on that day'", () => {
  const out = buildWhatsAppConflictSuffix([allDay("Off-site")], "en", tz);
  assert(out.includes("Off-site"));
  assert(out.toLowerCase().includes("that day"));
});

Deno.test("buildWhatsAppConflictSuffix: all-day (it) → 'quel giorno'", () => {
  const out = buildWhatsAppConflictSuffix([allDay("Off-site")], "it", tz);
  assert(out.includes("quel giorno"));
});

// ─── Adjacent ─────────────────────────────────────────────────────────

Deno.test("buildWhatsAppConflictSuffix: adjacent-after (en) → 'right after'", () => {
  const out = buildWhatsAppConflictSuffix(
    [adjacent("Gym", "2026-05-14T22:00:00Z", true)],
    "en",
    tz,
  );
  assert(out.toLowerCase().includes("right after"));
});

Deno.test("buildWhatsAppConflictSuffix: adjacent-before (en) → 'right before'", () => {
  const out = buildWhatsAppConflictSuffix(
    [adjacent("Coffee", "2026-05-14T22:00:00Z", false)],
    "en",
    tz,
  );
  assert(out.toLowerCase().includes("right before"));
});

// ─── Multi-conflict ──────────────────────────────────────────────────

Deno.test("buildWhatsAppConflictSuffix: 2 conflicts (en) → '2 things'", () => {
  const out = buildWhatsAppConflictSuffix(
    [
      timed("Dinner", "2026-05-14T22:30:00Z"),
      timed("Gym", "2026-05-14T23:45:00Z"),
    ],
    "en",
    tz,
  );
  assert(out.includes("2 things"));
  assert(out.includes("Dinner"));
  assert(out.includes("Gym"));
});

Deno.test("buildWhatsAppConflictSuffix: 5 conflicts → summarized, not enumerated", () => {
  const cs = ["A", "B", "C", "D", "E"].map((t) => timed(t, "2026-05-14T22:00:00Z"));
  const out = buildWhatsAppConflictSuffix(cs, "en", tz);
  assert(out.includes("5 events"));
  // Don't list individual titles for noisy schedules
  assert(!out.includes("A,") && !out.includes("E"));
});

Deno.test("buildWhatsAppConflictSuffix: 3 conflicts (es) → 'y' connector", () => {
  const cs = [
    timed("A", "2026-05-14T22:00:00Z"),
    timed("B", "2026-05-14T22:30:00Z"),
    timed("C", "2026-05-14T23:00:00Z"),
  ];
  const out = buildWhatsAppConflictSuffix(cs, "es", tz);
  assert(out.includes(" y "));
});

Deno.test("buildWhatsAppConflictSuffix: 3 conflicts (it) → 'e' connector", () => {
  const cs = [
    timed("A", "2026-05-14T22:00:00Z"),
    timed("B", "2026-05-14T22:30:00Z"),
    timed("C", "2026-05-14T23:00:00Z"),
  ];
  const out = buildWhatsAppConflictSuffix(cs, "it", tz);
  assert(out.includes(" e "));
});
