/**
 * Phase D-1.c — A/B router for prompt addendums
 * ===========================================================================
 * Looks up `olive_prompt_addendums` for a given prompt module and decides
 * whether the requesting user gets the addendum (treatment) or the
 * baseline (control). Used by callers that opt into reflection-driven
 * prompt evolution; left untouched, the system uses baseline prompts
 * exactly as before.
 *
 * Three exports:
 *   - `assignABBucket(userId, addendumId, rolloutPct)` — pure deterministic
 *     hash-based bucket assignment. Same (user, addendum) pair always
 *     gets the same variant; uncorrelated across addendums so users don't
 *     "lock into" treatment for everything.
 *   - `resolveAddendum(supabase, userId, promptModule)` — DB-backed,
 *     fail-soft. Returns null when there's no active addendum, when the
 *     user lost the A/B coin flip, when rollout_pct is 0, or when the
 *     query errors. Never throws.
 *   - `resolvePromptModuleForUser(supabase, userId, intent)` — convenience
 *     wrapper. Composes the existing synchronous `loadPromptModule` with
 *     the addendum resolver. Returns a PromptModule with the addendum
 *     appended to `intent_rules` (and a tagged version string) when one
 *     applies, or the baseline module otherwise.
 *
 * NO PRODUCTION INTEGRATION in this PR. Existing callers (orchestrator,
 * whatsapp-webhook, ask-olive-stream) keep using the synchronous
 * `loadPromptModule`. Live integration is deferred to its own PR
 * after D-1.d ships and we've actually approved a test addendum.
 */

import { loadPromptModule } from "../prompts/intents/registry.ts";
import type { IntentModuleKey, PromptModule } from "../prompts/intents/types.ts";
import type { PromptModuleKey } from "./types.ts";

// ─── Types ──────────────────────────────────────────────────────────

export type ABBucket = "treatment" | "control";

export interface ResolvedAddendum {
  /** UUID of the olive_prompt_addendums row. */
  addendum_id: string;
  /** The text to append to intent_rules. */
  addendum_text: string;
  /** 'testing' or 'approved' — used for analytics tagging. */
  status: "testing" | "approved";
  /** Effective rollout percentage 0..100. 'approved' rows are always 100. */
  rollout_pct: number;
}

interface AddendumRow {
  id: string;
  addendum_text: string;
  status: string;
  rollout_pct: number;
}

// ─── 1. Pure deterministic A/B bucket assignment ────────────────────
//
// Hash function uses a simple FNV-1a 32-bit. Crypto-grade hashing is
// overkill — we only need uniform distribution over [0, 99] for an
// A/B split. FNV is fast, deterministic, and dependency-free.
//
// Why hash on `userId + addendumId` (not just userId)?
//   If we hashed only on userId, every addendum for that user would
//   put them on the same side of every A/B test. A user who lost the
//   first A/B would never see treatment for any subsequent one.
//   By including addendumId, each new test gets an independent draw.

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by FNV prime; coerce to uint32 to avoid floating-point drift.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Pure: same input → same bucket every time. Distribution across many
 * users is uniform.
 *
 * Edge cases:
 *   - rolloutPct <= 0  → always 'control'  (treatment never fires)
 *   - rolloutPct >= 100 → always 'treatment'
 *   - empty userId or addendumId → defensive 'control'
 */
export function assignABBucket(
  userId: string,
  addendumId: string,
  rolloutPct: number,
): ABBucket {
  if (!userId || !addendumId) return "control";
  if (rolloutPct <= 0) return "control";
  if (rolloutPct >= 100) return "treatment";
  const bucket = fnv1a32(`${userId}:${addendumId}`) % 100;
  return bucket < rolloutPct ? "treatment" : "control";
}

// ─── 2. DB-backed addendum resolver ─────────────────────────────────

/**
 * Looks up the active addendum for a prompt module and applies the
 * A/B coin flip. Returns null in every "no enrichment" case so callers
 * can use a single nullish check.
 *
 * Fail-soft: any DB error returns null. Treats a missing addendum the
 * same as an erroring lookup — the caller never sees an exception, and
 * the user gets the baseline prompt either way.
 */
export async function resolveAddendum(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  promptModule: PromptModuleKey,
): Promise<ResolvedAddendum | null> {
  if (!userId || !promptModule) return null;

  let row: AddendumRow | null = null;
  try {
    // Order: 'approved' first so the unique-per-module approved row wins
    // even if a stale 'testing' addendum is still in the table.
    // (The DB unique index already guarantees ≤ 1 'approved' per module.)
    const { data } = await supabase
      .from("olive_prompt_addendums")
      .select("id, addendum_text, status, rollout_pct")
      .eq("prompt_module", promptModule)
      .in("status", ["testing", "approved"])
      .order("status", { ascending: false }) // 'testing' < 'approved' lexically — descending puts approved first
      .limit(1)
      .maybeSingle();
    row = (data as AddendumRow) || null;
  } catch (err) {
    console.warn("[ab-router] resolveAddendum query failed:", err);
    return null;
  }

  if (!row) return null;

  // Defensive: schema CHECK constraint already enforces this, but if
  // a future migration loosens it we don't want to crash.
  if (row.status !== "testing" && row.status !== "approved") return null;

  // 'approved' is always 100% by convention; the cron promotes addendums
  // to 'approved' only when admin sets rollout_pct=100. Still gate
  // through assignABBucket so the math is in one place.
  const effectivePct = row.status === "approved" ? 100 : row.rollout_pct;
  const bucket = assignABBucket(userId, row.id, effectivePct);
  if (bucket === "control") return null;

  return {
    addendum_id: row.id,
    addendum_text: row.addendum_text,
    status: row.status as "testing" | "approved",
    rollout_pct: effectivePct,
  };
}

// ─── 3. Composition wrapper ─────────────────────────────────────────

/**
 * Convenience wrapper: get the prompt module for an intent, with any
 * applicable addendum already merged in.
 *
 * The addendum is appended to `intent_rules` (NOT system_core) so the
 * persona/voice block stays stable across A/B variants — important for
 * Phase 6 prompt-cache hit rates. The version string is tagged with
 * the addendum_id so olive_llm_calls.prompt_version distinguishes
 * baseline from treatment.
 *
 * Returns the baseline module unchanged when no addendum applies — so
 * a caller migrating from `loadPromptModule(intent)` to
 * `resolvePromptModuleForUser(supabase, userId, intent)` sees no
 * behavior change today.
 */
export async function resolvePromptModuleForUser(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
  intent: string | null | undefined,
): Promise<PromptModule> {
  // Always start from the baseline — the synchronous loader handles
  // alias normalization and unknown-intent fallback.
  const baseline = loadPromptModule(intent);

  // Map the resolved IntentModuleKey to the prompt-evolution
  // PromptModuleKey. Currently they're identical except for 'default'
  // which we don't evolve (no semantic anchor).
  const moduleKey = baseline.intent as IntentModuleKey;
  if (moduleKey === "default") return baseline;

  // Type bridge — IntentModuleKey is a superset of PromptModuleKey
  // ('default' is the only key in IntentModuleKey but not in
  // PromptModuleKey, and we just filtered it out).
  const promptKey = moduleKey as PromptModuleKey;

  const addendum = await resolveAddendum(supabase, userId, promptKey);
  if (!addendum) return baseline;

  return {
    ...baseline,
    // Tag the version so analytics can split treatment vs baseline.
    version: `${baseline.version}+addendum-${addendum.addendum_id}`,
    intent_rules: `${baseline.intent_rules}\n\n## Additional rules learned from user feedback\n${addendum.addendum_text}`,
  };
}

// Re-export for convenience
export { loadPromptModule };
