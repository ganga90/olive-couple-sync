# PROGRESS.md — Bucket 2: Multi-Provider LLM Abstraction

**Branch:** `feat/multi-provider-llm`
**Started:** 2026-05-14 (Bucket 1 had been merged to main earlier the same day — see CHANGES.md `[COMPILE-BURST-1]` entry and PR [#127](https://github.com/ganga90/olive-couple-sync/pull/127), squash SHA `4b0415b`).
**Bucket 1 status when this PR started:** **Bucket 1 IS merged**, so the "if Bucket 1 IS merged" branch of Step 4.4 applies — pacing logic kept as-is, only the call site was swapped.

---

## What landed in this PR

1. New `_shared/llm-providers/` package:
   - `types.ts` — `LlmRequest`, `LlmResponse`, `LlmError`, `LlmProvider`, `Chain` interfaces.
   - `gemini.ts` — REST implementation that matches `llm-tracker.ts`'s existing endpoint/auth shape so behavior is identical to today.
   - `openai-compatible.ts` — single class parameterized by name/baseUrl/apiKeyEnvVar; instantiated as `cerebrasProvider` (Cerebras Cloud) and `groqProvider` (Groq).
   - `index.ts` — chain registry exposing `getProviderChain(tier)` per `ModelTier` (`lite | standard | pro`). Chain order is hand-coded, not derived from `MODEL_IDS`, because each tier needs different fallback model ids and (for `pro`) a different chain length.
2. Migration `20260514035835_add_provider_to_llm_calls.sql` — adds `provider text NOT NULL DEFAULT 'gemini'` to `olive_llm_calls`, indexes `(provider, created_at)`, and recreates the `olive_llm_analytics` view with `provider` appended at the end of the SELECT (CREATE OR REPLACE VIEW does not permit reordering existing columns). Applied via Supabase MCP `apply_migration` (ledger time `20260514035835`).
3. `llm-tracker.ts` extensions:
   - `TrackerOptions` gains `provider?: ProviderName`; `log()` writes `row.provider = opts?.provider ?? "gemini"` so all existing callers stay backwards-compatible while still populating the new column.
   - New `MODEL_PRICING` entries for `llama-3.3-70b` and `llama-3.3-70b-versatile` at `$0` (free tier).
   - New `generateWithChain(tier, req, opts)` method that walks the provider chain with same-provider retry (default 2 attempts, exponential backoff capped 8s), cross-provider fallback on retry exhaustion / fallback-eligible errors, and a row-per-attempt audit trail.
4. `olive-compile-memory/index.ts` migrated to `tracker.generateWithChain("lite", { prompt, ... }, { retry: { maxAttempts: 2 } })`. Pacing (env-driven `COMPILE_BATCH_SLEEP_MS`) inherited from Bucket 1 untouched.
5. Tests: 11 new provider unit tests + 5 chain-dispatch tests added to `llm-tracker.test.ts`. Total suite: **1248 passed / 0 failed** (1232 baseline + 16 new).
6. `scripts/verify-chain-fallback.ts` — Step 6.3 soft-test runner that exercises the full chain dispatcher with the deployed code path while stubbing HTTP, so we don't have to invalidate the prod Gemini key to demonstrate fallback.

---

## Verification results

### 6.1 — Migration applied
```
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'olive_llm_calls' AND column_name = 'provider';
```
→ `provider | text | 'gemini'::text | NO` ✅

### 6.2 — Primary path
Force-compile of `user_35qkEgvbMI0SzIpvEsDW35drgLu` on the deployed function:
```
provider | model                   | status  | count
---------+-------------------------+---------+------
gemini   | gemini-2.5-flash-lite   | success | 4
```
All four rows carry `metadata.tier = "lite"`, `metadata.provider_chain_index = 0`, `metadata.provider_attempt = 0`. ✅

### 6.3 — Forced fallback (soft-tested via `scripts/verify-chain-fallback.ts`)
Per AskUserQuestion answer, the prompt's literal "set GEMINI_API to an invalid value in prod" was rejected (it would have broken every other Gemini-using function for the window). Instead, the soft-test exercises the production code path with a stubbed HTTP boundary:

| Scenario | Result | Notes |
|---|---|---|
| Gemini 429×2 → Cerebras success | ✅ | Calls: gemini×2 (429) → cerebras (200). 3 log rows: 2 gemini errors + 1 cerebras success with `provider_chain_index=1`. |
| Gemini key missing → Cerebras short-circuit | ✅ | Gemini provider throws `LlmError(retryable=false, fallbackEligible=true)` before fetch; chain advances to Cerebras. 2 rows: gemini config-error + cerebras success. |
| All 3 providers 429 → aggregate throw | ✅ | One error row per provider, error message contains `"All providers exhausted"`. |

### 6.4 — i18n quality sanity check
**Pool reality**: production has 4 it-IT users (32 notes total) and 3 es-ES users (3 notes total). The spec's "5 conversations each" wasn't achievable — I compiled all 3 es-ES users + 3 it-IT users (one it-IT user with thin data was excluded). Outputs are from the **Gemini primary path** since the chain only falls over to Cerebras/Groq when Gemini fails, which it didn't during the test.

| User | Language | Profile artifact summary | Judgment |
|---|---|---|---|
| `user_3AwAArpXzyZ1FTP518zSiCXJgoL` | es-ES | English markdown skeleton with embedded Spanish labels ("Familia", "Conversacional"); structure intact, content thin (1 note). | ✅ acceptable |
| `user_3BPJqyH6rlnlkvpXHoLKZZCOzL7` | es-ES | English skeleton with "Pareja", "Conversacional" preserved; thin data. | ✅ acceptable |
| `user_3CTCyHYICgIXkBbMhSSqBP8ORjR` | es-ES | English skeleton, no Spanish content surfaced (user's only note was an English organization task). | ✅ acceptable |
| `user_39l7E8GyA4bX498AUqVcjSbO0mJ` | it-IT | English skeleton with Italian items preserved ("Sveglia", "Giacca", "Felpa", "Costume", "Pantaloni corti", "Camicia", "Muta", "Asciugamano", "Sacca pelo"); accurate location facts (Gerez/Firenze). | ✅ acceptable |
| `user_3BGetgYAglxEqOS4rdu4bcwxWQK` | it-IT | English skeleton with bilingual rendering ("Coppia (Couple)", "Vegetariano (Vegetarian)") + Italian research title preserved verbatim. | ✅ acceptable |
| `user_3CGTUAj4tyX1lZ7LQFoTljBOqqm` | it-IT | All-English output — user's underlying notes are in English. Accurate. | ✅ acceptable |

**Bottom line**: 6/6 ✅, no ❌, no ⚠. The compile prompts are English-skeleton-by-design (see `_shared/prompts/compile-prompts.ts`), and Gemini correctly preserves user-language content within that skeleton. **No chain-order reconsideration needed** based on these outputs.

**Llama-on-Llama quality is NOT validated by this PR.** The compile prompts have not been exercised through Cerebras or Groq with Spanish/Italian content yet, because Gemini is healthy and the fallback hasn't naturally triggered. Step 6.5's 24h monitoring will surface real-world fallback events; if any fall on non-English users we'll learn whether Llama keeps the bilingual rendering quality. If a quality regression appears, the chain order may need to flip Cerebras and Groq for the `lite` tier, or we add a per-language override.

### 6.5 — 24h dev monitoring
**Pending**, by definition. The Bucket 1 02:00 UTC cron has already run cleanly on `gemini-2.5-flash-lite` today (zero errors, see CHANGES.md `[COMPILE-BURST-1]`). The first cron run that exercises the *new* chain code is tomorrow 02:00 UTC. Re-run the Step 6.5 query then:
```sql
SELECT provider,
  COUNT(*) FILTER (WHERE status='success') AS successes,
  COUNT(*) FILTER (WHERE status='error') AS errors,
  ROUND(AVG(latency_ms)) AS avg_latency,
  SUM(cost_usd)::numeric(10,4) AS total_cost
FROM olive_llm_calls
WHERE function_name='olive-compile-memory'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider;
```

---

## Deviations from the prompt

1. **Step 6.3 method** — used a soft-test runner (`scripts/verify-chain-fallback.ts`) instead of mutating the prod `GEMINI_API` secret. Reason: there is no separate dev Supabase project (only `withOliveApp`), so invalidating the key would have broken every other Gemini-using function (ask-olive-stream, whatsapp-webhook, process-note, ...) for the test window. The soft-test exercises the production chain dispatcher + provider classes + tracker through a stubbed HTTP boundary — same code path that's deployed, no live-traffic impact. Captured with explicit user approval via AskUserQuestion.

2. **Step 6.4 pool size** — only 3 es-ES users (3 notes total) exist in prod, so the spec's "5 each" was infeasible. Compiled 3 es-ES + 3 it-IT (6 total). The result remains decisive (6/6 ✅).

3. **Step 7 SKILL.md / Section 18 / Section 21 updates** — `SKILL.md` is not a file in this repo. The skill content lives in the local Claude Code plugin directory (`~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/.../skills/olive/SKILL.md`). I did not modify it here because (a) it's outside repo version control and (b) it would not propagate to other developers' sessions. The skill text should be updated by whoever maintains the plugin distribution. Repo-side documentation (CLAUDE.md, .env.example, CHANGES.md) has been updated where applicable.

4. **Commit structure** — consolidated the prompt's "suggested" 7 commits into one cohesive commit per the repo's Section 17 format. Squash-merge to `main` would have collapsed them anyway; one commit keeps the dev branch history readable while preserving full traceability via CHANGES.md.

---

## Out-of-scope (untouched in this PR, captured here so they're not lost)

- Migration of `process-note`, `ask-olive`, `whatsapp-webhook`, etc. to `generateWithChain` — separate PRs after the 7-day soak.
- Cross-call circuit breaker (in-memory provider-health state).
- Multi-turn messages (`messages[]` array instead of single prompt string).
- Multimodal (images / voice) — only Gemini supports them natively; multimodal callers stay on `tracker.generate()` for now.
- Cost-aware routing (today's order is reliability-driven).
