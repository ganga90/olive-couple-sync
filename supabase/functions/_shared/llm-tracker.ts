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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Model Pricing (USD per 1M tokens) ─────────────────────────
// Updated for April 2026 pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash":      { input: 0.15,  output: 0.60 },
  "gemini-2.0-flash":      { input: 0.10,  output: 0.40 },
  "gemini-2.0-flash-lite": { input: 0.075, output: 0.30 },
  "gemini-1.5-flash":      { input: 0.075, output: 0.30 },
  "gemini-2.5-pro":        { input: 1.25,  output: 5.00 },
  "gemini-2.0-pro":        { input: 1.25,  output: 5.00 },
  "gemini-1.5-pro":        { input: 1.25,  output: 5.00 },
  "gemini-embedding-001":  { input: 0.00,  output: 0.00 },
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
    opts?: TrackerOptions
  ): Promise<any>;

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

    Promise.resolve(
      supabase
        .from("olive_llm_calls")
        .insert({
          user_id: userId || null,
          function_name: functionName,
          model,
          prompt_version: opts?.promptVersion || null,
          tokens_in: tokensIn,
          tokens_out: tokensOut,
          latency_ms: latencyMs,
          cost_usd: costUsd,
          status,
          error_message: opts?.error || null,
          metadata: opts?.metadata || {},
        })
    ).then(() => {}).catch((err: any) => {
      console.warn("[LLMTracker] Non-blocking log error:", err?.message);
    });
  };

  return {
    async generate(params, opts) {
      const startTime = performance.now();
      try {
        // Import GoogleGenAI dynamically to avoid circular deps
        const GEMINI_API_KEY =
          Deno.env.get("GEMINI_API") ||
          Deno.env.get("GEMINI_API_KEY") ||
          Deno.env.get("GOOGLE_AI_API_KEY") ||
          "";

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
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
            }),
          }
        );

        const latencyMs = Math.round(performance.now() - startTime);

        if (!response.ok) {
          const errorText = await response.text();
          log(params.model, latencyMs, 0, 0, "error", {
            ...opts,
            error: `${response.status}: ${errorText.substring(0, 200)}`,
          });
          throw new Error(
            `Gemini API error ${response.status}: ${errorText.substring(0, 200)}`
          );
        }

        const data = await response.json();
        const { tokensIn, tokensOut } = extractTokenCounts(data);
        log(params.model, latencyMs, tokensIn, tokensOut, "success", opts);

        return data;
      } catch (err: any) {
        const latencyMs = Math.round(performance.now() - startTime);
        log(params.model, latencyMs, 0, 0, "error", {
          ...opts,
          error: err?.message?.substring(0, 500),
        });
        throw err;
      }
    },

    trackRawCall(model, startTime, response, opts) {
      const latencyMs = Math.round(performance.now() - startTime);
      const { tokensIn, tokensOut } = extractTokenCounts(response);
      const status = opts?.error ? "error" : "success";
      log(model, latencyMs, tokensIn, tokensOut, status, opts);
    },
  };
}
