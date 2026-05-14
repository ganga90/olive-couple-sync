/**
 * OpenAI-Compatible Provider
 * ===========================
 * Single implementation that serves both Groq and Cerebras, since they
 * both expose the OpenAI Chat Completions API. Parameterized by base URL,
 * API key env var, and a friendly provider name for logging.
 */

import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ProviderName,
} from "./types.ts";
import { LlmError } from "./types.ts";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

interface OpenAICompatibleConfig {
  name: ProviderName;
  /** e.g. "https://api.groq.com/openai/v1" */
  baseUrl: string;
  /** e.g. "GROQ_API_KEY" */
  apiKeyEnvVar: string;
}

export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: ProviderName;
  private readonly baseUrl: string;
  private readonly apiKeyEnvVar: string;

  constructor(config: OpenAICompatibleConfig) {
    this.name = config.name;
    this.baseUrl = config.baseUrl;
    this.apiKeyEnvVar = config.apiKeyEnvVar;
  }

  async generate(req: LlmRequest, signal?: AbortSignal): Promise<LlmResponse> {
    const apiKey = Deno.env.get(this.apiKeyEnvVar);
    if (!apiKey) {
      throw new LlmError(
        this.name,
        0,
        false,
        true,
        `${this.apiKeyEnvVar} not configured`,
      );
    }

    const url = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: [{ role: "user", content: req.prompt }],
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxOutputTokens ?? 2048,
      ...(req.responseSchema
        ? {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "response",
                schema: req.responseSchema,
                strict: true,
              },
            },
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new LlmError(
        this.name,
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
      throw new LlmError(
        this.name,
        status,
        retryable,
        retryable,
        `${status}: ${errorText.slice(0, 200)}`,
      );
    }

    const data = await response.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};
    return {
      text: text.trim(),
      tokensIn: usage.prompt_tokens ?? 0,
      tokensOut: usage.completion_tokens ?? 0,
      raw: data,
      providerName: this.name,
      model: req.model,
    };
  }
}

export const cerebrasProvider = new OpenAICompatibleProvider({
  name: "cerebras",
  baseUrl: "https://api.cerebras.ai/v1",
  apiKeyEnvVar: "CEREBRAS_API_KEY",
});

export const groqProvider = new OpenAICompatibleProvider({
  name: "groq",
  baseUrl: "https://api.groq.com/openai/v1",
  apiKeyEnvVar: "GROQ_API_KEY",
});
