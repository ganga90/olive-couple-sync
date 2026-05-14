/**
 * llm-tracker.test.ts — retry + same-provider fallback behavior
 * =============================================================
 * Covers the retry/fallback policy added for Bucket 1 (compile-memory
 * burst fix). Each test stubs `globalThis.fetch` to script a sequence of
 * Gemini responses, and uses a fake supabase whose `.from().insert()`
 * captures every log row so we can assert on the observability
 * invariant: "every attempt logs to olive_llm_calls".
 */

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { createLLMTracker } from "./llm-tracker.ts";

// ─── Fakes ────────────────────────────────────────────────────────

interface CapturedRow {
  model: string;
  status: string;
  provider: string;
  tokens_in: number;
  tokens_out: number;
  metadata: Record<string, unknown>;
  error_message: string | null;
}

function fakeSupabase(): {
  client: any;
  rows: CapturedRow[];
} {
  const rows: CapturedRow[] = [];
  const client = {
    from(_table: string) {
      return {
        insert(row: any) {
          rows.push({
            model: row.model,
            status: row.status,
            provider: row.provider,
            tokens_in: row.tokens_in,
            tokens_out: row.tokens_out,
            metadata: row.metadata || {},
            error_message: row.error_message,
          });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, rows };
}

/**
 * Build a scripted fetch that returns successive responses keyed by the
 * model in the URL. Each call to `fetch` for a given model consumes the
 * next entry in that model's queue. Throws if the queue is empty —
 * surfaces unintended extra calls.
 */
function scriptedFetch(
  script: Record<string, Array<{ status: number; body: any }>>
): { fetchFn: typeof fetch; callLog: Array<{ model: string; status: number }> } {
  const queues: Record<string, Array<{ status: number; body: any }>> = {};
  for (const [k, v] of Object.entries(script)) queues[k] = [...v];
  const callLog: Array<{ model: string; status: number }> = [];

  const fetchFn = (async (input: string) => {
    // URL shape: .../models/<modelId>:generateContent?key=...
    const m = /\/models\/([^:]+):/.exec(input);
    const model = m?.[1] ?? "unknown";
    const queue = queues[model];
    if (!queue || queue.length === 0) {
      throw new Error(`[scriptedFetch] No more scripted responses for ${model}`);
    }
    const next = queue.shift()!;
    callLog.push({ model, status: next.status });

    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      {
        status: next.status,
        headers: { "Content-Type": "application/json" },
      }
    );
  }) as unknown as typeof fetch;

  return { fetchFn, callLog };
}

function withStubbedFetch(
  fetchFn: typeof fetch,
  body: () => Promise<void>
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchFn;
  return body().finally(() => {
    globalThis.fetch = original;
  });
}

const SUCCESS_BODY = {
  candidates: [{ content: { parts: [{ text: "hello" }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
};

// Keep tests fast — never actually sleep.
const ZERO_BACKOFF = () => 0;

// ─── Tests ────────────────────────────────────────────────────────

Deno.test("(a) success on first try → 1 success row, attempt=1, no fallback metadata", async () => {
  const { fetchFn } = scriptedFetch({
    "gemini-2.5-flash-lite": [{ status: 200, body: SUCCESS_BODY }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    const out = await tracker.generate(
      { model: "gemini-2.5-flash-lite", contents: "hi" },
      { retry: { maxAttempts: 3, backoffMs: ZERO_BACKOFF } }
    );
    assertEquals(out?.candidates?.[0]?.content?.parts?.[0]?.text, "hello");
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "success");
  assertEquals(rows[0].tokens_in, 10);
  assertEquals(rows[0].tokens_out, 5);
  // Retry was enabled, so `attempt` is always recorded — even on first-try success
  assertEquals(rows[0].metadata.attempt, 1);
  assertEquals(rows[0].metadata.fallback_from, undefined);
});

Deno.test("(b) 429 then success on same model → 2 rows (error+success), attempt metadata on success", async () => {
  const { fetchFn, callLog } = scriptedFetch({
    "gemini-2.5-flash-lite": [
      { status: 429, body: "rate limited" },
      { status: 200, body: SUCCESS_BODY },
    ],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    const out = await tracker.generate(
      { model: "gemini-2.5-flash-lite", contents: "hi" },
      { retry: { maxAttempts: 3, backoffMs: ZERO_BACKOFF } }
    );
    assertEquals(out?.candidates?.[0]?.content?.parts?.[0]?.text, "hello");
  });

  assertEquals(callLog.length, 2);
  assertEquals(callLog[0].status, 429);
  assertEquals(callLog[1].status, 200);

  assertEquals(rows.length, 2);
  assertEquals(rows[0].status, "error");
  assertEquals(rows[0].metadata.attempt, 1);
  assertEquals(rows[0].metadata.status_code, 429);
  assertEquals(rows[0].metadata.fallback_from, undefined);

  assertEquals(rows[1].status, "success");
  assertEquals(rows[1].metadata.attempt, 2);
  assertEquals(rows[1].metadata.fallback_from, undefined);
});

Deno.test("(c) 429 exhausts primary → fallback model succeeds → metadata.fallback_from set", async () => {
  const { fetchFn, callLog } = scriptedFetch({
    "gemini-2.5-flash-lite": [
      { status: 429, body: "rate limited" },
      { status: 429, body: "rate limited" },
      { status: 429, body: "rate limited" },
    ],
    "gemini-2.5-flash": [{ status: 200, body: SUCCESS_BODY }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    const out = await tracker.generate(
      { model: "gemini-2.5-flash-lite", contents: "hi" },
      {
        retry: {
          maxAttempts: 3,
          backoffMs: ZERO_BACKOFF,
          fallbackModels: ["gemini-2.5-flash", "gemini-2.0-flash"],
        },
      }
    );
    assertEquals(out?.candidates?.[0]?.content?.parts?.[0]?.text, "hello");
  });

  // 3 attempts on primary + 1 success on first fallback = 4 fetch calls
  assertEquals(callLog.length, 4);
  assertEquals(rows.length, 4);

  // First three rows: primary model, status=error
  for (let i = 0; i < 3; i++) {
    assertEquals(rows[i].model, "gemini-2.5-flash-lite");
    assertEquals(rows[i].status, "error");
    assertEquals(rows[i].metadata.attempt, i + 1);
    // No `fallback_from` on primary-model attempts
    assertEquals(rows[i].metadata.fallback_from, undefined);
  }

  // Final row: fallback model, status=success, with fallback_from + attempt=1
  assertEquals(rows[3].model, "gemini-2.5-flash");
  assertEquals(rows[3].status, "success");
  assertEquals(rows[3].metadata.fallback_from, "gemini-2.5-flash-lite");
  assertEquals(rows[3].metadata.attempt, 1);
});

Deno.test("(d) 400 throws immediately with no retry, no fallback", async () => {
  const { fetchFn, callLog } = scriptedFetch({
    "gemini-2.5-flash-lite": [{ status: 400, body: "bad request" }],
    // Fallback should NEVER be called for non-retryable status
    "gemini-2.5-flash": [{ status: 200, body: SUCCESS_BODY }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    await assertRejects(
      () =>
        tracker.generate(
          { model: "gemini-2.5-flash-lite", contents: "hi" },
          {
            retry: {
              maxAttempts: 3,
              backoffMs: ZERO_BACKOFF,
              fallbackModels: ["gemini-2.5-flash"],
            },
          }
        ),
      Error,
      "Gemini API error 400"
    );
  });

  assertEquals(callLog.length, 1);
  assertEquals(callLog[0].model, "gemini-2.5-flash-lite");
  assertEquals(callLog[0].status, 400);

  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "error");
  assertEquals(rows[0].metadata.status_code, 400);
});

Deno.test("(e) all retries on all models exhausted → throws final error, logs every attempt", async () => {
  const { fetchFn, callLog } = scriptedFetch({
    "gemini-2.5-flash-lite": [
      { status: 503, body: "unavail" },
      { status: 503, body: "unavail" },
      { status: 503, body: "unavail" },
    ],
    "gemini-2.5-flash": [
      { status: 429, body: "rate" },
      { status: 429, body: "rate" },
      { status: 429, body: "rate" },
    ],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    await assertRejects(
      () =>
        tracker.generate(
          { model: "gemini-2.5-flash-lite", contents: "hi" },
          {
            retry: {
              maxAttempts: 3,
              backoffMs: ZERO_BACKOFF,
              fallbackModels: ["gemini-2.5-flash"],
            },
          }
        ),
      Error,
      "Gemini API error 429" // last attempt was on fallback, status 429
    );
  });

  // 3 primary attempts + 3 fallback attempts
  assertEquals(callLog.length, 6);
  assertEquals(rows.length, 6);
  for (const r of rows) assertEquals(r.status, "error");

  // Last 3 rows tagged fallback_from
  for (let i = 3; i < 6; i++) {
    assertEquals(rows[i].model, "gemini-2.5-flash");
    assertEquals(rows[i].metadata.fallback_from, "gemini-2.5-flash-lite");
    assertEquals(rows[i].metadata.attempt, i - 2);
  }
});

Deno.test("backwards-compat: omitting `retry` performs exactly one attempt", async () => {
  const { fetchFn, callLog } = scriptedFetch({
    "gemini-2.5-flash-lite": [
      { status: 429, body: "rate" },
      // If a retry slipped in, this success would be consumed and the test
      // would lie about behavior. We expect this never to be called.
      { status: 200, body: SUCCESS_BODY },
    ],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    await assertRejects(
      () =>
        tracker.generate({
          model: "gemini-2.5-flash-lite",
          contents: "hi",
        }),
      Error,
      "Gemini API error 429"
    );
  });

  assertEquals(callLog.length, 1, "must not retry when `retry` is omitted");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "error");
  // Single-attempt path: no `attempt` field (unchanged behavior)
  assertEquals(rows[0].metadata.attempt, undefined);
});

Deno.test("non-retryable status surfaces underlying error message", async () => {
  const { fetchFn } = scriptedFetch({
    "gemini-2.5-flash-lite": [
      { status: 401, body: "unauthorized: bad key" },
    ],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "user_1");
    await assertRejects(
      () =>
        tracker.generate(
          { model: "gemini-2.5-flash-lite", contents: "hi" },
          { retry: { maxAttempts: 3, backoffMs: ZERO_BACKOFF } }
        ),
      Error,
      "401"
    );
  });

  assertEquals(rows.length, 1);
  assert(rows[0].error_message?.includes("401"));
});

// ════════════════════════════════════════════════════════════════════
// generateWithChain — multi-provider chain dispatch (Bucket 2)
// ════════════════════════════════════════════════════════════════════

/**
 * Provider-aware scripted fetch. Routes by URL pattern (Gemini REST vs
 * OpenAI-compatible chat-completions) and pops queue entries keyed by
 * provider name. Used for the chain tests below.
 */
function scriptedChainFetch(script: {
  gemini?: Array<{ status: number; body: any }>;
  cerebras?: Array<{ status: number; body: any }>;
  groq?: Array<{ status: number; body: any }>;
}): {
  fetchFn: typeof fetch;
  callLog: Array<{ provider: string; status: number; url: string }>;
} {
  const queues = {
    gemini: [...(script.gemini ?? [])],
    cerebras: [...(script.cerebras ?? [])],
    groq: [...(script.groq ?? [])],
  };
  const callLog: Array<{ provider: string; status: number; url: string }> = [];

  const fetchFn = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    let provider: keyof typeof queues;
    if (url.includes("generativelanguage.googleapis.com")) {
      provider = "gemini";
    } else if (url.includes("api.cerebras.ai")) {
      provider = "cerebras";
    } else if (url.includes("api.groq.com")) {
      provider = "groq";
    } else {
      throw new Error(`[scriptedChainFetch] unknown URL: ${url}`);
    }
    const queue = queues[provider];
    if (!queue.length) {
      throw new Error(
        `[scriptedChainFetch] no more scripted responses for ${provider}`,
      );
    }
    const next = queue.shift()!;
    callLog.push({ provider, status: next.status, url });
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      {
        status: next.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }) as unknown as typeof fetch;

  return { fetchFn, callLog };
}

const GEMINI_OK = {
  candidates: [{ content: { parts: [{ text: "gemini answer" }] } }],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
};
const CEREBRAS_OK = {
  choices: [{ message: { content: "cerebras answer" } }],
  usage: { prompt_tokens: 12, completion_tokens: 6 },
};
const GROQ_OK = {
  choices: [{ message: { content: "groq answer" } }],
  usage: { prompt_tokens: 8, completion_tokens: 4 },
};

Deno.test("generateWithChain — primary success, only primary logged", async () => {
  Deno.env.set("GEMINI_API_KEY", "test");
  Deno.env.set("CEREBRAS_API_KEY", "test");
  Deno.env.set("GROQ_API_KEY", "test");
  const { fetchFn, callLog } = scriptedChainFetch({
    gemini: [{ status: 200, body: GEMINI_OK }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "u1");
    const r = await tracker.generateWithChain("lite", { prompt: "hi" });
    assertEquals(r.providerName, "gemini");
    assertEquals(r.text, "gemini answer");
  });

  assertEquals(callLog.length, 1);
  assertEquals(callLog[0].provider, "gemini");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "success");
  assertEquals(rows[0].provider, "gemini");
  assertEquals(rows[0].model, "gemini-2.5-flash-lite");
  assertEquals(rows[0].metadata.provider_chain_index, 0);
  assertEquals(rows[0].metadata.provider_attempt, 0);
  assertEquals(rows[0].metadata.tier, "lite");
});

Deno.test("generateWithChain — Gemini 429×2 → Cerebras success; 3 rows (2 gemini errors + 1 cerebras success)", async () => {
  Deno.env.set("GEMINI_API_KEY", "test");
  Deno.env.set("CEREBRAS_API_KEY", "test");
  Deno.env.set("GROQ_API_KEY", "test");
  const { fetchFn, callLog } = scriptedChainFetch({
    gemini: [
      { status: 429, body: "rate" },
      { status: 429, body: "rate" },
    ],
    cerebras: [{ status: 200, body: CEREBRAS_OK }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "u1");
    const r = await tracker.generateWithChain(
      "lite",
      { prompt: "hi" },
      { retry: { maxAttempts: 2, backoffMs: () => 0 } },
    );
    assertEquals(r.providerName, "cerebras");
    assertEquals(r.text, "cerebras answer");
  });

  assertEquals(callLog.length, 3);
  assertEquals(callLog[0].provider, "gemini");
  assertEquals(callLog[1].provider, "gemini");
  assertEquals(callLog[2].provider, "cerebras");

  assertEquals(rows.length, 3);
  assertEquals(rows[0].status, "error");
  assertEquals(rows[0].provider, "gemini");
  assertEquals(rows[0].metadata.provider_attempt, 0);
  assertEquals(rows[0].metadata.status, 429);
  assertEquals(rows[1].status, "error");
  assertEquals(rows[1].provider, "gemini");
  assertEquals(rows[1].metadata.provider_attempt, 1);
  assertEquals(rows[2].status, "success");
  assertEquals(rows[2].provider, "cerebras");
  assertEquals(rows[2].metadata.provider_chain_index, 1);
});

Deno.test("generateWithChain — all providers fail, throws aggregate; row per provider attempt", async () => {
  Deno.env.set("GEMINI_API_KEY", "test");
  Deno.env.set("CEREBRAS_API_KEY", "test");
  Deno.env.set("GROQ_API_KEY", "test");
  const { fetchFn } = scriptedChainFetch({
    gemini: [{ status: 429, body: "rate" }],
    cerebras: [{ status: 429, body: "rate" }],
    groq: [{ status: 429, body: "rate" }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "u1");
    await assertRejects(
      () =>
        tracker.generateWithChain(
          "lite",
          { prompt: "hi" },
          { retry: { maxAttempts: 1, backoffMs: () => 0 } },
        ),
      Error,
      "All providers exhausted",
    );
  });

  assertEquals(rows.length, 3);
  assertEquals(rows.map((r) => r.provider).sort(), [
    "cerebras",
    "gemini",
    "groq",
  ]);
  for (const r of rows) assertEquals(r.status, "error");
});

Deno.test("generateWithChain — Gemini 400 (non-retryable, non-fallback) throws immediately, no fallback attempted", async () => {
  Deno.env.set("GEMINI_API_KEY", "test");
  Deno.env.set("CEREBRAS_API_KEY", "test");
  const { fetchFn, callLog } = scriptedChainFetch({
    gemini: [{ status: 400, body: "bad request" }],
    // Cerebras script intentionally empty: chain must NOT advance.
    cerebras: [],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "u1");
    await assertRejects(
      () =>
        tracker.generateWithChain(
          "lite",
          { prompt: "hi" },
          { retry: { maxAttempts: 2, backoffMs: () => 0 } },
        ),
      Error,
    );
  });

  assertEquals(callLog.length, 1);
  assertEquals(callLog[0].provider, "gemini");
  assertEquals(rows.length, 1);
  assertEquals(rows[0].provider, "gemini");
  assertEquals(rows[0].status, "error");
});

Deno.test("generateWithChain — missing Gemini key falls back to Cerebras success", async () => {
  Deno.env.delete("GEMINI_API");
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GOOGLE_AI_API_KEY");
  Deno.env.set("CEREBRAS_API_KEY", "test");
  Deno.env.set("GROQ_API_KEY", "test");
  const { fetchFn, callLog } = scriptedChainFetch({
    // Gemini queue empty — provider throws on missing-key BEFORE fetch.
    gemini: [],
    cerebras: [{ status: 200, body: CEREBRAS_OK }],
  });
  const { client, rows } = fakeSupabase();

  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "test-fn", "u1");
    const r = await tracker.generateWithChain(
      "lite",
      { prompt: "hi" },
      { retry: { maxAttempts: 1, backoffMs: () => 0 } },
    );
    assertEquals(r.providerName, "cerebras");
  });

  // One gemini error row (config error) + one cerebras success row
  assertEquals(callLog.length, 1);
  assertEquals(callLog[0].provider, "cerebras");
  assertEquals(rows.length, 2);
  assertEquals(rows[0].status, "error");
  assertEquals(rows[0].provider, "gemini");
  assertEquals(rows[1].status, "success");
  assertEquals(rows[1].provider, "cerebras");

  // Restore for any later tests that re-use the module's env
  Deno.env.set("GEMINI_API_KEY", "test");
});
