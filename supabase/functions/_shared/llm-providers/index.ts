/**
 * Provider chain registry — per-tier ordered fallback chains.
 * Sole entry point for callers asking "what's the chain for tier X?"
 *
 * Chains are intentionally hand-coded here, NOT derived from
 * gemini.ts/MODEL_IDS, because each tier has provider-specific fallback
 * model choices and a tier-specific provider order.
 *
 * Rationale for Cerebras before Groq: Cerebras free tier is 1M tokens/day
 * at 60K TPM with 30 RPM; Groq is 30 RPM but only 6K TPM. Cerebras handles
 * burst better; Groq is the long tail.
 */

import type { ModelTier } from "../gemini.ts";
import type { Chain } from "./types.ts";
import { geminiProvider } from "./gemini.ts";
import { cerebrasProvider, groqProvider } from "./openai-compatible.ts";

const CHAINS: Record<ModelTier, Chain> = {
  lite: [
    { provider: geminiProvider, model: "gemini-2.5-flash-lite" },
    { provider: cerebrasProvider, model: "llama-3.3-70b" },
    { provider: groqProvider, model: "llama-3.3-70b-versatile" },
  ],
  standard: [
    { provider: geminiProvider, model: "gemini-2.5-flash" },
    { provider: cerebrasProvider, model: "llama-3.3-70b" },
    { provider: groqProvider, model: "llama-3.3-70b-versatile" },
  ],
  pro: [
    { provider: geminiProvider, model: "gemini-2.5-pro" },
    { provider: cerebrasProvider, model: "llama-3.3-70b" },
    // No Groq for pro: 6K TPM cap is too tight for long contexts.
  ],
};

export function getProviderChain(tier: ModelTier): Chain {
  return CHAINS[tier];
}

export { geminiProvider, cerebrasProvider, groqProvider };
export * from "./types.ts";
