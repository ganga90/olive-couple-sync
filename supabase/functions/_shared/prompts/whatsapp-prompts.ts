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
//
// v2.0 — mandates a "Sources:" tail with bare https:// URLs so WhatsApp's
// preview_url=true linkifier can render them as taps. Gemini consistently
// dropped URLs under v1.0's "Include relevant links" guidance.
export const WA_WEB_SEARCH_FORMAT_PROMPT_VERSION = "wa-web-search-v2.0";

/**
 * Build the system prompt that re-formats a Perplexity result for
 * WhatsApp delivery. Lifted out of `handlers/web-search.ts` per the
 * "no inline prompts" rule. Caller passes the user's resolved
 * question, optional saved-item / personal context, the raw Perplexity
 * text, and Perplexity's citation URLs.
 *
 * If `citations` is non-empty, the prompt MANDATES a trailing sources
 * block using bare URLs (markdown link syntax `[text](url)` would render
 * as raw text in WhatsApp — never use it here). A deterministic guard
 * in the handler appends the top citation as a safety net if the model
 * still omits it.
 */
export function buildWaWebSearchFormatPrompt(opts: {
  langName: string;
  userQuestion: string;
  savedItemContext: string;
  personalContext: string;
  searchResult: string;
  citations: string[];
}): string {
  const { langName, userQuestion, savedItemContext, personalContext, searchResult, citations } = opts;
  const langDirective = langName !== 'English' ? `\n\nIMPORTANT: Respond entirely in ${langName}.` : '';
  const sourcesBlock = citations.length > 0
    ? `\n\nSOURCES (cite by surfacing the URL — see formatting rules above):\n${citations.map((c, i) => `[${i + 1}] ${c}`).join('\n')}`
    : '';

  return `You are Olive, a world-class AI assistant — like a brilliant friend who knows the world AND the user's life. The user asked a question. Answer it comprehensively using the search results, and if any personal context is relevant, weave it in naturally. Format for WhatsApp (max 1200 chars). Be warm, specific, and genuinely helpful. Use emojis sparingly 🫒${langDirective}

LINK FORMATTING — CRITICAL FOR WHATSAPP:
${citations.length > 0 ? `- You MUST end your answer with a single "🔗 <bare URL>" line surfacing the MOST authoritative source from SOURCES below.
- WhatsApp auto-linkifies bare \`https://\` URLs. Do NOT use markdown \`[text](url)\` — it renders as raw text on WhatsApp and is unusable.
- Use ONE source, on its own line, after a blank line. Never invent URLs not in the SOURCES list.` : `- No sources were retrieved for this query. Do not invent URLs.`}

USER'S QUESTION: ${userQuestion}
${savedItemContext}
${personalContext}
WEB SEARCH RESULTS:
${searchResult}
${sourcesBlock}

Answer the question thoroughly, then briefly mention any relevant personal connections.${citations.length > 0 ? ' Then add a blank line and the "🔗 <url>" line.' : ''} End with "Want me to save this?" if the response contains useful recommendations.`;
}

// ─── List Recap ──────────────────────────────────────────────
export const WA_LIST_RECAP_PROMPT_VERSION = "wa-list-recap-v1.0";

/**
 * Get the prompt version for a given chat type.
 * Falls back to generic version if chatType is unregistered.
 */
export function getWAChatPromptVersion(chatType: string): string {
  return WA_CHAT_PROMPT_VERSIONS[chatType] || `wa-chat-${chatType}-v1.0`;
}
