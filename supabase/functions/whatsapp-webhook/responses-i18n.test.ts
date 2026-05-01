// Validates the i18n contract for the WhatsApp RESPONSES table.
//
// PR2 adds many new RESPONSES keys (confirm_*, done_*, smart_reminder_*,
// merge_*, date_unparseable, ...). It's easy to forget a locale or
// mistype a placeholder. A static-text scan catches these cheaply
// without spinning up the whole webhook.
//
// What we validate:
//   1. Every new key has all three required locales (en/es/it).
//   2. The placeholder set ({task}, {when}, ...) is identical across
//      locales for the same key — otherwise the t() helper substitutes
//      one locale's placeholders but leaves another's literal.
//
// This is a static parser, not a runtime test — keeps the test file
// independent from the 7,000-line webhook module's transitive imports.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const WEBHOOK_PATH =
  new URL("./index.ts", import.meta.url).pathname;

const REQUIRED_LOCALES = ["en", "es", "it"] as const;

// All new keys added in PR1 + PR2 that participate in the localized
// reply path. If you add a key, add it here. Failing tests will tell
// you exactly which locale is missing.
const NEW_PR1_PR2_KEYS = [
  // PR1
  "note_reminder_set",
  "confirm_set_due",
  "confirm_set_reminder",
  "confirm_assign",
  "confirm_delete",
  "confirm_merge",
  "done_set_due",
  "done_set_reminder",
  "done_assign",
  "done_delete",
  "done_merge",
  "date_unparseable",
  // PR2
  "smart_reminder_30min",
  "smart_reminder_2h_before",
  "smart_reminder_evening_morning",
  "smart_reminder_morning_of",
  "smart_reminder_tomorrow_9am",
  "move_need_list_name",
  "move_failed",
  "task_action_unknown",
  "merge_no_recent",
  "merge_no_similar",
];

const FILE_TEXT = await Deno.readTextFile(WEBHOOK_PATH);

/**
 * Extract the substring for a given RESPONSES key — i.e. everything
 * between `<key>: {` and the matching closing `}`. Brace-balanced so
 * nested template-literal braces don't confuse it.
 */
function extractKeyBody(key: string): string | null {
  const start = FILE_TEXT.indexOf(`\n  ${key}: {`);
  if (start === -1) return null;
  // Walk from the opening brace, tracking depth so we don't get
  // tripped up by `${...}` interpolations.
  const openIdx = FILE_TEXT.indexOf("{", start);
  let depth = 0;
  for (let i = openIdx; i < FILE_TEXT.length; i++) {
    const ch = FILE_TEXT[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return FILE_TEXT.slice(openIdx + 1, i);
    }
  }
  return null;
}

function localesPresent(body: string): Set<string> {
  const found = new Set<string>();
  // Match  en: '...'  or  'en': '...'  or  en: "..." (any quote style).
  const re = /(?:^|\n)\s*(?:'?(en|es|it)'?)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) found.add(m[1]);
  return found;
}

function placeholdersIn(body: string, locale: string): Set<string> {
  // Look for `<locale>: '...{ph}...'` (and double-quoted variants).
  const re = new RegExp(
    `(?:^|\\n)\\s*'?${locale}'?\\s*:\\s*['"\`]([\\s\\S]*?)['"\`]\\s*,`,
    "m",
  );
  const m = body.match(re);
  if (!m) return new Set();
  const placeholders = new Set<string>();
  const phRe = /\{(\w+)\}/g;
  let pm: RegExpExecArray | null;
  while ((pm = phRe.exec(m[1])) !== null) placeholders.add(pm[1]);
  return placeholders;
}

// ---------- Locale completeness ----------

for (const key of NEW_PR1_PR2_KEYS) {
  Deno.test(`RESPONSES["${key}"] has en + es + it`, () => {
    const body = extractKeyBody(key);
    if (body === null) {
      throw new Error(`Key "${key}" not found in RESPONSES table`);
    }
    const present = localesPresent(body);
    for (const loc of REQUIRED_LOCALES) {
      assertEquals(
        present.has(loc),
        true,
        `Key "${key}" is missing locale "${loc}". Found: [${[...present].join(", ")}]`,
      );
    }
  });
}

// ---------- Placeholder consistency ----------

for (const key of NEW_PR1_PR2_KEYS) {
  Deno.test(`RESPONSES["${key}"] has consistent placeholders across locales`, () => {
    const body = extractKeyBody(key);
    if (body === null) {
      throw new Error(`Key "${key}" not found in RESPONSES table`);
    }
    const enSet = placeholdersIn(body, "en");
    const esSet = placeholdersIn(body, "es");
    const itSet = placeholdersIn(body, "it");

    // All three must be the same set. We compare by sorted-array
    // serialization so set-equality holds and assertEquals gives a
    // readable diff.
    const sortedEn = [...enSet].sort().join(",");
    const sortedEs = [...esSet].sort().join(",");
    const sortedIt = [...itSet].sort().join(",");

    assertEquals(
      sortedEs,
      sortedEn,
      `Key "${key}": es placeholders {${sortedEs}} differ from en {${sortedEn}}`,
    );
    assertEquals(
      sortedIt,
      sortedEn,
      `Key "${key}": it placeholders {${sortedIt}} differ from en {${sortedEn}}`,
    );
  });
}
