// Tests for the shared locale helpers. These are tiny but load-bearing:
// every other i18n module in PR1 imports `normalizeLocale` from here, so a
// regression here becomes a regression everywhere — RESPONSES lookup,
// formatFriendlyDate, parseNaturalDate, AI prompt language injection.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LOCALE_DISPLAY_NAMES,
  SUPPORTED_LOCALES,
  localeDisplayName,
  normalizeLocale,
} from "./i18n-locale.ts";

// ---------- normalizeLocale ----------

Deno.test("normalizeLocale: short codes pass through", () => {
  assertEquals(normalizeLocale("en"), "en");
  assertEquals(normalizeLocale("es"), "es");
  assertEquals(normalizeLocale("it"), "it");
});

Deno.test("normalizeLocale: BCP-47 long codes are stripped to short", () => {
  assertEquals(normalizeLocale("en-US"), "en");
  assertEquals(normalizeLocale("en-GB"), "en");
  assertEquals(normalizeLocale("es-ES"), "es");
  assertEquals(normalizeLocale("es-MX"), "es");
  assertEquals(normalizeLocale("it-IT"), "it");
});

Deno.test("normalizeLocale: case-insensitive", () => {
  assertEquals(normalizeLocale("EN"), "en");
  assertEquals(normalizeLocale("It-It"), "it");
  assertEquals(normalizeLocale("ES-MX"), "es");
});

Deno.test("normalizeLocale: non-BCP-47 separators (underscore) → en fallback", () => {
  // BCP-47 uses hyphen, not underscore. We don't try to be clever with
  // alt separators — anything we don't recognize falls back to en. This
  // matches the historical RESPONSES lookup behavior exactly.
  assertEquals(normalizeLocale("es_ES"), "en");
  assertEquals(normalizeLocale("it_IT"), "en");
});

Deno.test("normalizeLocale: empty/null/undefined → en", () => {
  assertEquals(normalizeLocale(""), "en");
  assertEquals(normalizeLocale(null), "en");
  assertEquals(normalizeLocale(undefined), "en");
});

Deno.test("normalizeLocale: unsupported language → en (preserves historical fallback)", () => {
  // The WhatsApp RESPONSES lookup has always defaulted to 'en' for
  // unknown locales. We must preserve that — switching to an exception
  // here would crash the gateway for any user with an exotic locale.
  assertEquals(normalizeLocale("fr"), "en");
  assertEquals(normalizeLocale("de-DE"), "en");
  assertEquals(normalizeLocale("zh-CN"), "en");
  assertEquals(normalizeLocale("xx"), "en");
});

Deno.test("normalizeLocale: non-string inputs → en", () => {
  // deno-lint-ignore no-explicit-any
  assertEquals(normalizeLocale(123 as any), "en");
  // deno-lint-ignore no-explicit-any
  assertEquals(normalizeLocale({} as any), "en");
});

Deno.test("normalizeLocale: whitespace is trimmed", () => {
  assertEquals(normalizeLocale("  it-IT  "), "it");
  assertEquals(normalizeLocale("\nes\n"), "es");
});

// ---------- localeDisplayName ----------

Deno.test("localeDisplayName: returns prompt-injectable name", () => {
  assertEquals(localeDisplayName("en"), "English");
  assertEquals(localeDisplayName("es"), "Spanish");
  assertEquals(localeDisplayName("it"), "Italian");
  assertEquals(localeDisplayName("it-IT"), "Italian");
  assertEquals(localeDisplayName("es-ES"), "Spanish");
});

Deno.test("localeDisplayName: unknown → English (matches normalizeLocale fallback)", () => {
  assertEquals(localeDisplayName("fr"), "English");
  assertEquals(localeDisplayName(""), "English");
  assertEquals(localeDisplayName(null), "English");
});

// ---------- SUPPORTED_LOCALES ----------

Deno.test("SUPPORTED_LOCALES: exactly the three Olive supports", () => {
  assertEquals(SUPPORTED_LOCALES.length, 3);
  assertEquals(SUPPORTED_LOCALES.includes("en"), true);
  assertEquals(SUPPORTED_LOCALES.includes("es"), true);
  assertEquals(SUPPORTED_LOCALES.includes("it"), true);
});

Deno.test("LOCALE_DISPLAY_NAMES: every supported locale has a display name", () => {
  for (const loc of SUPPORTED_LOCALES) {
    const name = LOCALE_DISPLAY_NAMES[loc];
    assertEquals(typeof name, "string");
    assertEquals(name.length > 0, true);
  }
});
