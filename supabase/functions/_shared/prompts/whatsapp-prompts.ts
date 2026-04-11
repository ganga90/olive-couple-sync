/**
 * WhatsApp Webhook Prompt Registry
 * ==================================
 * Versioned prompt identifiers for the whatsapp-webhook function.
 * Each prompt type gets a version string logged with every LLM call
 * via the LLM tracker — enables cost analytics, quality measurement,
 * and prompt A/B testing per-chat-type.
 *
 * To iterate on a prompt:
 *   1. Bump the version (e.g., v1.0 → v1.1)
 *   2. Deploy whatsapp-webhook
 *   3. Check olive_llm_analytics to compare quality/cost
 */

// ─── Chat Prompt Versions (by chatType) ───────────────────────
export const WA_CHAT_PROMPT_VERSIONS: Record<string, string> = {
  general:          "wa-chat-general-v1.0",
  briefing:         "wa-chat-briefing-v1.0",
  weekly_summary:   "wa-chat-weekly-summary-v1.0",
  daily_focus:      "wa-chat-daily-focus-v1.0",
  productivity_tips:"wa-chat-productivity-v1.0",
  progress_check:   "wa-chat-progress-v1.0",
  motivation:       "wa-chat-motivation-v1.0",
  planning:         "wa-chat-planning-v1.0",
  greeting:         "wa-chat-greeting-v1.0",
  help_about_olive: "wa-chat-help-olive-v1.0",
  assistant:        "wa-chat-assistant-v1.0",
};

// ─── Contextual Ask (data questions) ──────────────────────────
export const WA_CONTEXTUAL_ASK_PROMPT_VERSION = "wa-contextual-ask-v1.0";
export const WA_HYBRID_ASK_PROMPT_VERSION = "wa-hybrid-ask-v1.0";

// ─── Task/Intent Classification ───────────────────────────────
export const WA_CLASSIFICATION_PROMPT_VERSION = "wa-classification-v1.0";

// ─── Expense Categorization ──────────────────────────────────
export const WA_EXPENSE_CATEGORIZATION_PROMPT_VERSION = "wa-expense-categorize-v1.0";

// ─── Rewriter (multi-task splitting) ──────────────────────────
export const WA_REWRITER_PROMPT_VERSION = "wa-rewriter-v1.0";

// ─── STT (Speech-to-Text via Gemini) ─────────────────────────
export const WA_STT_PROMPT_VERSION = "wa-stt-gemini-v1.0";

// ─── Web Search Format ───────────────────────────────────────
export const WA_WEB_SEARCH_FORMAT_PROMPT_VERSION = "wa-web-search-v1.0";

// ─── List Recap ──────────────────────────────────────────────
export const WA_LIST_RECAP_PROMPT_VERSION = "wa-list-recap-v1.0";

/**
 * Get the prompt version for a given chat type.
 * Falls back to generic version if chatType is unregistered.
 */
export function getWAChatPromptVersion(chatType: string): string {
  return WA_CHAT_PROMPT_VERSIONS[chatType] || `wa-chat-${chatType}-v1.0`;
}
