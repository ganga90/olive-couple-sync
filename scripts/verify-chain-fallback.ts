/**
 * verify-chain-fallback.ts — Bucket 2 Step 6.3 soft-test
 * =======================================================
 * Exercises the FULL chain dispatcher (createLLMTracker.generateWithChain) +
 * provider classes + provider registry end-to-end against a stubbed HTTP
 * boundary, simulating a broken Gemini key while Cerebras is healthy. Proves
 * the production code path works under fallback conditions without touching
 * any Supabase secrets.
 *
 * This is the in-repo equivalent of Step 6.3's "set GEMINI_API=invalid and
 * watch the chain fall over to Cerebras" — same code path, isolated to this
 * Deno process so live traffic is unaffected.
 *
 * Run:
 *   deno run --allow-net --allow-read --allow-env scripts/verify-chain-fallback.ts
 *
 * Exit codes:
 *   0  — all scenarios pass
 *   1  — any scenario failed
 */

import { createLLMTracker } from "../supabase/functions/_shared/llm-tracker.ts";

// ─── Stubbing harness ─────────────────────────────────────────────

interface CapturedRow {
  model: string;
  provider: string;
  status: string;
  metadata: Record<string, unknown>;
  error_message: string | null;
}

function fakeSupabase(): { client: any; rows: CapturedRow[] } {
  const rows: CapturedRow[] = [];
  const client = {
    from(_table: string) {
      return {
        insert(row: any) {
          rows.push({
            model: row.model,
            provider: row.provider,
            status: row.status,
            metadata: row.metadata ?? {},
            error_message: row.error_message ?? null,
          });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, rows };
}

function scriptedChainFetch(script: {
  gemini?: Array<{ status: number; body: unknown }>;
  cerebras?: Array<{ status: number; body: unknown }>;
  groq?: Array<{ status: number; body: unknown }>;
}): { fetchFn: typeof fetch; callLog: Array<{ provider: string; status: number }> } {
  const queues = {
    gemini: [...(script.gemini ?? [])],
    cerebras: [...(script.cerebras ?? [])],
    groq: [...(script.groq ?? [])],
  };
  const callLog: Array<{ provider: string; status: number }> = [];

  const fetchFn = (async (input: any) => {
    const url = typeof input === "string" ? input : input.url;
    let p: keyof typeof queues;
    if (url.includes("generativelanguage.googleapis.com")) p = "gemini";
    else if (url.includes("api.cerebras.ai")) p = "cerebras";
    else if (url.includes("api.groq.com")) p = "groq";
    else throw new Error(`unknown url: ${url}`);
    const q = queues[p];
    if (!q.length) throw new Error(`no scripted response for ${p}`);
    const next = q.shift()!;
    callLog.push({ provider: p, status: next.status });
    return new Response(
      typeof next.body === "string" ? next.body : JSON.stringify(next.body),
      { status: next.status, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  return { fetchFn, callLog };
}

async function withStubbedFetch<T>(
  fetchFn: typeof fetch,
  body: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    return await body();
  } finally {
    globalThis.fetch = original;
  }
}

// ─── Scenarios ────────────────────────────────────────────────────

interface ScenarioResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function scenarioGeminiDown_CerebrasUp(): Promise<ScenarioResult> {
  // Pretend GEMINI_API is set but rejecting (e.g. invalid key — Google returns 429
  // or 400 depending; we use 429 because that's the operationally interesting case
  // we're trying to defend against).
  Deno.env.set("GEMINI_API_KEY", "intentionally_bad_for_test");
  Deno.env.set("CEREBRAS_API_KEY", "any-nonempty-value");
  Deno.env.set("GROQ_API_KEY", "any-nonempty-value");

  const { fetchFn, callLog } = scriptedChainFetch({
    // 2 attempts × 429 = exhaust gemini
    gemini: [
      { status: 429, body: "Resource exhausted" },
      { status: 429, body: "Resource exhausted" },
    ],
    cerebras: [
      {
        status: 200,
        body: {
          choices: [
            {
              message: {
                content:
                  "## Profile\\n- Cerebras Llama answered after Gemini exhausted.\\n",
              },
            },
          ],
          usage: { prompt_tokens: 4_500, completion_tokens: 480 },
        },
      },
    ],
  });

  const { client, rows } = fakeSupabase();

  let throwCaught: unknown = null;
  let response: any = null;
  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "verify-chain-fallback", "user_test");
    try {
      response = await tracker.generateWithChain(
        "lite",
        { prompt: "Summarize the user's profile in markdown.", temperature: 0.2 },
        { retry: { maxAttempts: 2, backoffMs: () => 0 } },
      );
    } catch (e) {
      throwCaught = e;
    }
  });

  if (throwCaught) {
    return {
      name: "Gemini 429×2 → Cerebras success",
      pass: false,
      detail: `unexpected throw: ${(throwCaught as Error).message}`,
    };
  }

  const expectedCallLog = [
    { provider: "gemini", status: 429 },
    { provider: "gemini", status: 429 },
    { provider: "cerebras", status: 200 },
  ];
  const callsMatch =
    JSON.stringify(callLog) === JSON.stringify(expectedCallLog);
  const cerebrasResponse = response?.providerName === "cerebras";
  const rowsCorrect =
    rows.length === 3 &&
    rows[0].provider === "gemini" && rows[0].status === "error" &&
    rows[1].provider === "gemini" && rows[1].status === "error" &&
    rows[2].provider === "cerebras" && rows[2].status === "success" &&
    rows[2].metadata.provider_chain_index === 1 &&
    rows[2].metadata.tier === "lite";

  return {
    name: "Gemini 429×2 → Cerebras success",
    pass: callsMatch && cerebrasResponse && rowsCorrect,
    detail:
      `calls=${JSON.stringify(callLog)} providerName=${response?.providerName} ` +
      `rows=${JSON.stringify(rows.map((r) => ({ p: r.provider, s: r.status })))}`,
  };
}

async function scenarioGeminiKeyMissing(): Promise<ScenarioResult> {
  // No GEMINI_API* env → provider throws missing-key (fallback-eligible) BEFORE
  // any HTTP. Cerebras should be called immediately.
  Deno.env.delete("GEMINI_API");
  Deno.env.delete("GEMINI_API_KEY");
  Deno.env.delete("GOOGLE_AI_API_KEY");
  Deno.env.set("CEREBRAS_API_KEY", "any-nonempty-value");

  const { fetchFn, callLog } = scriptedChainFetch({
    gemini: [], // never invoked
    cerebras: [
      {
        status: 200,
        body: {
          choices: [{ message: { content: "Cerebras handled the missing-key case." } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        },
      },
    ],
  });
  const { client, rows } = fakeSupabase();

  let response: any = null;
  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "verify-chain-fallback", "user_test");
    response = await tracker.generateWithChain(
      "lite",
      { prompt: "test" },
      { retry: { maxAttempts: 1, backoffMs: () => 0 } },
    );
  });

  const onlyCerebrasCalled =
    callLog.length === 1 && callLog[0].provider === "cerebras";
  const correctProvider = response?.providerName === "cerebras";
  // Two rows: gemini config-error + cerebras success
  const rowsCorrect =
    rows.length === 2 &&
    rows[0].provider === "gemini" && rows[0].status === "error" &&
    rows[1].provider === "cerebras" && rows[1].status === "success";

  return {
    name: "Gemini key missing → Cerebras short-circuit",
    pass: onlyCerebrasCalled && correctProvider && rowsCorrect,
    detail:
      `calls=${JSON.stringify(callLog)} providerName=${response?.providerName} ` +
      `rowCount=${rows.length}`,
  };
}

async function scenarioAllProvidersDown(): Promise<ScenarioResult> {
  Deno.env.set("GEMINI_API_KEY", "x");
  Deno.env.set("CEREBRAS_API_KEY", "x");
  Deno.env.set("GROQ_API_KEY", "x");
  const { fetchFn } = scriptedChainFetch({
    gemini: [{ status: 429, body: "rate" }],
    cerebras: [{ status: 429, body: "rate" }],
    groq: [{ status: 429, body: "rate" }],
  });
  const { client, rows } = fakeSupabase();

  let caught: unknown = null;
  await withStubbedFetch(fetchFn, async () => {
    const tracker = createLLMTracker(client, "verify-chain-fallback", "user_test");
    try {
      await tracker.generateWithChain(
        "lite",
        { prompt: "test" },
        { retry: { maxAttempts: 1, backoffMs: () => 0 } },
      );
    } catch (e) {
      caught = e;
    }
  });

  const threwAggregate =
    caught instanceof Error && caught.message.includes("All providers exhausted");
  const oneErrorPerProvider =
    rows.length === 3 &&
    rows.every((r) => r.status === "error") &&
    new Set(rows.map((r) => r.provider)).size === 3;

  return {
    name: "All providers 429 → aggregate throw, row per provider",
    pass: threwAggregate && oneErrorPerProvider,
    detail: `error=${(caught as Error)?.message?.slice(0, 80)} rows=${rows.length}`,
  };
}

// ─── Main ─────────────────────────────────────────────────────────

const scenarios = [
  scenarioGeminiDown_CerebrasUp,
  scenarioGeminiKeyMissing,
  scenarioAllProvidersDown,
];

const results: ScenarioResult[] = [];
for (const s of scenarios) {
  results.push(await s());
}

console.log("\n=== Bucket 2 Step 6.3 — Chain Fallback Soft-Test ===\n");
let allPass = true;
for (const r of results) {
  const icon = r.pass ? "✅" : "❌";
  console.log(`${icon}  ${r.name}`);
  console.log(`    ${r.detail}\n`);
  if (!r.pass) allPass = false;
}

Deno.exit(allPass ? 0 : 1);
