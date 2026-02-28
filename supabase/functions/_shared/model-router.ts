/**
 * Model Router — Dynamic Model Escalation
 * ========================================
 * Maps classified intent + chat_type to the appropriate Gemini model tier.
 *
 * - DB-only intents (task CRUD) → no LLM response needed (template confirmation)
 * - Simple extraction (expense) → Flash-Lite (cheapest)
 * - General chat / search → Flash (standard)
 * - Complex reasoning (weekly summary, planning) → Pro
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
];

/** Chat types that require deeper reasoning → Pro model */
const PRO_CHAT_TYPES = ["weekly_summary", "planning"];

/**
 * Determine the response model tier based on classified intent.
 *
 * @param intent — The classified intent string (e.g., "chat", "search", "expense")
 * @param chatType — Optional chat sub-type (e.g., "briefing", "weekly_summary", "planning")
 * @returns RouteDecision with responseTier and reason
 */
export function routeIntent(
  intent: string,
  chatType?: string
): RouteDecision {
  // ── DB-only intents ─────────────────────────────────────
  // These use template confirmations or delegate to process-note.
  // No LLM response generation needed — tier is informational only.
  if (DB_ONLY_INTENTS.includes(intent)) {
    return { responseTier: "lite", reason: "db_operation" };
  }

  // ── Expense — simple JSON extraction ────────────────────
  if (intent === "expense") {
    return { responseTier: "lite", reason: "simple_extraction" };
  }

  // ── Chat — tier depends on complexity ───────────────────
  if (intent === "chat") {
    if (chatType && PRO_CHAT_TYPES.includes(chatType)) {
      return {
        responseTier: "pro",
        reason: `complex_chat:${chatType}`,
      };
    }
    return {
      responseTier: "standard",
      reason: `chat:${chatType || "general"}`,
    };
  }

  // ── Contextual ask — standard reasoning ─────────────────
  if (intent === "contextual_ask") {
    return { responseTier: "standard", reason: "contextual_search" };
  }

  // ── Search — standard for result formatting ─────────────
  if (intent === "search") {
    return { responseTier: "standard", reason: "search" };
  }

  // ── Partner message — standard for relay formatting ─────
  if (intent === "partner_message") {
    return { responseTier: "standard", reason: "partner_relay" };
  }

  // ── Fallback ────────────────────────────────────────────
  return { responseTier: "standard", reason: `fallback:${intent}` };
}
