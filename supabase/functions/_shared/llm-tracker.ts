/**
 * LLM Call Tracker — Observability for Every AI Call
 * ===================================================
 * Wraps Gemini API calls with automatic:
 *   - Latency measurement
 *   - Token counting (from response metadata)
 *   - Cost estimation (per-model pricing)
 *   - Structured logging to olive_llm_calls table
 *
 * All logging is non-blocking (fire-and-forget).
 * If tracking fails, the LLM response is still returned.
 *
 * Usage:
 *   import { createLLMTracker } from "../_shared/llm-tracker.ts";
 *   const tracker = createLLMTracker(supabase, "ask-olive-stream", userId);
 *   const response = await tracker.generate({
 *     model: "gemini-2.5-flash",
 *     contents: "...",
 *     config: { temperature: 0.3 },
 *   }, { promptVersion: "chat-v2.1" });
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ModelTier } from "./gemini.ts";
import type {
  LlmRequest,
  LlmResponse,
  ProviderName,
} from "./llm-providers/types.ts";
import { LlmError } from "./llm-providers/types.ts";
import { getProviderChain } from "./llm-providers/index.ts";

// ─── Model Pricing (USD per 1M tokens) ─────────────────────────
// Updated for April 2026 pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash":      { input: 0.15,  output: 0.60 },
  "gemini-2.5-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-2.0-flash":      { input: 0.10,  output: 0.40 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-1.5-flash":      { input: 0.075, output: 0.30 },
  "gemini-2.5-pro":        { input: 1.25,  output: 5.00 },
  "gemini-2.0-pro":        { input: 1.25,  output: 5.00 },
  "gemini-1.5-pro":        { input: 1.25,  output: 5.00 },
  "gemini-embedding-001":  { input: 0.00,  output: 0.00 },
  // free tier; update when paid tier introduced.
  "llama-3.3-70b":           { input: 0,     output: 0    }, // Cerebras
  // free tier; update when paid tier introduced.
  "llama-3.3-70b-versatile": { input: 0,     output: 0    }, // Groq
};

function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  // Find the best pricing match (handle version suffixes)
  const pricing =
    MODEL_PRICING[model] ||
    Object.entries(MODEL_PRICING).find(([k]) => model.includes(k))?.[1] ||
    { input: 0.15, output: 0.60 }; // Default to Flash pricing

  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}

// ─── Token extraction from Gemini response ─────────────────────
function extractTokenCounts(response: any): {
  tokensIn: number;
  tokensOut: number;
} {
  // Gemini responses include usageMetadata
  const usage = response?.usageMetadata;
  if (usage) {
    return {
      tokensIn: usage.promptTokenCount || 0,
      tokensOut: usage.candidatesTokenCount || usage.totalTokenCount || 0,
    };
  }

  // Fallback: estimate from content length
  const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return {
    tokensIn: 0, // Can't estimate input without the prompt
    tokensOut: Math.ceil(text.length / 4),
  };
}

// ─── Tracker Interface ─────────────────────────────────────────
export interface TrackerOptions {
  promptVersion?: string;
  metadata?: Record<string, unknown>;
  /** Per-slot token breakdown from context-contract assembly */
  slotTokens?: Record<string, number>;
  /** Total tokens used by context assembly (pre-LLM) */
  contextTotalTokens?: number;
  /** Slots that exceeded their budget */
  slotsOverBudget?: string[];
  /**
   * Which LLM provider produced the row. Defaults to "gemini" so existing
   * callers of tracker.generate() keep logging with the historically-correct
   * value. generateWithChain() always sets this explicitly per attempt.
   */
  provider?: ProviderName;
}

/**
 * Retry + same-provider fallback policy for `generate`.
 *
 * Defaults (when `retry` is provided but a field is omitted):
 *   - `maxAttempts`: 3 attempts per model
 *   - `backoffMs`: 1000 * 2^attempt + jitter, capped at 8000
 *   - `fallbackModels`: [] (no fallback)
 *   - `retryableStatus`: [429, 500, 502, 503, 504]
 *
 * Behavior:
 *   - When `retry` is undefined, behavior is unchanged (one attempt, no fallback).
 *   - Every attempt (success OR failure) logs a row to `olive_llm_calls`.
 *   - When a fallback model is used, the row's `metadata` includes
 *     `fallback_from: <originalModel>` and `attempt: N`.
 *   - Non-retryable status throws immediately (no further attempts/models).
 *   - When all retries on all models exhaust, the last error is thrown.
 */
export interface RetryConfig {
  maxAttempts?: number;
  backoffMs?: (attempt: number) => number;
  fallbackModels?: string[];
  retryableStatus?: number[];
}

export interface LLMTracker {
  /**
   * Generate content with automatic tracking.
   * Drop-in replacement for genai.models.generateContent().
   */
  generate(
    params: {
      model: string;
      contents: any;
      config?: any;
    },
    opts?: TrackerOptions & { retry?: RetryConfig }
  ): Promise<any>;

  /**
   * Provider-agnostic generation that walks an ordered provider chain for a
   * tier (lite / standard / pro). Same-provider retries with exponential
   * backoff on transient errors, then falls over to the next provider on
   * retry exhaustion or fallback-eligible errors (missing API key,
   * unsupported feature). Every attempt logs to olive_llm_calls.
   *
   * Throws when all providers in the chain are exhausted.
   */
  generateWithChain(
    tier: ModelTier,
    req: {
      prompt: string;
      temperature?: number;
      maxOutputTokens?: number;
      responseSchema?: unknown;
    },
    opts?: TrackerOptions & {
      retry?: {
        /** Max attempts PER PROVIDER. Default 2. */
        maxAttempts?: number;
        /**
         * Backoff in ms for attempt N (0-indexed).
         * Default: 1000 * 2^N + jitter, capped 8000.
         */
        backoffMs?: (attempt: number) => number;
      };
      /** AbortSignal forwarded to fetch. */
      signal?: AbortSignal;
    }
  ): Promise<LlmResponse>;

  /**
   * Track a raw fetch-based Gemini call (for functions using direct HTTP).
   * Call this AFTER the fetch completes with the response data.
   */
  trackRawCall(
    model: string,
    startTime: number,
    response: any,
    opts?: TrackerOptions & { error?: string }
  ): void;

  /**
   * Log a streaming call's context-assembly analytics without wrapping the
   * stream itself. Use this when you can't intercept the stream body but still
   * want slot-level token observability.
   *
   * - `tokensIn` is estimated from prompt length (chars/4).
   * - `tokensOut` is 0 (streaming output isn't captured).
   * - `status` defaults to "stream_started".
   */
  logStreamingCall(
    model: string,
    promptCharLength: number,
    latencyToFirstByteMs: number,
    opts?: TrackerOptions & { status?: string; error?: string }
  ): void;
}

/**
 * Create a tracker scoped to a function + user.
 * All subsequent calls inherit the function_name and user_id.
 */
export function createLLMTracker(
  supabase: ReturnType<typeof createClient<any>>,
  functionName: string,
  userId?: string
): LLMTracker {
  const log = (
    model: string,
    latencyMs: number,
    tokensIn: number,
    tokensOut: number,
    status: string,
    opts?: TrackerOptions & { error?: string }
  ): void => {
    // Fire-and-forget — never block the response
    const costUsd = estimateCost(model, tokensIn, tokensOut);

    const row: Record<string, unknown> = {
      user_id: userId || null,
      function_name: functionName,
      model,
      // Provider column added in migration 20260514035226. Defaults to
      // "gemini" so existing callers of tracker.generate() (which still
      // target Gemini directly) keep producing accurate rows.
      provider: opts?.provider ?? "gemini",
      prompt_version: opts?.promptVersion || null,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: latencyMs,
      cost_usd: costUsd,
      status,
      error_message: opts?.error || null,
      metadata: {
        ...(opts?.metadata || {}),
        ...(opts?.slotTokens ? { slot_tokens: opts.slotTokens } : {}),
        ...(opts?.contextTotalTokens != null ? { context_total_tokens: opts.contextTotalTokens } : {}),
        ...(opts?.slotsOverBudget?.length ? { slots_over_budget: opts.slotsOverBudget } : {}),
      },
    };

    Promise.resolve(
      supabase.from("olive_llm_calls").insert(row)
    ).then(() => {}).catch((err: any) => {
      console.warn("[LLMTracker] Non-blocking log error:", err?.message);
    });
  };

  return {
    async generate(params, opts) {
      const GEMINI_API_KEY =
        Deno.env.get("GEMINI_API") ||
        Deno.env.get("GEMINI_API_KEY") ||
        Deno.env.get("GOOGLE_AI_API_KEY") ||
        "";

      // Backwards-compat: when `retry` is undefined, single attempt, no fallback.
      // When `retry` is provided (even as `{}`), apply the configured retry policy
      // with defaults filled in.
      const retryConfig = opts?.retry;
      const retryEnabled = retryConfig !== undefined;
      const maxAttempts = retryEnabled ? (retryConfig?.maxAttempts ?? 3) : 1;
      const fallbackModels = retryEnabled
        ? retryConfig?.fallbackModels ?? []
        : [];
      const retryableStatus =
        retryConfig?.retryableStatus ?? [429, 500, 502, 503, 504];
      const defaultBackoff = (attempt: number) =>
        Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 8000);
      const backoffMs = retryConfig?.backoffMs ?? defaultBackoff;

      const originalModel = params.model;
      const modelsToTry: string[] = [originalModel, ...fallbackModels];
      let lastError: Error | null = null;

      const buildBody = () =>
        JSON.stringify({
          contents: Array.isArray(params.contents)
            ? params.contents
            : [{ parts: [{ text: params.contents }] }],
          generationConfig: params.config
            ? {
                temperature: params.config.temperature,
                maxOutputTokens: params.config.maxOutputTokens,
                responseMimeType: params.config.responseMimeType,
                responseSchema: params.config.responseSchema,
              }
            : undefined,
        });

      for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
        const currentModel = modelsToTry[modelIdx];
        const isFallback = modelIdx > 0;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const startTime = performance.now();
          // When retry is enabled, always include `attempt` so analytics
          // can answer "which attempt was this?" without joining rows.
          // `fallback_from` only appears on rows from a fallback model.
          const baseMeta: Record<string, unknown> = {
            ...(opts?.metadata || {}),
            ...(retryEnabled ? { attempt } : {}),
            ...(isFallback ? { fallback_from: originalModel } : {}),
          };

          let response: Response;
          try {
            response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${GEMINI_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: buildBody(),
              }
            );
          } catch (networkErr: any) {
            const latencyMs = Math.round(performance.now() - startTime);
            log(currentModel, latencyMs, 0, 0, "error", {
              ...opts,
              error: networkErr?.message?.substring(0, 500),
              metadata: { ...baseMeta, error_type: "network" },
            });
            lastError = networkErr;
            // Network errors are treated as retryable
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, backoffMs(attempt)));
              continue;
            }
            // Exhausted on this model — fall through to next model if any
            break;
          }

          const latencyMs = Math.round(performance.now() - startTime);

          if (!response.ok) {
            const errorText = await response.text();
            const status = response.status;
            const isRetryable = retryableStatus.includes(status);
            const errMessage = `Gemini API error ${status}: ${errorText.substring(0, 200)}`;

            log(currentModel, latencyMs, 0, 0, "error", {
              ...opts,
              error: `${status}: ${errorText.substring(0, 200)}`,
              metadata: { ...baseMeta, status_code: status },
            });

            lastError = new Error(errMessage);

            // Non-retryable: throw immediately, do not try fallback models.
            if (!isRetryable) throw lastError;

            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, backoffMs(attempt)));
              continue;
            }
            // Exhausted on this model — fall through to next model if any
            break;
          }

          const data = await response.json();
          const { tokensIn, tokensOut } = extractTokenCounts(data);
          log(currentModel, latencyMs, tokensIn, tokensOut, "success", {
            ...opts,
            metadata: baseMeta,
          });
          return data;
        }
      }

      throw lastError ||
        new Error("[LLMTracker] All retries and fallback models exhausted");
    },

    async generateWithChain(tier, req, opts) {
      const chain = getProviderChain(tier);
      const maxAttempts = opts?.retry?.maxAttempts ?? 2;
      const backoffMs =
        opts?.retry?.backoffMs ??
        ((n: number) =>
          Math.min(1000 * Math.pow(2, n) + Math.random() * 500, 8000));

      let lastError: unknown = null;

      for (let providerIdx = 0; providerIdx < chain.length; providerIdx++) {
        const entry = chain[providerIdx];
        const llmReq: LlmRequest = {
          model: entry.model,
          prompt: req.prompt,
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          responseSchema: req.responseSchema,
        };

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          const startTime = performance.now();
          try {
            const response = await entry.provider.generate(
              llmReq,
              opts?.signal,
            );
            const latencyMs = Math.round(performance.now() - startTime);
            log(
              response.model,
              latencyMs,
              response.tokensIn,
              response.tokensOut,
              "success",
              {
                ...opts,
                provider: response.providerName,
                metadata: {
                  ...(opts?.metadata ?? {}),
                  provider_chain_index: providerIdx,
                  provider_attempt: attempt,
                  tier,
                },
              },
            );
            return response;
          } catch (err) {
            const latencyMs = Math.round(performance.now() - startTime);
            const isLlmError = err instanceof LlmError;
            const status = isLlmError ? (err as LlmError).status : 0;
            const retryable = isLlmError
              ? (err as LlmError).retryable
              : false;
            const fallbackEligible = isLlmError
              ? (err as LlmError).fallbackEligible
              : true;
            const msg = err instanceof Error ? err.message : String(err);

            log(entry.model, latencyMs, 0, 0, "error", {
              ...opts,
              provider: entry.provider.name,
              error: msg.slice(0, 500),
              metadata: {
                ...(opts?.metadata ?? {}),
                provider_chain_index: providerIdx,
                provider_attempt: attempt,
                tier,
                status,
              },
            });

            lastError = err;

            // Terminal error (e.g. 4xx auth) — propagate immediately.
            if (isLlmError && !retryable && !fallbackEligible) throw err;

            // Retryable on the same provider: backoff and try again.
            if (retryable && attempt < maxAttempts - 1) {
              await new Promise((r) => setTimeout(r, backoffMs(attempt)));
              continue;
            }

            // Either retries exhausted on this provider, or this error is
            // fallback-only (missing API key, unsupported feature). Move on.
            if (fallbackEligible) break;

            // Not retryable AND not fallback-eligible — guarded above but
            // defensive in case classification changes.
            throw err;
          }
        }
      }

      throw new Error(
        `[generateWithChain] All providers exhausted for tier=${tier}. Last error: ${
          lastError instanceof Error ? lastError.message : String(lastError)
        }`,
      );
    },

    trackRawCall(model, startTime, response, opts) {
      const latencyMs = Math.round(performance.now() - startTime);
      const { tokensIn, tokensOut } = extractTokenCounts(response);
      const status = opts?.error ? "error" : "success";
      log(model, latencyMs, tokensIn, tokensOut, status, opts);
    },

    logStreamingCall(model, promptCharLength, latencyToFirstByteMs, opts) {
      const tokensIn = Math.ceil(promptCharLength / 4);
      const status = opts?.status || (opts?.error ? "error" : "stream_started");
      // tokens_out = 0 — streaming output isn't captured here. A future
      // enhancement could accumulate streamed chunks and update the row.
      log(model, latencyToFirstByteMs, tokensIn, 0, status, opts);
    },
  };
}
