/**
 * Eval Harness — Fixture Loader
 * ==============================
 * Reads JSON fixture files from a directory, validates shape, returns
 * a typed EvalCase[]. Kept tiny + pure so Deno + Node can both use it.
 *
 * Design choice: one JSON file per case. Rationale:
 *   - Diff-friendly — adding / changing a case is a single-file diff.
 *   - Authorable by anyone — PMs, designers, even Claude can open one
 *     file and write a case without needing a TS toolchain.
 *   - Resilient — one malformed fixture doesn't block the rest from
 *     loading (we surface validation errors and continue).
 *
 * Validation is intentionally loose: every case MUST have `id`,
 * `suite`, `layer`, `input.message`, `input.userId`, and `expected`.
 * Everything else is optional. If a required field is missing we skip
 * the file + log the issue; the runner downstream treats a missing
 * case the same as not having one.
 */

import type { EvalCase, PersonaId, SuiteId, EvalLayer } from "./types.ts";

const VALID_SUITES: SuiteId[] = [
  "intent-classification",
  "prompt-budget",
  "memory-recall",
  "user-slot-source",
  "modular-prompt-parity",
];

const VALID_PERSONAS: PersonaId[] = ["solo", "couple", "team"];
const VALID_LAYERS: EvalLayer[] = ["static", "live"];

export interface LoadedFixtures {
  cases: EvalCase[];
  errors: Array<{ file: string; reason: string }>;
}

/**
 * Validate a parsed JSON object as an EvalCase. Returns `null` + pushes
 * to `errors` when the shape is wrong.
 */
export function validateCase(
  raw: unknown,
  sourceFile: string,
  errors: Array<{ file: string; reason: string }>
): EvalCase | null {
  if (!raw || typeof raw !== "object") {
    errors.push({ file: sourceFile, reason: "not an object" });
    return null;
  }
  const c = raw as Record<string, unknown>;

  // Required strings.
  const requiredStringFields: Array<[string, string]> = [
    ["id", "case.id"],
    ["description", "case.description"],
  ];
  for (const [key, label] of requiredStringFields) {
    if (typeof c[key] !== "string" || !(c[key] as string).trim()) {
      errors.push({ file: sourceFile, reason: `missing/empty ${label}` });
      return null;
    }
  }

  // Required enums.
  if (!VALID_SUITES.includes(c.suite as SuiteId)) {
    errors.push({
      file: sourceFile,
      reason: `invalid suite '${c.suite}' (expected one of ${VALID_SUITES.join(", ")})`,
    });
    return null;
  }
  if (!VALID_PERSONAS.includes(c.persona as PersonaId)) {
    errors.push({
      file: sourceFile,
      reason: `invalid persona '${c.persona}' (expected one of ${VALID_PERSONAS.join(", ")})`,
    });
    return null;
  }
  if (!VALID_LAYERS.includes(c.layer as EvalLayer)) {
    errors.push({
      file: sourceFile,
      reason: `invalid layer '${c.layer}' (expected one of ${VALID_LAYERS.join(", ")})`,
    });
    return null;
  }

  // Required nested objects.
  const input = c.input as Record<string, unknown> | undefined;
  if (!input || typeof input.message !== "string" || typeof input.userId !== "string") {
    errors.push({
      file: sourceFile,
      reason: "input.message and input.userId required (strings)",
    });
    return null;
  }
  if (!c.expected || typeof c.expected !== "object") {
    errors.push({ file: sourceFile, reason: "expected block required (object)" });
    return null;
  }

  // Trust — runner accepts the loose shape because ExpectedOutcome fields
  // are all optional. Cases are authored by humans, so a typo becomes a
  // "field present but never matches" issue, surfaced as a failure in
  // the final report — not a loader rejection.
  return c as unknown as EvalCase;
}

/**
 * Load every `*.json` file in `dir` as a fixture. Malformed files are
 * reported, not thrown. Ordering is filename ascending for diff stability.
 */
export async function loadFixturesFromDir(dir: string): Promise<LoadedFixtures> {
  const errors: Array<{ file: string; reason: string }> = [];
  const cases: EvalCase[] = [];

  // Deno-specific: read directory entries. We avoid Node imports so this
  // module loads cleanly in the Supabase edge runtime if ever needed.
  const entries: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && entry.name.endsWith(".json")) entries.push(entry.name);
    }
  } catch (err) {
    errors.push({
      file: dir,
      reason: `cannot read directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { cases, errors };
  }

  entries.sort();

  for (const name of entries) {
    const path = `${dir}/${name}`;
    try {
      const raw = await Deno.readTextFile(path);
      const parsed = JSON.parse(raw);
      const valid = validateCase(parsed, name, errors);
      if (valid) cases.push(valid);
    } catch (err) {
      errors.push({
        file: name,
        reason: `read/parse failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return { cases, errors };
}

/**
 * Same as `loadFixturesFromDir` but accepts an in-memory array of parsed
 * JSON blobs + a source-file label. Useful for tests and for contexts
 * where Deno.readDir isn't available.
 */
export function loadFixturesFromObjects(
  rawCases: Array<{ source: string; data: unknown }>
): LoadedFixtures {
  const errors: Array<{ file: string; reason: string }> = [];
  const cases: EvalCase[] = [];
  for (const { source, data } of rawCases) {
    const valid = validateCase(data, source, errors);
    if (valid) cases.push(valid);
  }
  return { cases, errors };
}
