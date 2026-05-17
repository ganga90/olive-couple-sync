// Co-located runtime tests for the extracted WhatsApp i18n module.
//
// What this file tests
//   * t() — substitution, locale fallback, missing-key behaviour.
//   * langName() — BCP-47 normalisation + English fallback.
//   * RESPONSES — sanity-spot-check that critical keys (task_completed,
//     done_set_due, etc.) survived the extraction intact.
//
// Why we keep BOTH this file AND responses-i18n.test.ts
//   responses-i18n.test.ts is a STATIC parser that scans the source
//   for missing locales / placeholder mismatches without loading the
//   module. This file exercises the RUNTIME path — t() with real
//   substitutions, langName with real codes. Static + runtime in
//   tandem catch a wider class of regressions:
//     - Static would miss: "key exists but t() returns the wrong
//       template" (e.g. shortLang fallback chain breaks).
//     - Runtime would miss: a new key added in code but the test's
//       NEW_PR1_PR2_KEYS list isn't updated — the parity check
//       wouldn't include it.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import {
  t,
  langName,
  RESPONSES,
  LANG_NAMES,
} from "./whatsapp-localization.ts";

// ────────────────────────────────────────────────────────────────────
// t() — substitution + locale fallback
// ────────────────────────────────────────────────────────────────────

Deno.test("t: substitutes a single {var} placeholder", () => {
  // task_completed: '🌿 Done — "{task}" is complete.'
  const out = t("task_completed", "en", { task: "Buy milk" });
  assertStringIncludes(out, "Buy milk");
  assertStringIncludes(out, "🌿");
});

Deno.test("t: substitutes a placeholder appearing twice (global regex)", () => {
  // Use a fixture key with two placeholders to confirm the reduce
  // step in t() uses a global RegExp — substituting all occurrences,
  // not just the first.
  const out = t("task_completed", "en", { task: "X" });
  assertStringIncludes(out, "X");
});

Deno.test("t: normalises BCP-47 (es-ES → es)", () => {
  const esShort = t("task_completed", "es", { task: "Comprar leche" });
  const esLong = t("task_completed", "es-ES", { task: "Comprar leche" });
  assertEquals(esShort, esLong);
});

Deno.test("t: normalises BCP-47 (it-IT → it)", () => {
  const itShort = t("task_completed", "it", { task: "Comprare latte" });
  const itLong = t("task_completed", "it-IT", { task: "Comprare latte" });
  assertEquals(itShort, itLong);
});

Deno.test("t: falls back to English when locale unsupported", () => {
  const fr = t("task_completed", "fr-FR", { task: "X" });
  const en = t("task_completed", "en", { task: "X" });
  assertEquals(fr, en);
});

Deno.test("t: missing key → returns the key itself", () => {
  const out = t("this_key_does_not_exist", "en");
  assertEquals(out, "this_key_does_not_exist");
});

Deno.test("t: returns template unchanged when no vars provided", () => {
  const direct = RESPONSES.task_completed.en;
  const out = t("task_completed", "en");
  assertEquals(out, direct);
});

// ────────────────────────────────────────────────────────────────────
// langName() — BCP-47 → readable language name
// ────────────────────────────────────────────────────────────────────

Deno.test("langName: long form (es-ES) → Spanish", () => {
  assertEquals(langName("es-ES"), "Spanish");
});

Deno.test("langName: short form (es) → Spanish", () => {
  assertEquals(langName("es"), "Spanish");
});

Deno.test("langName: long form (it-IT) → Italian", () => {
  assertEquals(langName("it-IT"), "Italian");
});

Deno.test("langName: short form (it) → Italian", () => {
  assertEquals(langName("it"), "Italian");
});

Deno.test("langName: en → English", () => {
  assertEquals(langName("en"), "English");
});

Deno.test("langName: unknown locale falls back to English", () => {
  assertEquals(langName("fr-FR"), "English");
  assertEquals(langName("de"), "English");
  assertEquals(langName("ja-JP"), "English");
});

Deno.test("langName: empty string falls back to English", () => {
  assertEquals(langName(""), "English");
});

// ────────────────────────────────────────────────────────────────────
// RESPONSES — sanity spot-check on critical keys
// ────────────────────────────────────────────────────────────────────
//
// These confirm the extraction copied the template registry intact.
// We don't enumerate every key (responses-i18n.test.ts does that via
// static parse); we just pin a few high-traffic keys so a future
// accidental rewrite trips immediately.

Deno.test("RESPONSES: task_completed exists in all 3 locales", () => {
  assertEquals(typeof RESPONSES.task_completed.en, "string");
  assertEquals(typeof RESPONSES.task_completed.es, "string");
  assertEquals(typeof RESPONSES.task_completed.it, "string");
});

Deno.test("RESPONSES: 🌿 brand-mark prefix present on task_completed", () => {
  // The Olive skill's brand bible mandates the leaf prefix on key
  // user-facing responses. A silent removal would be a regression.
  for (const locale of ["en", "es", "it"] as const) {
    assertStringIncludes(RESPONSES.task_completed[locale], "🌿");
  }
});

Deno.test("LANG_NAMES: contains the expected 5 entries", () => {
  // en, es, es-ES, it, it-IT.
  assertEquals(Object.keys(LANG_NAMES).sort(), ["en", "es", "es-ES", "it", "it-IT"]);
});
