/**
 * Prompt System Resolver — Feature-Flagged Migration Surface
 * ===========================================================
 * Option A follow-up to Phase 4: give ask-olive-stream and whatsapp-webhook
 * a single, reversible point to switch from the legacy monolithic
 * `OLIVE_CHAT_PROMPT` to the per-intent modular system (Phase 4-C).
 *
 * Why a resolver and not inlined flag checks?
 *
 *   1. REVERSIBILITY. If modular prompts regress quality in production,
 *      the fix is one env-var flip, not a deploy-and-pray. Nobody has
 *      to re-read call sites to understand "which path runs?".
 *
 *   2. MEASURABILITY. Both paths go through the same telemetry struct
 *      (`resolved.source`, `resolved.version`) so `olive_llm_analytics`
 *      can A/B-compare legacy vs modular on identical traffic slices.
 *
 *   3. ROLLOUT SAFETY. `INTENT_MODULES_ROLLOUT_PCT` hashes userId to a
 *      stable 0..100 bucket — a user never flips between paths mid-
 *      session, so regressions are observable at user-level granularity
 *      instead of per-request noise.
 *
 *   4. FUTURE WEBHOOK MIGRATION. whatsapp-webhook has 10 chatType-
 *      specialized inline prompts that need a separate, careful
 *      migration. The resolver is the place they'll plug in when ready.
 *
 * Feature flags (env vars, Supabase edge runtime):
 *
 *   - `USE_INTENT_MODULES=1` — force ON for all users. Highest priority.
 *   - `USE_INTENT_MODULES=0` (or unset) + `INTENT_MODULES_ROLLOUT_PCT=N` —
 *     apply to the first N% of users (hash-bucketed on userId).
 *   - Neither set — legacy only.
 *
 * The resolver is PURE (no DB/IO) so callers can test their migration
 * logic without spinning up Supabase.
 */

import { loadPromptModule, type PromptModule } from "./registry.ts";

/**
 * Shape returned to callers. Contains EVERYTHING needed to invoke
 * Gemini with the right system prompt + log the right telemetry.
 */
export interface ResolvedPrompt {
  /** Full text to hand to Gemini's `systemInstruction`. */
  systemInstruction: string;
  /**
   * Rules block for the per-intent SLOT_INTENT_MODULE when the caller
   * uses `formatContextWithBudget({ intentModule })`. Empty string on
   * the legacy path.
   */
  intentRules: string;
  /** Prompt version string — logged to `olive_llm_analytics.prompt_version`. */
  version: string;
  /** Which path produced this result. Logged as metadata. */
  source: "modular" | "legacy";
  /** Which intent key was resolved (for analytics). */
  resolvedIntent: string;
}

/**
 * Inputs needed to resolve a prompt.
 *
 * Callers pass their own legacy prompt + version so the resolver never
 * needs to import the monolithic prompt registry (keeps dependency
 * direction tidy). If `flagEnv`/`rolloutEnv` aren't injected, we read
 * them from `Deno.env` — dependency injection is for tests.
 */
export interface ResolverInput {
  /** Intent string from the classifier (e.g. "chat", "help", "CHAT"). */
  intent: string | null | undefined;
  /** Stable user identifier for rollout-bucket hashing. Can be empty. */
  userId: string | null | undefined;
  /** Legacy system prompt text — used when the flag is OFF. */
  legacyPrompt: string;
  /** Legacy prompt version string — logged when the flag is OFF. */
  legacyVersion: string;
  /**
   * Optional overrides for tests + non-Deno contexts. If absent,
   * `Deno.env.get(...)` is used.
   */
  envGetter?: (key: string) => string | undefined;
}

/**
 * Deterministic [0, 100) bucket for a user id. Same user → same bucket
 * every time. Different users → distribution that's uniform in practice
 * for production-scale userId sets. Zero-cost: single pass of FNV-1a.
 */
export function hashUserToBucket(userId: string): number {
  if (!userId) return 0;
  // FNV-1a 32-bit — fast, stable, no dependencies.
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Force unsigned + modulo 100.
  return (hash >>> 0) % 100;
}

/**
 * Pure policy: given flag values + userId, decide which path to take.
 *
 * Precedence (highest-first):
 *   1. USE_INTENT_MODULES=1  → modular (all users)
 *   2. USE_INTENT_MODULES=0/unset + rollout pct N + user bucket < N → modular
 *   3. otherwise             → legacy
 */
export function decidePromptSource(
  userId: string | null | undefined,
  flagValue: string | undefined,
  rolloutPctValue: string | undefined
): "modular" | "legacy" {
  // Normalize flag: "1", "true", "yes", "on" → true.
  if (flagValue) {
    const f = flagValue.trim().toLowerCase();
    if (f === "1" || f === "true" || f === "yes" || f === "on") return "modular";
    if (f === "0" || f === "false" || f === "no" || f === "off") {
      // Explicit off — do NOT fall through to rollout.
      return "legacy";
    }
  }

  // Rollout bucket check.
  const pctRaw = rolloutPctValue ? parseInt(rolloutPctValue, 10) : 0;
  const pct = isFinite(pctRaw) ? Math.max(0, Math.min(100, pctRaw)) : 0;
  if (pct <= 0) return "legacy";
  if (pct >= 100) return "modular";

  if (!userId) {
    // Can't hash — be conservative, stay on legacy.
    return "legacy";
  }
  return hashUserToBucket(userId) < pct ? "modular" : "legacy";
}

/**
 * Main entry point. Returns the concrete prompt the caller should use.
 *
 * Never throws — a bad intent string degrades to the chat module; a
 * missing legacy prompt degrades to empty string + modular path.
 */
export function resolvePrompt(input: ResolverInput): ResolvedPrompt {
  const envGet =
    input.envGetter ?? ((key: string) => {
      try {
        return (globalThis as any).Deno?.env?.get?.(key);
      } catch {
        return undefined;
      }
    });

  const flag = envGet("USE_INTENT_MODULES");
  const rollout = envGet("INTENT_MODULES_ROLLOUT_PCT");

  const source = decidePromptSource(input.userId, flag, rollout);

  if (source === "legacy") {
    return {
      systemInstruction: input.legacyPrompt,
      intentRules: "",
      version: input.legacyVersion,
      source: "legacy",
      resolvedIntent: "legacy",
    };
  }

  // Modular path.
  const mod: PromptModule = loadPromptModule(input.intent);
  return {
    systemInstruction: mod.system_core,
    intentRules: mod.intent_rules,
    version: mod.version,
    source: "modular",
    resolvedIntent: mod.intent,
  };
}
