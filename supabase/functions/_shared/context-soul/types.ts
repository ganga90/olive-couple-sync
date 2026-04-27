/**
 * Context Soul (Layer 4) — types
 * ================================
 * Layer 4 of the soul stack: ephemeral, per-request context assembled
 * by intent-aware planners. Each planner knows what data slices matter
 * for its intent and how to retrieve them efficiently — instead of
 * dumping a kitchen-sink of memories+patterns+calendar+notes into
 * SLOT_DYNAMIC on every call.
 *
 * Planners are registered into a per-process map; callers ask the
 * registry by intent name. Unknown intents fall through to the
 * `DEFAULT` planner (a no-op), preserving caller fall-through to
 * the existing context assembly logic.
 */

/**
 * Intent identifiers that can have a registered planner. Mirrors the
 * IntentResult.intent enum from whatsapp-webhook + ask-olive-stream
 * (kept in sync manually — callers typecheck against this string set).
 *
 * `DEFAULT` is a sentinel: callers requesting an unmapped intent get
 * routed here, which returns an empty context. Real planners are
 * registered side-effectfully via `import './planners/<intent>.ts'`.
 */
export type ContextSoulIntent =
  | "EXPENSE"
  | "CONTEXTUAL_ASK"
  | "GROUP_RECAP"
  | "CHAT"
  | "PARTNER_MESSAGE"
  | "CREATE"
  | "SEARCH"
  | "WEB_SEARCH"
  | "TASK_ACTION"
  | "DEFAULT";

export interface ContextSoulParams {
  /** Clerk user ID (TEXT). Required. */
  userId: string;
  /** Space scope, when applicable. Null for personal-context queries. */
  spaceId?: string | null;
  /** The user's raw message text. Used by planners that do retrieval. */
  query?: string;
  /**
   * Token budget for the assembled context block. Planners must clamp
   * their output to this. Default = 800 (a slot-sized chunk; the
   * orchestrator's overall budget handles total cap).
   */
  budgetTokens?: number;
}

/** Required-everywhere shape passed to planners (defaults filled in). */
export interface ResolvedContextSoulParams {
  userId: string;
  spaceId: string | null;
  query: string;
  budgetTokens: number;
}

export interface ContextSoulResult {
  /** Assembled context block, ready to inject into a prompt. */
  prompt: string;
  /** Estimated tokens used by `prompt`. */
  tokensUsed: number;
  /** Section labels that contributed (for debugging/observability). */
  sectionsLoaded: string[];
  /** True when no planner matched and the default was used. */
  fellBackToDefault: boolean;
}

/**
 * A planner is a pure function that takes resolved params and returns
 * an assembled context block for its intent.
 *
 * Contract:
 *   - **Must stay within `params.budgetTokens`.** The framework's
 *     `clampToBudget` helper is the canonical way.
 *   - **Must never throw.** Return `{ prompt: '', sectionsLoaded: [],
 *     ... }` on internal errors. The framework wraps in try/catch
 *     defensively, but planners should fail soft as a first line.
 *   - **Must be idempotent.** Same inputs → same output (modulo
 *     freshness of underlying data).
 *   - **Must NOT call other planners.** No recursion / composition
 *     at this layer; that lives in the caller.
 */
export type ContextSoulPlanner = (
  // deno-lint-ignore no-explicit-any
  supabase: any,
  params: ResolvedContextSoulParams,
) => Promise<ContextSoulResult>;
