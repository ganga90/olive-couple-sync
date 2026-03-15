/**
 * Model Router — Dynamic Model Escalation
 * ========================================
 * Maps classified intent + chat_type + media presence to the appropriate Gemini model tier.
 *
 * - DB-only intents (task CRUD) → no LLM response needed (template confirmation)
 * - Simple extraction (expense) → Flash-Lite (cheapest)
 * - General chat / search → Flash (standard)
 * - Complex reasoning (weekly summary, planning) → Pro
 * - Media routing: Flash for casual, Pro for extraction-heavy tasks
 *
 * Import in any edge function:
 *   import { routeIntent } from "../_shared/model-router.ts";
 */

import type { ModelTier } from "./gemini.ts";

export interface RouteDecision {
  /** Which Gemini model tier to use for the response generation */
  responseTier: ModelTier;
  /** Human-readable reason for the routing decision (logged for analytics) */
  reason: string;
}

/** Intents that are handled purely via DB operations + template confirmations */
const DB_ONLY_INTENTS = [
  "complete",
  "set_priority",
  "set_due",
  "delete",
  "move",
  "assign",
  "remind",
  "merge",
  "create",
  "create_list",
];

/** Chat types that require deeper reasoning → Pro model */
const PRO_CHAT_TYPES = ["weekly_summary", "planning"];

/**
 * Intents that require Pro when media is present.
 * These need spatial reasoning, text extraction, or document analysis.
 */
const PRO_MEDIA_INTENTS = [
  "expense",        // receipt scanning → needs precise text/number extraction
  "create",         // creating from a document/screenshot → needs detail extraction
];

/**
 * Intents that are safe on Flash even with media.
 * Casual interactions where a quick visual description suffices.
 */
const FLASH_MEDIA_INTENTS = [
  "chat",           // "Look at this!" → casual, no extraction needed
  "partner_message", // forwarding media to partner → just describe
  "contextual_ask", // simple Q&A about an image
];

/**
 * Determine the response model tier based on classified intent.
 *
 * @param intent — The classified intent string (e.g., "chat", "search", "expense")
 * @param chatType — Optional chat sub-type (e.g., "briefing", "weekly_summary", "planning")
 * @param hasMedia — Whether the message includes image/video/document attachments
 * @returns RouteDecision with responseTier and reason
 */
export function routeIntent(
  intent: string,
  chatType?: string,
  hasMedia: boolean = false,
): RouteDecision {
  // ── Media-aware routing ─────────────────────────────────
  // When media is present, override default tier based on intent complexity
  if (hasMedia) {
    // Pro: intents that need precise text/spatial extraction from media
    if (PRO_MEDIA_INTENTS.includes(intent)) {
      return { responseTier: "pro", reason: `media_pro:${intent}` };
    }

    // Flash: casual media interactions
    if (FLASH_MEDIA_INTENTS.includes(intent)) {
      const subReason = intent === "chat" ? (chatType || "general") : intent;
      return { responseTier: "standard", reason: `media_flash:${subReason}` };
    }

    // Default for unknown intents with media: use Flash (cost-safe default)
    // Only escalate to Pro if we have strong signal above
    return { responseTier: "standard", reason: `media_flash_default:${intent}` };
  }

  // ── DB-only intents (no media) ──────────────────────────
  if (DB_ONLY_INTENTS.includes(intent)) {
    return { responseTier: "lite", reason: "db_operation" };
  }

  // ── Expense without media — simple JSON extraction ──────
  if (intent === "expense") {
    return { responseTier: "lite", reason: "simple_extraction" };
  }

  // ── Chat — tier depends on complexity ───────────────────
  if (intent === "chat") {
    if (chatType && PRO_CHAT_TYPES.includes(chatType)) {
      return { responseTier: "pro", reason: `complex_chat:${chatType}` };
    }
    return { responseTier: "standard", reason: `chat:${chatType || "general"}` };
  }

  // ── Contextual ask — standard reasoning ─────────────────
  if (intent === "contextual_ask") {
    return { responseTier: "standard", reason: "contextual_search" };
  }

  // ── Search — standard for result formatting ─────────────
  if (intent === "search") {
    return { responseTier: "standard", reason: "search" };
  }

  // ── Web search — lite for query formatting ─────────────
  if (intent === "web_search") {
    return { responseTier: "lite", reason: "web_search" };
  }

  // ── Partner message — standard for relay formatting ─────
  if (intent === "partner_message") {
    return { responseTier: "standard", reason: "partner_relay" };
  }

  // ── Fallback ────────────────────────────────────────────
  return { responseTier: "standard", reason: `fallback:${intent}` };
}
