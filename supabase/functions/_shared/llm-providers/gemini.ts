/**
 * Gemini Provider — REST implementation
 * =====================================
 * Wraps the Gemini v1beta REST API in the LlmProvider interface.
 * Uses the same endpoint as llm-tracker.ts so behavior is consistent.
 */

import type { LlmProvider, LlmRequest, LlmResponse } from "./types.ts";
import { LlmError } from "./types.ts";

// Status codes that are transient and should be retried on Gemini.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;

  async generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    // Re-read the env at call time (rather than reusing the GEMINI_KEY
    // import-time constant) so tests and runtime overrides are honored.
    const apiKey =
      Deno.env.get("GEMINI_API") ||
      Deno.env.get("GEMINI_API_KEY") ||
      Deno.env.get("GOOGLE_AI_API_KEY") ||
      "";

    if (!apiKey) {
      throw new LlmError(
        "gemini",
        0,
        false,
        true,
        "GEMINI_API_KEY not configured",
      );
    }

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent?key=${apiKey}`;

    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        ...(req.responseSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: req.responseSchema,
            }
          : {}),
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      // Network-level error — retryable on same provider, also fallback-eligible.
      const msg = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        "gemini",
        0,
        true,
        true,
        `network error: ${msg.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      const status = response.status;
      const retryable = RETRYABLE_STATUS.has(status);
      // 400/401/403 are terminal. 429/5xx are retryable + fallback-eligible.
      const fallbackEligible = retryable;
      throw new LlmError(
        "gemini",
        status,
        retryable,
        fallbackEligible,
        `${status}: ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const usage = data?.usageMetadata ?? {};
    return {
      text: text.trim(),
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: usage.candidatesTokenCount ?? usage.totalTokenCount ?? 0,
      raw: data,
      providerName: "gemini",
      model: req.model,
    };
  }
}

export const geminiProvider = new GeminiProvider();
