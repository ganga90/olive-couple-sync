/**
 * LLM Provider Abstraction — Types
 * =================================
 * Normalized request/response shape across Gemini (REST) and
 * OpenAI-compatible providers (Groq, Cerebras). Used by the multi-provider
 * chain dispatcher in llm-tracker.ts:generateWithChain().
 */

import type { ModelTier as _ModelTier } from "../gemini.ts";
// Imported for downstream callers; re-exported so call sites can import
// everything from "../llm-providers/index.ts".
export type ModelTier = _ModelTier;

export interface LlmRequest {
  /** Provider-specific model id (e.g. "gemini-2.5-flash-lite", "llama-3.3-70b"). */
  model: string;
  /** Single-string prompt. Multi-turn messages are a future extension. */
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * JSON Schema for structured output. Gemini provider maps to
   * `responseSchema` + `responseMimeType="application/json"`.
   * OpenAI-compatible provider maps to `response_format.json_schema`.
   * If a provider can't support it natively, the provider's `generate`
   * MUST throw `LlmError(..., "unsupported_feature", retryable: false,
   * fallbackEligible: true, ...)` so the chain skips it.
   */
  responseSchema?: unknown;
}

export interface LlmResponse {
  /** Generated text. Trimmed of trailing whitespace. */
  text: string;
  /** Input token count from the provider's usage metadata. */
  tokensIn: number;
  /** Output token count from the provider's usage metadata. */
  tokensOut: number;
  /** Original provider response, for debugging. Never logged to DB. */
  raw: unknown;
  /** Which provider produced this response. */
  providerName: ProviderName;
  /** Which model id was used. */
  model: string;
}

export type ProviderName = "gemini" | "cerebras" | "groq";

/**
 * Typed error from a provider call. Classification determines chain behavior:
 *
 *   retryable=true   — same-provider retry with backoff (typical for 429, 5xx).
 *   fallbackEligible — chain moves to next provider when retries exhaust OR
 *                      when the error is a transport/config issue specific to
 *                      this provider (e.g. missing API key, unsupported feature).
 *   neither          — terminal. Propagated up (4xx auth, 400 schema, etc).
 */
export class LlmError extends Error {
  constructor(
    public providerName: ProviderName,
    public status: number,
    public retryable: boolean,
    public fallbackEligible: boolean,
    message: string,
  ) {
    super(`[${providerName}] ${message}`);
    this.name = "LlmError";
  }
}

export interface LlmProvider {
  readonly name: ProviderName;
  generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse>;
}

/** Ordered chain entry: which provider + which model to use. */
export interface ChainEntry {
  provider: LlmProvider;
  model: string;
}

export type Chain = ChainEntry[];
