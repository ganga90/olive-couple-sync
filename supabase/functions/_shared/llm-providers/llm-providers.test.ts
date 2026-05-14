/**
 * llm-providers.test.ts — per-provider unit tests
 * ================================================
 * Each test stubs `globalThis.fetch` so no network is hit. Verifies the
 * normalized LlmResponse shape and the LlmError classification matrix.
 *
 * Run: deno test supabase/functions/_shared/llm-providers/ --allow-net --allow-env --allow-read
 */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { GeminiProvider } from "./gemini.ts";
import { OpenAICompatibleProvider } from "./openai-compatible.ts";
import { LlmError } from "./types.ts";

function withFetchStub<T>(
  stub: (req: Request) => Promise<Response>,
  fn: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: any, init?: any) =>
    stub(new Request(input, init))) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

Deno.test("GeminiProvider — success returns normalized response", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  await withFetchStub(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "hello world  " }] } }],
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
          }),
          { status: 200 },
        ),
      ),
    async () => {
      const p = new GeminiProvider();
      const r = await p.generate({
        model: "gemini-2.5-flash-lite",
        prompt: "hi",
      });
      assertEquals(r.text, "hello world");
      assertEquals(r.tokensIn, 10);
      assertEquals(r.tokensOut, 5);
      assertEquals(r.providerName, "gemini");
      assertEquals(r.model, "gemini-2.5-flash-lite");
    },
  );
});

Deno.test("GeminiProvider — 429 throws retryable + fallback-eligible LlmError", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.resolve(new Response("Resource exhausted", { status: 429 })),
    async () => {
      const p = new GeminiProvider();
      const err = await assertRejects(
        () => p.generate({ model: "gemini-2.5-flash-lite", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, true);
      assertEquals((err as LlmError).fallbackEligible, true);
      assertEquals((err as LlmError).status, 429);
      assertEquals((err as LlmError).providerName, "gemini");
    },
  );
});

Deno.test("GeminiProvider — 5xx is retryable + fallback-eligible", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.resolve(new Response("Service unavailable", { status: 503 })),
    async () => {
      const p = new GeminiProvider();
      const err = await assertRejects(
        () => p.generate({ model: "gemini-2.5-flash-lite", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, true);
      assertEquals((err as LlmError).fallbackEligible, true);
    },
  );
});

Deno.test("GeminiProvider — 400 throws non-retryable, non-fallback LlmError", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.resolve(new Response("bad request", { status: 400 })),
    async () => {
      const p = new GeminiProvider();
      const err = await assertRejects(
        () => p.generate({ model: "gemini-2.5-flash-lite", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, false);
      assertEquals((err as LlmError).fallbackEligible, false);
    },
  );
});

Deno.test("GeminiProvider — missing key throws fallback-eligible LlmError", async () => {
  Deno.env.delete("GEMINI_API");
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GOOGLE_AI_API_KEY");
  const p = new GeminiProvider();
  const err = await assertRejects(
    () => p.generate({ model: "gemini-2.5-flash-lite", prompt: "hi" }),
    LlmError,
  );
  assertEquals((err as LlmError).retryable, false);
  assertEquals((err as LlmError).fallbackEligible, true);
});

Deno.test("GeminiProvider — network error throws retryable + fallback-eligible", async () => {
  Deno.env.set("GEMINI_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.reject(new TypeError("connection refused")),
    async () => {
      const p = new GeminiProvider();
      const err = await assertRejects(
        () => p.generate({ model: "gemini-2.5-flash-lite", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, true);
      assertEquals((err as LlmError).fallbackEligible, true);
      assertEquals((err as LlmError).status, 0);
    },
  );
});

Deno.test("OpenAICompatibleProvider (Cerebras) — success parses OpenAI shape", async () => {
  Deno.env.set("CEREBRAS_API_KEY", "test-key");
  await withFetchStub(
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OpenAI-shape response" } }],
            usage: { prompt_tokens: 12, completion_tokens: 7 },
          }),
          { status: 200 },
        ),
      ),
    async () => {
      const p = new OpenAICompatibleProvider({
        name: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKeyEnvVar: "CEREBRAS_API_KEY",
      });
      const r = await p.generate({ model: "llama-3.3-70b", prompt: "hi" });
      assertEquals(r.text, "OpenAI-shape response");
      assertEquals(r.tokensIn, 12);
      assertEquals(r.tokensOut, 7);
      assertEquals(r.providerName, "cerebras");
      assertEquals(r.model, "llama-3.3-70b");
    },
  );
});

Deno.test("OpenAICompatibleProvider (Groq) — sends Bearer auth header", async () => {
  Deno.env.set("GROQ_API_KEY", "groq-secret");
  let capturedAuth: string | null = null;
  await withFetchStub(
    (req) => {
      capturedAuth = req.headers.get("authorization");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 },
        ),
      );
    },
    async () => {
      const p = new OpenAICompatibleProvider({
        name: "groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiKeyEnvVar: "GROQ_API_KEY",
      });
      await p.generate({ model: "llama-3.3-70b-versatile", prompt: "hi" });
    },
  );
  assertEquals(capturedAuth, "Bearer groq-secret");
});

Deno.test("OpenAICompatibleProvider — missing API key throws fallback-eligible LlmError", async () => {
  Deno.env.delete("CEREBRAS_API_KEY");
  const p = new OpenAICompatibleProvider({
    name: "cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    apiKeyEnvVar: "CEREBRAS_API_KEY",
  });
  const err = await assertRejects(
    () => p.generate({ model: "llama-3.3-70b", prompt: "hi" }),
    LlmError,
  );
  assertEquals((err as LlmError).retryable, false);
  assertEquals((err as LlmError).fallbackEligible, true);
  assertEquals((err as LlmError).providerName, "cerebras");
});

Deno.test("OpenAICompatibleProvider — 429 throws retryable + fallback-eligible", async () => {
  Deno.env.set("CEREBRAS_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.resolve(new Response("Too Many Requests", { status: 429 })),
    async () => {
      const p = new OpenAICompatibleProvider({
        name: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKeyEnvVar: "CEREBRAS_API_KEY",
      });
      const err = await assertRejects(
        () => p.generate({ model: "llama-3.3-70b", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, true);
      assertEquals((err as LlmError).fallbackEligible, true);
    },
  );
});

Deno.test("OpenAICompatibleProvider — 401 (auth) is non-retryable, non-fallback", async () => {
  Deno.env.set("CEREBRAS_API_KEY", "test-key");
  await withFetchStub(
    () => Promise.resolve(new Response("Unauthorized", { status: 401 })),
    async () => {
      const p = new OpenAICompatibleProvider({
        name: "cerebras",
        baseUrl: "https://api.cerebras.ai/v1",
        apiKeyEnvVar: "CEREBRAS_API_KEY",
      });
      const err = await assertRejects(
        () => p.generate({ model: "llama-3.3-70b", prompt: "hi" }),
        LlmError,
      );
      assertEquals((err as LlmError).retryable, false);
      assertEquals((err as LlmError).fallbackEligible, false);
    },
  );
});
