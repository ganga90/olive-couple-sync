/**
 * Shared Gemini Model Configuration
 * ==================================
 * Single source of truth for API key and model IDs across all edge functions.
 *
 * Import in any edge function:
 *   import { GEMINI_KEY, getModel } from "../_shared/gemini.ts";
 */

// Standardized key lookup — GEMINI_API is the canonical name in Supabase secrets
export const GEMINI_KEY: string =
  Deno.env.get("GEMINI_API") ||
  Deno.env.get("GEMINI_API_KEY") ||
  Deno.env.get("GOOGLE_AI_API_KEY") ||
  "";

/**
 * Model tiers — choose based on task complexity and cost sensitivity:
 *
 * - lite:     $0.10/$0.40 per 1M tokens — intent classification, simple extraction, yes/no decisions
 * - standard: $0.30/$2.50 per 1M tokens — general reasoning, chat, email triage, agent tasks
 * - pro:      $1.25/$10.00 per 1M tokens — complex planning, creative generation, multi-factor analysis
 */
export type ModelTier = "lite" | "standard" | "pro";

export const MODEL_IDS: Record<ModelTier, string> = {
  lite: "gemini-2.5-flash-lite",
  standard: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
};

export function getModel(tier: ModelTier): string {
  return MODEL_IDS[tier];
}

/**
 * For functions using OpenRouter/Lovable gateway (chat completions format),
 * model IDs need "google/" prefix
 */
export const GATEWAY_MODEL_IDS: Record<ModelTier, string> = {
  lite: "google/gemini-2.5-flash-lite",
  standard: "google/gemini-2.5-flash",
  pro: "google/gemini-2.5-pro",
};

export function getGatewayModel(tier: ModelTier): string {
  return GATEWAY_MODEL_IDS[tier];
}
