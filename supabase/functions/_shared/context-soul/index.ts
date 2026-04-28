/**
 * Context Soul (Layer 4) — public entry point
 * ============================================
 * The orchestrator's per-request, intent-aware enrichment layer. Sits
 * between the persistent layers (0/1/2/5 from `_shared/soul.ts`) and
 * the LLM call: each intent has a planner that knows what data slices
 * matter and how to retrieve them efficiently.
 *
 * Usage from a caller:
 *
 *   import { assembleContextSoul } from "../_shared/context-soul/index.ts";
 *
 *   const ctx = await assembleContextSoul(supabase, "EXPENSE", {
 *     userId,
 *     spaceId,
 *     query: messageBody,
 *   });
 *   if (ctx.prompt) systemPrompt += "\n\n" + ctx.prompt;
 *
 * Behavior contracts:
 *   - **Defensive try/catch.** A planner exception cannot bubble out
 *     of this dispatcher. We log and return an empty result — the
 *     caller continues with un-enriched context, never fails because
 *     of Layer 4.
 *   - **Unknown intents → DEFAULT.** No errors, no warnings; just an
 *     empty enrichment. Lets callers pass any string they have without
 *     pre-filtering.
 *   - **No coupling to Layers 0/1/2/5.** This dispatcher does NOT call
 *     `assembleSoulContext`. The caller composes the two if they want
 *     the full stack.
 */

import type {
  ContextSoulIntent,
  ContextSoulParams,
  ContextSoulResult,
} from "./types.ts";
import { getPlanner } from "./registry.ts";
import { DEFAULT_CONTEXT_SOUL_BUDGET } from "./budget.ts";

// ─── Side-effect imports register planners into the module-scoped map.
// Add new planners as new files in ./planners/ and import them here.
import "./planners/default.ts";
// Real planners are registered as they ship in C-4.b / C-4.c:
// import "./planners/expense.ts";
// import "./planners/contextual-ask.ts";

export async function assembleContextSoul(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  intent: ContextSoulIntent,
  params: ContextSoulParams,
): Promise<ContextSoulResult> {
  const resolved = {
    userId: params.userId,
    spaceId: params.spaceId ?? null,
    query: params.query ?? "",
    budgetTokens: params.budgetTokens ?? DEFAULT_CONTEXT_SOUL_BUDGET,
  };

  // Defensive: missing userId is a programming error, but we don't
  // want to throw — return empty so the caller continues cleanly.
  if (!resolved.userId) {
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: ["error-missing-user"],
      fellBackToDefault: true,
    };
  }

  const planner = getPlanner(intent);
  const fellBackToDefault = planner === null;
  const fn = planner ?? getPlanner("DEFAULT");

  if (!fn) {
    // Should be impossible — the default planner registers itself at
    // import time. Defensive return so a misconfigured environment
    // doesn't crash callers.
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: ["error-no-default-planner"],
      fellBackToDefault: true,
    };
  }

  try {
    const result = await fn(supabase, resolved);
    return {
      ...result,
      fellBackToDefault: fellBackToDefault || result.fellBackToDefault,
    };
  } catch (err) {
    // Planner threw despite the contract. Log + return empty — never
    // bubble. Layer 4 is enrichment; if it fails, the caller's request
    // proceeds with unmodified context.
    console.warn(`[context-soul] planner error for intent=${intent}:`, err);
    return {
      prompt: "",
      tokensUsed: 0,
      sectionsLoaded: [`error-planner-${intent}`],
      fellBackToDefault: true,
    };
  }
}

// Re-exports for callers that want the helpers
export { registerPlanner, listIntents } from "./registry.ts";
export {
  buildBudgetedSection,
  clampToBudget,
  DEFAULT_CONTEXT_SOUL_BUDGET,
  estimateTokens,
} from "./budget.ts";
export type {
  ContextSoulIntent,
  ContextSoulParams,
  ContextSoulPlanner,
  ContextSoulResult,
  ResolvedContextSoulParams,
} from "./types.ts";
