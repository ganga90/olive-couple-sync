/**
 * Per-Intent Prompt Registry — Loader + Fallback
 * ================================================
 * Phase 4-C (Engineering Plan Task 2-D).
 *
 * Maps an intent string to the matching `PromptModule`. On unknown
 * intents, returns the CHAT module so a missing classification never
 * produces an empty system prompt.
 *
 * Usage (in orchestrator):
 *
 *   import { loadPromptModule } from "../_shared/prompts/intents/registry.ts";
 *
 *   const module = loadPromptModule(classifierResult.intent);
 *   const assembly = formatContextWithBudget(ctx, {
 *     soulPrompt: module.system_core,
 *     intentModule: module.intent_rules,
 *     userMessage,
 *     userName,
 *     conversationHistory,
 *   });
 *   // module.version → log into olive_llm_analytics.prompt_version
 *
 * The loader is a pure function — easy to unit-test, no DB/IO.
 */

import { CHAT_MODULE } from "./chat.ts";
import { CONTEXTUAL_ASK_MODULE } from "./contextual-ask.ts";
import { CREATE_MODULE } from "./create.ts";
import { EXPENSE_MODULE } from "./expense.ts";
import { HELP_ABOUT_OLIVE_MODULE } from "./help-about-olive.ts";
import { PARTNER_MESSAGE_MODULE } from "./partner-message.ts";
import { SEARCH_MODULE } from "./search.ts";
import { TASK_ACTION_MODULE } from "./task-action.ts";
import type { IntentModuleKey, PromptModule } from "./types.ts";

/**
 * Registry — map of normalized intent key → PromptModule.
 * The classifier produces strings like "CHAT", "create", "SEARCH" — we
 * normalize case at the lookup boundary.
 */
const REGISTRY: Record<IntentModuleKey, PromptModule> = {
  chat: CHAT_MODULE,
  contextual_ask: CONTEXTUAL_ASK_MODULE,
  create: CREATE_MODULE,
  search: SEARCH_MODULE,
  expense: EXPENSE_MODULE,
  task_action: TASK_ACTION_MODULE,
  partner_message: PARTNER_MESSAGE_MODULE,
  help_about_olive: HELP_ABOUT_OLIVE_MODULE,
  default: CHAT_MODULE,
};

/**
 * Alias map — classifier sometimes emits variant strings. These are
 * intentionally permissive: an unexpected alias should still land on
 * a sensible module rather than `default`.
 */
const ALIASES: Record<string, IntentModuleKey> = {
  // Case-normalized canonical
  chat: "chat",
  contextual_ask: "contextual_ask",
  create: "create",
  search: "search",
  expense: "expense",
  task_action: "task_action",
  partner_message: "partner_message",
  help_about_olive: "help_about_olive",
  // Common aliases
  web_search: "search",
  merge: "task_action",
  list_recap: "search",
  create_list: "create",
  save_artifact: "create",
  // Pre-filter in ask-olive-stream emits type='help'; webhook uses
  // chatType='help_about_olive'. Both land on the help module.
  help: "help_about_olive",
};

/**
 * Resolve an intent string to a registry key. Unknown intents fall back
 * to "default" (= chat).
 */
export function resolveIntentKey(intent: string | null | undefined): IntentModuleKey {
  if (!intent) return "default";
  const normalized = intent.toLowerCase().trim();
  const aliased = ALIASES[normalized];
  if (aliased) return aliased;
  if (normalized in REGISTRY) return normalized as IntentModuleKey;
  return "default";
}

/**
 * Load the `PromptModule` for the given intent. Never returns null —
 * unknown intents degrade to the chat module.
 */
export function loadPromptModule(intent: string | null | undefined): PromptModule {
  const key = resolveIntentKey(intent);
  return REGISTRY[key];
}

/**
 * Return all registered modules (for analytics, tests, admin UIs).
 */
export function allModules(): PromptModule[] {
  // Deduplicate because "default" aliases to "chat".
  const seen = new Set<string>();
  const out: PromptModule[] = [];
  for (const mod of Object.values(REGISTRY)) {
    if (seen.has(mod.intent)) continue;
    seen.add(mod.intent);
    out.push(mod);
  }
  return out;
}

// Convenience re-exports for callers that only need the types.
export type { IntentModuleKey, PromptModule } from "./types.ts";
