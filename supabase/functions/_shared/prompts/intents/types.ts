/**
 * Per-Intent Prompt Modules — Types
 * ==================================
 * Phase 4-C (Engineering Plan Task 2-D).
 *
 * The current monolithic `OLIVE_CHAT_PROMPT` in ask-olive-prompts.ts
 * is ~1,000 tokens and covers every intent with a single text block.
 * Most of it is irrelevant to any given call — when the user logs an
 * expense, a paragraph about "how to invite a partner" is pure waste.
 *
 * Per-intent modules split the prompt into a small IDENTITY core that
 * always ships, plus a focused RULES block swapped per intent. The
 * orchestrator's Context Contract (context-contract.ts) has matching
 * named slots: IDENTITY (200 tok), INTENT_MODULE (250 tok).
 *
 * Design rules:
 *   - `system_core` is the persona + global behavior. ~200 tokens max.
 *     It is IDENTICAL across all intents (improves prompt-cache hit
 *     rate on Phase 6 caching).
 *   - `intent_rules` is the only thing that changes per intent.
 *     ~150-250 tokens.
 *   - `few_shot_examples` is optional and only used for intents where
 *     demonstration beats explanation (expense parsing, task extraction).
 *   - Every module has a version string so A/B iteration is logged in
 *     olive_llm_analytics and reversible.
 *
 * See: supabase/functions/_shared/prompts/intents/registry.ts
 * See: supabase/functions/_shared/context-contract.ts
 */

/**
 * The full set of intents a PromptModule can target.
 * Mirrors the intent classifier's JSON schema, with a `default` fallback.
 */
export type IntentModuleKey =
  | "chat"
  | "contextual_ask"
  | "create"
  | "search"
  | "expense"
  | "task_action"
  | "partner_message"
  | "help_about_olive"
  | "default";

export interface PromptModule {
  /** Version string logged per LLM call; bump to A/B iterate. */
  version: string;
  /** Which intent this module targets. */
  intent: IntentModuleKey;
  /**
   * The persona/core-behavior block, always injected into SLOT_IDENTITY.
   * Must be SHORT, <=200 tokens. Identical text across all modules so
   * the prompt-cache prefix (Phase 6) stays stable regardless of intent.
   */
  system_core: string;
  /**
   * Intent-specific rules, injected into SLOT_INTENT_MODULE. ~150-250 tok.
   * Describes precisely what this intent should DO and what formats /
   * signals to avoid. No persona content here.
   */
  intent_rules: string;
  /** Optional demonstrations (~200 tok). Use sparingly — each costs budget. */
  few_shot_examples?: string;
}
