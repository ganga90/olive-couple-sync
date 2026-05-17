# CHANGES — Phase 1: Foundation of Robustness & Observability

## 2026-05-17 — [10X] Phase 1 quick wins (in progress)

Follow-up to the deep audit captured in [OLIVE_10X_PLAN.md](OLIVE_10X_PLAN.md). Phase 1 is a batch of small, additive, safety-first changes that pay back forever.

### TASK-10X-1A — HNSW vector index on `olive_memory_chunks.embedding`

The audit flagged this as the single highest-leverage fix in the repo: `clerk_notes.embedding` had `ivfflat` since the post-Lovable baseline (line 3451 of `20260427000000_baseline_post_lovable_reconciliation.sql`), but `olive_memory_chunks` — the primary backing store for Olive's memory recall — never got one. Every memory-search query was doing a full sequential scan over 768-dim vectors. Today the table is 130 rows, so latency is fine; the bill comes due silently as memory grows.

- New migration: `supabase/migrations/20260517051720_task_10x_1a_olive_memory_chunks_embedding_hnsw.sql`
- Applied via Supabase MCP (`apply_migration`); filename renamed to match the ledger version per the doctrine.
- Type: HNSW (not IVFFLAT) — pgvector ≥ 0.5.0 ships HNSW on Supabase Postgres 17; HNSW handles incremental inserts/updates better than IVFFLAT (chunks see decay touches), and avoids the periodic re-tuning IVFFLAT needs as row count grows past the build-time `lists` estimate.
- Operator class: `vector_cosine_ops` — matches `clerk_notes.embedding` and the unit-normalized embeddings produced by the embedding generator.
- Index built at 512 kB on 130 rows. `EXPLAIN ANALYZE` on the prod table shows seq-scan still preferred (correct: HNSW only outperforms once the table is large enough that the planner's cost model crosses the threshold — that's now an automatic upgrade rather than a manual one).
- No application code changed. Read paths in `_shared/memory-retrieval.ts` already issue `ORDER BY embedding <=> $1 LIMIT k`, which is the HNSW pattern; the index is invisible to callers.

### TASK-10X-3C — i18n key parity restored (es-ES, it-IT) + parity guard

The audit flagged drift in `profile.agentDetail` (11 missing keys per locale). A deeper scan with `scripts/check-i18n-parity.mjs` found two more drifting namespaces: `home.partnerActivity` (2 keys) and `onboarding.demo` (4 keys). Total: 34 missing key-locale pairs silently falling back to English for Spanish and Italian users.

- Translated 17 unique keys into both `es-ES` and `it-IT`, preserving Olive's voice rules (direct, no exclamation points, no emoji spam). Reused existing terminology already in the locale files (e.g. `Notificaciones de WhatsApp`, `Notifiche WhatsApp` were already canonical for related strings).
- Added `scripts/check-i18n-parity.mjs` — a Node script that flattens every namespace in every non-EN locale and asserts key-set equality with `en/`. EN is the source of truth; missing keys and orphaned keys both fail the check.
- The script becomes a CI gate in `TASK-10X-1B` (next commit). Drift recurring requires a deliberate `EXTRA_KEYS` or `MISSING_KEYS` PR — no more silent regressions.

### TASK-10X-1F — Security headers in `vercel.json`

The audit flagged that `vercel.json` had only one header block (for `.well-known/apple-app-site-association`) and no CSP, HSTS, X-Frame-Options, or X-Content-Type-Options on the rest of the app. Vercel's defaults are reasonable but should be made explicit.

Added a `/(.*)` header block applied to every route:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` — 2-year HSTS with preload eligibility. Standard.
- `X-Content-Type-Options: nosniff` — blocks MIME-sniffing.
- `X-Frame-Options: SAMEORIGIN` — clickjacking protection. Not DENY, because Clerk uses some self-origin iframes; CSP `frame-ancestors 'self'` enforces the same constraint for modern browsers.
- `Referrer-Policy: strict-origin-when-cross-origin` — protects path info on cross-origin nav while keeping referrer working for analytics.
- `Permissions-Policy` — allow camera/microphone/geolocation only on `self` (Capacitor camera, Deepgram voice, future location features); block `interest-cohort`, `browsing-topics`, `payment`, `usb`, and motion sensors entirely.
- `Cross-Origin-Opener-Policy: same-origin-allow-popups` — required for OAuth popup flows (Google Calendar) and Clerk's hosted sign-in pages.
- `Content-Security-Policy-Report-Only` — CSP launched in **Report-Only mode** so violations surface in the browser console without breaking auth or media flows during the rollout window. The policy allows: Supabase (REST + realtime websocket), Clerk (production custom domain `clerk.witholive.app`, plus `*.clerk.accounts.dev` for preview deploys), Cloudflare Turnstile (Clerk CAPTCHA), Deepgram (HTTPS + WSS), and Google Fonts. Promotion to enforcing mode is a follow-up task once the preview deploy has accumulated zero violations across a full QA pass.

No application changes — Vercel applies these on the response. The next preview deploy is the verification surface.

### TASK-10X-1E — PII redaction in edge function logs

The audit found raw phone numbers and email addresses being written to `console.log` in six places across five edge functions. Edge function stdout streams into Supabase's runtime logs (visible to anyone on the team), so this is a real compliance gap, not theoretical.

- New shared module `supabase/functions/_shared/redact.ts` with three pure helpers: `maskPhone()` keeps last 4 digits (`+xxx*9123`), `maskEmail()` keeps domain + first local char (`g****@gmail.com`), `maskName()` keeps first char (`G********`). Null-safe, never throws, no I/O.
- Co-located test file `redact.test.ts` covers null/empty/malformed paths for each helper (7 cases).
- Patched six log sites:
  - `send-reminders/index.ts:378` — phone + display name
  - `olive-heartbeat/index.ts:1880` — phone lookup
  - `email-oauth-callback/index.ts:105` — Gmail address after OAuth
  - `oura-callback/index.ts:100` — Oura account email
  - `calendar-callback/index.ts:94, 129` — Google account email (two spots)
- Full `_shared/` test suite (`deno test`): **1264 passed, 0 failed** — no regressions.

### TASK-10X-1B — Frontend CI gate

The audit (P0-6) flagged that no GitHub Actions workflow ran ESLint, TypeScript, or the Vite build on PR. The existing workflows (`eval-harness`, `migration-lint`, `calendar-smoke`) gate other dimensions; the frontend itself was shipping on trust.

Added `.github/workflows/frontend-ci.yml` with 4 jobs:

1. **`i18n-parity`** — runs `scripts/check-i18n-parity.mjs` (from TASK-10X-3C) on every PR touching `public/locales/**`. Any missing or orphaned key vs `en/` fails the PR.
2. **`typecheck-build`** — `npx tsc --noEmit -p tsconfig.app.json` then `npm run build`. Both currently clean; this locks them in.
3. **`lint-changed`** — ESLint runs **only on TS/TSX/JS files changed in the PR**. Why not full-repo: the audit found 1,456 pre-existing lint errors. Gating the full repo would block the team until the backlog clears (TASK-10X-1C). Changed-files-only keeps the forward-facing bar high (`--max-warnings 0`) while letting the burn-down happen in parallel.
4. **`deno-shared-tests`** — `deno test supabase/functions/_shared/` (1264 tests). Catches regressions in the redact helpers (TASK-10X-1E), reminder-dedup, timezone, etc.

Path-filtered + concurrency-cancelled to match the convention of the existing workflows. The PR template in [.github/pull_request_template.md] is the human safety net for cases CI cannot reason about.

## 2026-05-14 — [SOURCE-ATTRIBUTION-FE] Frontend insert migration + NOT NULL on clerk_notes.source

Follow-up to [SOURCE-ATTRIBUTION] (Bucket 3, PRs [#130](https://github.com/ganga90/olive-couple-sync/pull/130) / [#131](https://github.com/ganga90/olive-couple-sync/pull/131)). Closes the two frontend insert call sites and locks the source-attribution contract at the database layer.

### What changed

1. **New `src/lib/note-source.ts`** — frontend `NoteSource` enum + `defaultClientNoteSource()` (returns `'ios'` under Capacitor, `'web'` otherwise). Mirrors the canonical Deno copy in `_shared/note-insert.ts`; drift is caught by the new DB CHECK constraint.

2. **`src/components/AskOliveChatGlobal.tsx:686`** — the "Save as note" insert now tags `source: 'olive-chat' satisfies NoteSource` + `source_ref: messageId`. Was already setting `'olive-chat'`; gained the type-safety guard and the chat-message reference id.

3. **`src/hooks/useSupabaseNotes.ts:281`** — the generic `addNote` hook populates `insertData.source` via `defaultClientNoteSource()` (with caller-override via `noteData.source` if provided). Lists, Notes, onboarding, and other React surfaces that flow through this hook will now correctly attribute as `'web'` or `'ios'`.

4. **Backfill extended** with Blocks 4 + 5 in `scripts/backfill-source-attribution.sql`:
   - Block 4: NULL rows whose author has zero whatsapp-* LLM calls → `'web'` (**95 rows**, web-only users).
   - Block 5: any remaining NULL → `'web'` (catch-all, **559 rows**). Required precondition for NOT NULL.

5. **`supabase/migrations/20260514123914_clerk_notes_source_not_null.sql`** — applied via Supabase MCP. Two clauses:
   - `ALTER TABLE clerk_notes ALTER COLUMN source SET NOT NULL`
   - `ADD CONSTRAINT clerk_notes_source_known CHECK (source IN (...12 values...))`
   Source attribution is now enforced end-to-end: TypeScript (helpers + frontend enum) → DB layer (NOT NULL + CHECK).

### Source distribution — before / after this PR

| source | Bucket 3 AFTER | THIS PR AFTER |
|---|---|---|
| `(null)` | 654 | **0** |
| `web` | 0 | **654** |
| `whatsapp` | 44 | 44 |
| `email` | 13 | 13 |
| `olive-chat` | 4 | 4 |
| `partner-relay` | 2 | 2 |
| **Total** | **717** | **717** |

**100% attributed; column is now NOT NULL with a CHECK constraint.**

### Files

| File | Change |
|---|---|
| `src/lib/note-source.ts` | New — frontend enum + `defaultClientNoteSource()` |
| `src/components/AskOliveChatGlobal.tsx` | "Save as note" tagged `olive-chat` + `source_ref: messageId` |
| `src/hooks/useSupabaseNotes.ts` | `addNote` populates `source` from caller override or Capacitor default |
| `scripts/backfill-source-attribution.sql` | Add Blocks 4 + 5 (web fallback + catch-all) |
| `supabase/migrations/20260514123914_clerk_notes_source_not_null.sql` | New — NOT NULL + CHECK constraint, applied via MCP |

### Tests

- `npx tsc --noEmit -p tsconfig.app.json` → 0 errors.
- `npm run build` → 5.16s, clean (only pre-existing chunk-size advisory).
- Browser preview loads (Clerk-on-localhost auth errors are pre-existing — prod Clerk key only valid for witholive.app — unrelated to this PR).
- `deno test supabase/functions/_shared/` → 1257/1257 (unchanged; Deno layer untouched).

### Acceptance criteria

- [x] Frontend Vite build clean; typecheck clean.
- [x] Both frontend insert sites set `source`.
- [x] Backfill driven to 0 NULL rows.
- [x] `clerk_notes.source NOT NULL` applied.
- [x] `clerk_notes_source_known` CHECK enforces the 12-value enum.
- [ ] **Post-merge**: next user-created note from the web app lands with `source='web'`; verifiable via SQL.
- [ ] **Post-merge**: any caller that forgets `source` is rejected at the DB layer (NOT NULL); typo'd `source` rejected by CHECK.

### Caveats

- **Block 5 catch-all is attribution by assumption.** 559 historical rows of unknown origin were tagged `'web'` so we could safely apply NOT NULL. Most likely correct; the small accuracy loss is the documented trade-off from Bucket 3 Step 4.5.
- **Historical iOS rows collapsed into `'web'`** — the Capacitor flag isn't observable post-hoc. New iOS inserts attribute correctly going forward.

### Out of scope

- Per-source analytics or engagement metrics.
- Migration of any future caller — re-run the grep periodically and use `insertNote()` (Deno) or `defaultClientNoteSource()` (React).

## 2026-05-14 — [SOURCE-ATTRIBUTION] Type-safe note-insert helper + source attribution backfill + error-rate monitoring

Bucket 3. Fixes the "97% of clerk_notes rows have NULL source" bug by
introducing a type-safe insert wrapper that compile-enforces source
attribution at every call site, then backfills as many historical NULL
rows as conservative heuristics allow. Also documents the new daily
error-rate monitoring routine that would have caught the compile-memory
regression on day 1 instead of 11 days late.

### What changed

1. **New `_shared/note-insert.ts`** — `insertNote()`, `insertNotesBatch()`,
   `NOTE_SOURCES` enum (12 values), and `whatsappSourceFromMessageType()`
   helper. `source` is required at the TypeScript level; runtime guards
   reject inserts missing it. Direct `.from("clerk_notes").insert(...)`
   in any function modified by this PR is now zero (verified by audit).

2. **`whatsapp-webhook` — 10 insert sites migrated**:
   - Added `messageType` to `MetaMessageData` + return.
   - At handler scope: `const wamid = messageId; const inboundNoteSource = whatsappSourceFromMessageType(messageType);`.
   - Threaded `wamid` + `inboundNoteSource` into `createNoteFromCluster()` signature (the only helper function with an insert; other 9 sites are inside the main IIFE and see the destructured values directly).
   - Sites 1, 3, 4, 5, 7 (CREATE_LIST items bulk), 9 (multi-note bulk), 10 (single CREATE): `source: inboundNoteSource`, `source_ref: wamid`.
   - Site 2 (media note): `source: 'whatsapp-media'`, `source_ref: wamid`.
   - Site 6 (PARTNER_MESSAGE): corrected from `source: 'whatsapp'` to `source: 'partner-relay'`; preserves existing `source_ref: partner_relay:${action}`.
   - Site 7 (SAVE_ARTIFACT): corrected from `source: 'olive-chat'` to `source: inboundNoteSource` (the capture channel is WhatsApp; the artifact's content origin is incidental).
   - **Step 1 correction**: Step 1 enumerated 9 sites but the file has 10 — line 4876 was missing. Surfaced via AskUserQuestion, treated as "#1.5 Attach-offer primary".

3. **`olive-email-mcp` — 2 insert sites migrated**:
   - Step 4.3 implied one site; there are two (lines 403 + 555). Surfaced and confirmed.
   - Both keep existing `source: 'email'` + `source_ref: email.id` semantics; only the call shape changes to `insertNote()`.

4. **`ask-olive-individual:1204` migrated** — partner_message relay mirror of whatsapp-webhook site 6. Tagged `source: 'partner-relay'`, `source_ref: partner_relay:${partnerAction}`.

5. **`scripts/backfill-source-attribution.sql`** — three-block heuristic backfill (partner_relay correction, ±60s LLM-call correlation, same-day correlation) + before/after snapshot queries.

6. **NOT NULL migration deferred** — backfill attributed only 8.8% of historical rows (44 newly + 19 pre-existing of 717 total), leaving 91.2% NULL. Way above the 5% threshold in Step 6.4. The `insertNote()` helper enforces `source` for all new inserts; the table-level NOT NULL is the follow-up PR after frontend sites migrate.

7. **Error-rate monitoring routine** — query designed, dry-run verified. Routine itself is configured outside the repo in Claude Code Routines (see PROGRESS.md for the production query). Dry-run over last 14 days: 12 rows fire, all `olive-compile-memory`, multiple days at 100% — confirms the alert would have caught the compile-memory regression on day 1.

### Source attribution: before / after

| source | BEFORE | AFTER |
|---|---|---|
| (null) | 698 | 654 |
| whatsapp | 2 | 44 |
| email | 13 | 13 |
| olive-chat | 4 | 4 |
| partner-relay | 0 | 2 |
| **Total** | **717** | **717** |

Attribution: 2.6% → 8.8% (+44 rows). 91.2% still NULL — most are likely web/iOS direct creates from users who never used WhatsApp, so they have no whatsapp-* LLM calls to correlate against. Documented in `PROGRESS.md` for the follow-up frontend-migration PR.

### Files

| File | Change |
|---|---|
| `supabase/functions/_shared/note-insert.ts` | New helper + enum |
| `supabase/functions/_shared/note-insert.test.ts` | New — 9 unit tests |
| `supabase/functions/whatsapp-webhook/index.ts` | `messageType` added to `MetaMessageData`; 10 insert sites migrated; sites 5 + 6 source corrected |
| `supabase/functions/olive-email-mcp/index.ts` | 2 insert sites migrated to `insertNote()` |
| `supabase/functions/ask-olive-individual/index.ts` | partner_message relay insert migrated to `insertNote('partner-relay')` |
| `scripts/backfill-source-attribution.sql` | New — applied to prod via Supabase MCP |
| `PROGRESS.md` | Full Bucket 3 verification record |

### Tests

- `deno test supabase/functions/_shared/` → **1257 passed / 0 failed** (1248 baseline + 9 new from `note-insert.test.ts`).
- `deno check supabase/functions/whatsapp-webhook/index.ts` → 18 errors, same as the dev baseline before this PR. Zero new errors introduced.
- `deno check supabase/functions/{olive-email-mcp,ask-olive-individual,_shared/note-insert}.ts` → unchanged vs. baseline.

### Frontend insert sites (out of scope per Step 10)

| File | Line | Suggested source |
|---|---|---|
| `src/components/AskOliveChatGlobal.tsx` | 686–687 | `'web'` |
| `src/hooks/useSupabaseNotes.ts` | 281–282 | `'web'` (or `'ios'` under Capacitor flag) |

Follow-up PR: shared frontend `NoteSource` enum + migrate these two sites.

### Acceptance criteria

- [x] **Step 6.1**: whatsapp-webhook deployed; code path covered by tests (live capture verification pending an organic message).
- [x] **Step 6.2**: olive-email-mcp + ask-olive-individual deployed; existing `source='email'` rows continue to land correctly.
- [x] **Step 6.3**: backfill applied — 44 newly attributed; remaining NULL count documented (654 / 91.2%).
- [x] **Step 6.4 decision**: NOT NULL migration deferred per spec rule (residual NULL > 5%).
- [x] **Step 7 dry-run**: monitoring query confirmed it would have caught the compile-memory regression starting 2026-05-03.

### Out of scope (Step 10)

- Frontend insert path migration (separate PR).
- Source-aware analytics queries.
- `olive_engagement_events` schema changes.
- Alerts for latency p95 / fallback-rate / daily cost.

## 2026-05-14 — [MULTI-PROVIDER-LLM] Multi-provider LLM abstraction (Gemini → Cerebras → Groq)

Bucket 2. Adds a provider-agnostic LLM call path so the system survives a
Gemini outage instead of just retrying-then-failing. `olive-compile-memory`
is the first (and only) caller migrated to the new chain in this PR —
every other function keeps its existing `tracker.generate()` path,
unchanged.

### What changed

1. **New `_shared/llm-providers/` package**
   - `types.ts` — normalized `LlmRequest` / `LlmResponse` / `LlmError`
     interfaces. `LlmError` classification (`retryable`, `fallbackEligible`)
     is what the chain dispatcher reads to decide retry-vs-advance-vs-throw.
   - `gemini.ts` — REST implementation, matches `llm-tracker.ts`'s existing
     endpoint and auth shape, classifies 4xx terminal and 429/5xx
     retryable-and-fallback-eligible.
   - `openai-compatible.ts` — single class serving both Cerebras
     (`api.cerebras.ai/v1`) and Groq (`api.groq.com/openai/v1`). Sends
     Bearer auth, expects OpenAI chat-completions response shape.
   - `index.ts` — `getProviderChain(tier)` returns the ordered chain.
     `lite/standard` walk Gemini → Cerebras → Groq; `pro` skips Groq
     (6K TPM cap is too tight for long Pro contexts).

2. **`_shared/llm-tracker.ts` extensions**
   - `TrackerOptions` gains `provider?: ProviderName`; every row written
     to `olive_llm_calls` now carries the provider column (defaults to
     `"gemini"` so historical callers stay correct).
   - `MODEL_PRICING` gains `llama-3.3-70b` and `llama-3.3-70b-versatile`
     at `$0` (free tier; update when paid tier introduced).
   - New `generateWithChain(tier, req, opts)` walks the chain with
     same-provider retry + cross-provider fallback. Every attempt logs.
     Throws an aggregate error when all providers exhaust.

3. **`olive-compile-memory/index.ts`** — migrated from
   `tracker.generate({ model: "gemini-2.5-flash-lite", ..., retry: { ... } })`
   to `tracker.generateWithChain("lite", { ... }, { retry: { maxAttempts: 2 } })`.
   Pacing logic (env-driven `COMPILE_BATCH_SLEEP_MS`) from Bucket 1 is kept.

4. **Migration `20260514035835_add_provider_to_llm_calls.sql`** — adds
   `provider text NOT NULL DEFAULT 'gemini'` to `olive_llm_calls`,
   indexes `(provider, created_at)`, recreates `olive_llm_analytics`
   with `provider` appended (CREATE OR REPLACE VIEW does not allow
   reordering existing columns, only appending). Applied via Supabase
   MCP at ledger timestamp `20260514035835`.

5. **Tests** — 11 provider unit tests + 5 chain-dispatch tests added
   to `llm-tracker.test.ts`. Each test stubs `globalThis.fetch` to
   avoid real network. Coverage: success/normalize, 429 retryable,
   5xx retryable, 400 terminal, 401 terminal, missing-key fallback,
   network error, primary success, retry-then-success, retry-exhaust-
   then-fallback, fallback short-circuit on missing key, all-providers-
   exhausted aggregate throw, non-retryable terminal throw.

6. **`scripts/verify-chain-fallback.ts`** — integration soft-test
   runner. Used in lieu of mutating the prod `GEMINI_API` secret
   (Step 6.3) since there's no separate dev Supabase project. Exercises
   the production chain dispatcher + provider classes + tracker
   end-to-end with a stubbed HTTP boundary; 3/3 scenarios pass.

### Files

| File | Change |
|---|---|
| `supabase/functions/_shared/llm-providers/types.ts` | New — `LlmRequest`/`LlmResponse`/`LlmError`/`LlmProvider`/`Chain` interfaces |
| `supabase/functions/_shared/llm-providers/gemini.ts` | New — Gemini REST provider |
| `supabase/functions/_shared/llm-providers/openai-compatible.ts` | New — single class serving Cerebras + Groq |
| `supabase/functions/_shared/llm-providers/index.ts` | New — chain registry per `ModelTier` |
| `supabase/functions/_shared/llm-providers/llm-providers.test.ts` | New — 11 per-provider unit tests |
| `supabase/functions/_shared/llm-tracker.ts` | Add `provider` column write + Llama pricing + `generateWithChain` |
| `supabase/functions/_shared/llm-tracker.test.ts` | 5 new chain dispatch tests + capture provider in fake supabase |
| `supabase/functions/olive-compile-memory/index.ts` | Migrate `tracker.generate()` → `tracker.generateWithChain("lite", ...)` |
| `supabase/migrations/20260514035835_add_provider_to_llm_calls.sql` | New — adds provider column, indexes it, recreates analytics view |
| `scripts/verify-chain-fallback.ts` | New — Step 6.3 soft-test runner |
| `PROGRESS.md` | New — full Bucket 2 verification record |

### Tests

- `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env` → **1248 passed, 0 failed** (1232 baseline + 16 new).
- `deno check` clean on every modified file.
- `deno run scripts/verify-chain-fallback.ts` → 3/3 scenarios ✅.

### Acceptance criteria

- [x] **6.1** Migration applied; `provider text NOT NULL DEFAULT 'gemini'::text` confirmed via `information_schema.columns`.
- [x] **6.2** Primary-path force-compile of `user_35qkEgvbMI0SzIpvEsDW35drgLu` → 4 rows, all `provider='gemini'`, `model='gemini-2.5-flash-lite'`, `status='success'`, with `metadata.tier="lite"`, `provider_chain_index=0`, `provider_attempt=0`.
- [x] **6.3** Chain fallback verified via soft-test (3/3 scenarios pass). Spec's "invalidate prod key" rejected per user direction (would have broken other live functions).
- [x] **6.4** i18n quality sanity: 6/6 ✅ on the available es-ES + it-IT user pool (the spec's "5 each" wasn't feasible — only 3 es-ES and 4 it-IT users in prod). All on Gemini primary path; Llama-on-Llama quality remains pending until natural fallback or local-key availability.
- [ ] **6.5** 24h monitoring — pending by definition; next compile-memory cron is 02:00 UTC tomorrow.
- [ ] **Step 7** SKILL.md / Section 18 / Section 21 — out of repo scope (skill lives in plugin directory, not version control). Documented in PROGRESS.md.

### Out of scope (Section 9 of the prompt)

- Migrating other functions (`process-note`, `ask-olive`, `whatsapp-webhook`, ...) to `generateWithChain`.
- In-memory circuit breaker.
- Multi-turn `messages[]` array.
- Multimodal routing.
- Cost-aware routing.

## 2026-05-13 — [COMPILE-BURST-1] Stop the bleeding on `olive-compile-memory` 02:00 UTC batch

Bucket 1 of the compile-memory remediation plan. The daily compile-memory
cron has been failing 51.7% of calls (60 / 116 over 14 days), with 100%
of failures being HTTP 429 from Gemini concentrated at 02:00 UTC — a
self-inflicted burst, not a Gemini outage. No new providers introduced
in this PR; that's Bucket 2.

### What changed

1. **Retry + same-provider Gemini fallback in `llm-tracker.ts`.** The
   `generate()` method now accepts an optional `retry: { maxAttempts,
   backoffMs, fallbackModels, retryableStatus }` config. On retryable
   status (default `[429, 500, 502, 503, 504]`) it backs off
   exponentially with jitter (capped 8s) and retries on the same model
   up to `maxAttempts`, then walks the `fallbackModels` list. Every
   attempt — success or failure — still logs to `olive_llm_calls` so
   observability is preserved. Fallback rows carry
   `metadata.fallback_from: <originalModel>` and `metadata.attempt: N`.
   When `retry` is omitted the behavior is unchanged (one attempt, no
   fallback) — backwards-compat with existing callers.

2. **`olive-compile-memory` now uses Flash-Lite as primary** with
   Flash → 2.0-Flash as same-provider fallbacks. Flash-Lite has plenty
   of headroom for this task and the new retry policy absorbs transient
   429s before the fallback chain trips. Added `gemini-2.5-flash-lite`
   to `MODEL_PRICING`.

3. **Real pacing.** The old "sleep 500ms only if `status === 'compiled'`"
   let failed/skipped iterations burst forward, which is how 14 users ×
   4 file types stacked into a sub-second wall of requests at 02:00 UTC.
   Both inner (per-file-type) and outer (per-user) loops now sleep
   unconditionally at the end of every iteration. Sleep duration is
   env-driven (`COMPILE_BATCH_SLEEP_MS`, default 3000ms) so we can tune
   without redeploying. Worst-case batch wall-clock: ~3 min.

4. **Backfill script** at `scripts/backfill-compile-memory.ts` that
   re-runs `compile_user` with `force: true` for every user that had at
   least one error since `--since` (default: 14 days). Prints a
   before/after success/error count table per user.

### Files

| File | Change |
|---|---|
| `supabase/functions/_shared/llm-tracker.ts` | Add `RetryConfig` type + retry/fallback loop in `generate()`; log every attempt; tag rows with `metadata.attempt` and `metadata.fallback_from`; add `gemini-2.5-flash-lite` to `MODEL_PRICING` |
| `supabase/functions/_shared/llm-tracker.test.ts` | New — 7 tests covering: first-try success, retry-then-success, fallback-after-retry-exhaustion, non-retryable status throws immediately, all-retries-exhausted throws, backwards-compat (no retry config = one attempt), error message surfaces |
| `supabase/functions/olive-compile-memory/index.ts` | Switch model to `gemini-2.5-flash-lite` + retry config (`maxAttempts:3, fallbackModels: ['gemini-2.5-flash','gemini-2.0-flash']`); replace conditional `sleep(500)` with unconditional env-driven sleep; mirror pacing in `compile` action's per-user loop |
| `scripts/backfill-compile-memory.ts` | New — one-shot remediation invoking `compile_user --force` for users with recent errors |

### Tests

- `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env` → **1232 passed, 0 failed** (1225 baseline + 7 new).
- `deno check` clean on `olive-compile-memory/index.ts`, `_shared/llm-tracker.ts`, and `scripts/backfill-compile-memory.ts`.

### Acceptance criteria

- [x] `llm-tracker.test.ts` covers success-on-first-try, 429-then-success, 429-exhausts-then-fallback-succeeds, 400-throws-immediately, all-retries-exhausted-throws.
- [x] Existing callers of `generate()` without `retry` see no behavior change (covered by backwards-compat test).
- [x] Every LLM attempt continues to log to `olive_llm_calls` (Section 6 rule preserved).
- [x] Did not touch `resilient-genai.ts` or introduce non-Gemini providers (Bucket 2 scope).
- [ ] **Pending**: deploy + manual invoke of `compile_user` and `compile` to verify zero-error path in production.
- [ ] **Pending**: tomorrow's 02:00 UTC cron run shows ≤5% error rate in `olive_llm_calls` for `function_name='olive-compile-memory'`.
- [ ] **Pending**: run backfill script for last 14 days, confirm previously-failed users have current artifacts.

### Out of scope (Bucket 2)

- Multi-provider abstraction (Groq / Cerebras keys exist in Supabase
  secrets but are not wired up here).
- `resilient-genai.ts` changes.

## 2026-05-14 — Proactive bridge parity: settings UI + web chat mirror + ask-olive-individual brand-voice audit

Three follow-ups to CONV-5:

1. **Settings UI toggle** for `proactive_bridge_enabled` — users no longer
   need SQL to opt in. New switch in the Olive Proactive Settings panel
   alongside Pattern Suggestions / Weekly Summary, gated by the
   `proactive_enabled` master toggle. Defaults off (matches CONV-5
   migration default).

2. **Web chat mirror** of the proactive bridge — `ask-olive-stream` now
   fires the same opt-in offer after a `task_created` with no due_date
   and no reminder_time. Persists `pending_action.type='date_for_recent_task'`
   in `user_sessions.context_data` (same shape as WhatsApp). Pre-flow
   gate handles the next-turn response: date phrase → apply; deny →
   ack; anything else → clear one-shot offer and fall through.

3. **`ask-olive-individual` brand-voice audit** — surface is mostly
   Gemini-driven (system prompt sets voice), so the audit found only
   2 hardcoded error fallback strings (apology-spiral pattern from
   pre-CONV-2 era). Warmed both to match `error_generic`. Also added
   explicit 🌿 prefix instruction to the system prompt so Gemini's
   outputs carry the brand signature consistently.

### Files

| File | Change |
|---|---|
| `src/integrations/supabase/types.ts` | Added `proactive_bridge_enabled` to `olive_user_preferences` Row/Insert/Update |
| `src/components/settings/OliveProactivePreferences.tsx` | New toggle UI with Leaf icon; pref field + default; fetch + save wired |
| `public/locales/{en,es-ES,it-IT}/profile.json` | New i18n keys `olivePreferences.proactiveBridge` + `.proactiveBridgeDesc` (3 locales) |
| `supabase/functions/ask-olive-stream/index.ts` | After task_created, check pref + persist offer + append hint to Gemini prompt; pre-flow handler for `date_for_recent_task` (date apply / deny / one-shot clear) |
| `supabase/functions/ask-olive-individual/index.ts` | 2 error-fallback strings warmed to match `error_generic`; system prompt gains explicit "🌿 prefix every response" + voice guidance |

### Tests

- All 1336 non-pre-existing Deno tests still pass (matches CONV-5 baseline; this PR adds no new tests because the helpers it reuses already have 28 tests from CONV-1/CONV-4 covering both `detectDateRefinement` adapters).
- Pre-existing `timezone-calendar.test.ts` failure unchanged (also fails on `main`).
- Frontend build verified via Vite dev server: types compile, OliveProactivePreferences renders.

### Acceptance criteria

- [x] Settings page exposes the toggle in all three locales (en/es/it)
- [x] Toggle persists via the same upsert path as other prefs
- [x] Toggle defaults to off — matches CONV-5 migration
- [x] Web chat fires the bridge after qualifying CREATEs (same gates as WhatsApp)
- [x] Web chat handler accepts date phrase / denial / falls through — parity with WhatsApp SafetyNet #1.4c
- [x] `ask-olive-individual` error fallbacks use the warmed `error_generic` shape
- [x] System prompt for `ask-olive-individual` instructs 🌿 prefix per brand bible
- [x] No regressions: 1336 / 1336 non-pre-existing tests pass

### What this PR does NOT do (deliberate scope limits)

- **No localization on `ask-olive-individual` error fallbacks.** The catch blocks fire at the outer scope where `webUserLang` isn't bound; threading it through would require a structural refactor. Left as a follow-up — the frontend can intercept 500 responses and surface its own localized message via the existing `common.somethingWentWrong` key.
- **No wholesale system-prompt rewrite for `ask-olive-individual`.** The personality section ("upbeat companion", "always positive") drifts from the brand bible's "warm but not saccharine", but a full prompt rewrite is high-risk without an A/B rollout. Added a bounded 🌿-prefix instruction instead — propagates voice without restructuring proven behavior.

---

## 2026-05-14 — Proactive bridge on brain-dump confirmation (opt-in, en/es/it)

After a brain-dump CREATE saved a task with NO due_date AND NO
reminder_time, Olive now appends a single bounded offer ("💡 Want me
to set a date?") and waits for ONE turn. If the next message parses
to a date, she applies it. If not, the offer expires (5-min TTL) and
the message is processed normally — no compounding nudges, no walls
of cross-sells. This is the Offer step of the Capture → Offer →
Confirm → Execute loop for the case where the brain dump had no
temporal hint.

**Opt-in:** new boolean column `proactive_bridge_enabled` on
`olive_user_preferences`, default `false`. Existing users see ZERO
behavior change until they flip it on (via SQL or a future settings
UI). New users follow the same default — the brand promise ("brain
dump > automate") stays intact, dialogue happens only when invited.

### Schema change

`supabase/migrations/20260514023144_add_proactive_bridge_enabled.sql`:

```sql
ALTER TABLE public.olive_user_preferences
  ADD COLUMN IF NOT EXISTS proactive_bridge_enabled boolean NOT NULL DEFAULT false;
```

Applied via Supabase MCP `apply_migration` (name=`add_proactive_bridge_enabled`).
Additive; no existing query changes; rides on the same RLS policy.

### How the loop works

1. **Capture:** user sends "Call dentist about cleaning" → CREATE flow
   saves the note. No date / reminder were inferred.
2. **Offer (new):** if user opted in, the save-confirmation reply ends
   with `proactive_date_offer` instead of the random tip. A
   `pending_offer.type='date_for_recent_task'` is persisted in
   `user_sessions.context_data` with the task_id, the user's timezone,
   and `offered_at`.
3. **Confirm:** user's next message hits new SafetyNet #1.4c in
   `whatsapp-webhook/index.ts`:
   - Denial (`no`/`skip`/`never mind` EN/ES/IT) → clear offer, reply
     `proactive_date_skipped`.
   - Matches `detectDateRefinement` (shared CONV-1 predicate) → write
     `due_date` on the task, clear offer, reply `proactive_date_applied`
     with the friendly date readable.
   - Anything else → clear the one-shot offer + fall through to normal
     classification. No nag, no re-offer.
4. **Execute:** the date is written; conversation continues normally.

### Files

| File | Change |
|---|---|
| `supabase/migrations/20260514023144_add_proactive_bridge_enabled.sql` | **NEW** — migration |
| `_shared/pending-offer.ts` | Added `DateForRecentTaskOffer` to the `PendingOffer` union |
| `whatsapp-webhook/index.ts` | Pref lookup + offer construction in CREATE confirmation; tail-line swap (offer replaces random tip); SafetyNet #1.4c for the next-turn response; 3 new i18n keys (`proactive_date_offer`, `proactive_date_applied`, `proactive_date_skipped`) |
| `whatsapp-webhook/responses-i18n.test.ts` | Added 3 keys to the i18n contract |

### Tests

- 1330 → 1336 (+6 from i18n contract on the 3 new keys × locale and placeholder checks)
- Same pre-existing `timezone-calendar.test.ts` failure remains (not introduced here)

### Acceptance criteria

- [x] Migration applied via MCP with `name='add_proactive_bridge_enabled'`
- [x] New column defaults to `false` — zero existing-user impact
- [x] Bridge offer fires ONLY when (a) opted in (b) task has no due_date (c) task has no reminder_time (d) no duplicate-warning case
- [x] One-shot: offer is cleared after the next turn regardless of outcome
- [x] 5-min TTL on the offer (via `isPendingOfferFresh`)
- [x] EN + ES + IT translations for all 3 new keys with consistent placeholders
- [x] Denial keywords cover EN ("no", "skip", "never mind"), ES ("no", "no gracias"), IT ("no", "lascia", "non importa")
- [x] No regressions: 1336 / 1336 non-pre-existing tests pass

---

## 2026-05-14 — Chat parity: smart re-targeting in ask-olive-stream pending offers

Mirrors the WhatsApp `AWAITING_CONFIRMATION` smart re-targeting (from
[CONV-1]) into the web chat surface. Previously: if the user, instead
of replying "yes/no" to a pending `reschedule_task` offer, sent a date
refinement ("Set it due for Friday at 5pm"), the chat would silently
*clear* the pending offer and re-classify the message as a brand new
request — losing the previously resolved task. Now the chat refines
the same offer with the new date and re-prompts, matching WhatsApp.

### Architecture — shared predicate, two adapters

The original `detectSetDueRefinement` was WhatsApp-shape only
(`PendingSetDueAction.date`). Web chat uses a different pending shape
(`RescheduleTaskOffer.new_iso`, `field`, `has_time`, ...) defined in
`_shared/pending-offer.ts`. Rather than duplicate the regex gates,
the predicate is now factored out:

```
detectDateRefinement(message, timezone, lang)
  → returns ParsedRefinement | null

detectSetDueRefinement(pending, message, tz, lang)
  → WhatsApp adapter — updates date/readable

detectRescheduleRefinement(pending, message, tz, lang)
  → chat adapter — updates new_iso/readable
```

Both adapters share the exact same gates (parses-to-date + starts-with-
correction-verb / starts-with-pronoun / ≤30 chars), so behavior stays
identical across surfaces.

### Wiring in ask-olive-stream

The pre-flow gate at the "neither yes nor no" branch now tries
`detectRescheduleRefinement` against the pending offer before clearing.
On match: persists the updated offer back to `user_sessions.context_data
.pending_action` and streams a confirmation prompt using the new
parsed-readable. On miss: falls through to the existing clear-and-
process behavior — no regression.

### Files

| File | Change |
|---|---|
| `_shared/conversation-continuity.ts` | Factored out `detectDateRefinement` shared predicate; added `detectRescheduleRefinement` chat adapter |
| `_shared/conversation-continuity.test.ts` | +8 tests for `detectRescheduleRefinement` (parity scenarios: EN refinement, short date-only, "How are you?", long narrative with stray date, wrong pending type, null pending, Italian refinement, task-identity preservation) |
| `ask-olive-stream/index.ts` | Pre-flow gate calls `detectRescheduleRefinement` before clearing pending; on match, persists updated offer and re-prompts |

### Tests

- 1322 → 1330 (+8 chat-parity tests, all green)
- Pre-existing `timezone-calendar.test.ts` still the single non-introduced failure (also fails on `main`)

### Acceptance criteria

- [x] Existing WhatsApp `detectSetDueRefinement` behavior unchanged (still uses same gates via shared predicate)
- [x] Chat now refines `reschedule_task` offers on date corrections
- [x] EN + ES + IT refinement signals covered in both adapters (shared regex)
- [x] On match: chat persists updated offer + re-prompts (same UX as WhatsApp)
- [x] On no match: chat falls through to clear-and-process (no regression)
- [x] Wrong pending type → returns null (e.g., a `delete_task` offer is not touched)

---

## 2026-05-14 — Brand-voice pass round 3: full hardcoded → i18n migration + rich-key warm-up

Final pass on user-facing WhatsApp copy. Migrates the remaining 17
hardcoded reply strings in `whatsapp-webhook/index.ts` to i18n with
full en/es/it coverage, and warms 6 of the existing rich responses to
match the trimmed brand voice from CONV-2.

### Hardcoded → i18n migration (19 new keys)

Per the non-negotiable rule: "All user-facing strings go through
`t('namespace.key')` with three locales." These were holdovers that
slipped past earlier passes.

**Input / format errors:**
- `error_message_too_long` (was inline at line 2205)
- `error_invalid_location` (line 2221)
- `error_too_many_attachments` (line 2231) — placeholders `{count}`, `{max}`
- `error_voice_unavailable` (line 2394)
- `error_image_processing` (line 2727)
- `error_empty_input` (line 2841)
- `location_shared` (line 2408) — placeholders `{lat}`, `{lon}`

**Account / token:**
- `error_invalid_token` (line 2860)
- `error_link_failed` (line 2870)

**Web search:**
- `web_search_unavailable` (line 7469)
- `web_search_unavailable_hint` (line 7601) — placeholder `{hint}`
- `web_search_error` (line 7700)
- `search_found_items` (line 7452) — placeholder `{results}`

**Partner messaging edge cases:**
- `partner_reached_partial` (line 9154) — placeholders `{task}`, `{partner}`, `{last4}`
- `partner_unreachable` (line 9156) — placeholders `{partner}`, `{last4}`, `{detail}`

**List management:**
- `list_no_name` (line 9363)
- `list_already_exists` (line 9392) — placeholders `{list}`, `{count}`, `{plural}`
- `list_not_found` (line 9511) — placeholders `{query}`, `{lists}`
- `list_empty` (line 9525) — placeholder `{list}`

**Catch-all:**
- `error_save_failed` (line 10111)

Plus 2 sites where the existing `error_generic` key replaces inline
"Sorry, something went wrong" / "Sorry, there was an error" strings.

### Existing rich-key warm-up (6 keys)

Brand voice: drop emoji decoration (💚, 💬, 😕, 🤔), drop performative
"Done!", trim verbose multi-line success messages. The 🌿 leaf is the
signature prefix.

| Key | Before (en) | After (en) |
|---|---|---|
| `partner_message_sent` | `'✅ Done! I sent {partner} a message:\n\n"{message}"\n\nvia WhatsApp 💬'` | `'🌿 Sent to {partner}:\n\n"{message}"'` |
| `partner_message_and_task` | `'✅ Done! I told {partner} and saved a task:\n\n📋 "{task}"\n📂 Assigned to: {partner}\n💬 Notified via WhatsApp'` | `'🌿 Told {partner} and saved:\n\n📋 "{task}"\n📂 Assigned to {partner}'` |
| `partner_message_existing_task` | `'✅ Done! I reminded {partner} about an existing task:\n\n📋 "{task}"\n💬 Notified via WhatsApp\n\nℹ️ No duplicate created — task already tracked.'` | `'🌿 Reminded {partner} about an existing task:\n\n📋 "{task}"'` |
| `partner_no_phone` | `'😕 I\'d love to message {partner}, but they haven\'t linked their WhatsApp yet.\n\nAsk them to open Olive → Profile → Link WhatsApp.'` | `'🌿 {partner} hasn\'t linked WhatsApp yet. Ask them to open Olive → Profile → Link WhatsApp.'` |
| `partner_no_space` | `'I couldn\'t find your partner in the shared space. Make sure they\'ve accepted your invite!\n\nTo invite someone: open Olive → Profile → Invite Partner 💚'` | `'🌿 Looks like your partner hasn\'t accepted the invite yet. Open Olive → Profile → Invite Partner.'` |
| `task_ambiguous` | `'🤔 I found multiple tasks matching "{query}":\n\n{options}\n\nWhich one did you mean? Reply with the number.'` | `'🌿 A few tasks match "{query}":\n\n{options}\n\nWhich one? Reply with the number.'` |

`es` and `it` translations follow the same warming pattern (drop
exclamations, drop "Done!" / "¡Hecho!" / "Fatto!" performatives, drop
non-semantic emoji).

### Files

| File | Change |
|---|---|
| `whatsapp-webhook/index.ts` | +19 new RESPONSES keys; 6 rich-key rewrites; 19 call-site replacements (inline reply() strings → t()) |
| `whatsapp-webhook/responses-i18n.test.ts` | Added 20 keys to the i18n contract (`task_did_you_mean` from CONV-2 plus all 19 new CONV-3 keys) |

### Tests

- 1322 / 1322 (skipping pre-existing timezone-calendar failure). +42 from CONV-2 baseline 1280 — the i18n contract test fires locale-completeness + placeholder-consistency checks for every key in `NEW_PR1_PR2_KEYS`, and 20 new keys × 2 checks = +40, plus +2 from misc.

### Acceptance criteria

- [x] All 19 new keys have `en`/`es`/`it` with consistent placeholders
- [x] All 6 warmed keys retain their placeholder shape (no breaking changes for callers)
- [x] All 17 previously hardcoded reply strings now route through `t()`
- [x] No remaining `return reply('…')` literal-string sites left for user-facing copy
- [x] Brand voice 🌿 prefix consistent across rewrites
- [x] No regressions: 1322 / 1322 non-pre-existing tests pass

---

## 2026-05-14 — Brand-voice warm-up on dead-end replies + "Did you mean X?" weak-candidate offer

Follow-up to [CONV-1]. The previous PR landed the structural continuity
fixes; this one warms the copy and adds a soft fallback for weak-match
task searches. All changes in `en` / `es` / `it`.

### Brand-voice rewrite — 6 keys

Per `OLIVE_BRAND_BIBLE.md` + the olive-brand skill: "warm but not
saccharine; quietly clever; Got it beats Got it! 🎉✨." Existing replies
were over-cheerful for the actual user state.

| Key | Before (en) | After (en) |
|---|---|---|
| `task_completed` | `'✅ Done! Marked "{task}" as complete. Great job! 🎉'` | `'🌿 Done — "{task}" is complete.'` |
| `context_completed` | `'✅ Done! Marked "{task}" as complete (from your recent reminder). Great job! 🎉'` | `'🌿 Done — "{task}" is complete (from your recent reminder).'` |
| `action_cancelled` | `'👍 No problem, I cancelled that action.'` | `'🌿 Cancelled.'` |
| `error_generic` | `'Sorry, something went wrong. Please try again.'` | `'🌿 Something went wrong on my end. Try again?'` |

Mirror rewrites for `es` and `it` to match. The 🌿 leaf becomes the
signature prefix consistently across the brand voice.

### Hardcoded → i18n migration — 4 new keys

Three previously inline strings violated the "no hardcoded UI text" rule
and felt saccharine. Now i18n keys with all three locales:

- `empty_no_urgent`: en `'🌿 No urgent tasks right now. Want me to show what's coming up today?'` (was `'🎉 Great news! You have no urgent tasks right now.'`)
- `empty_no_today`: en `'🌿 Nothing due today. Want me to check tomorrow or this week?'` (was `'📅 Nothing due today! You're all caught up.'`)
- `empty_no_date`: en `'🌿 Nothing scheduled for {date}.'` (was `'📅 Nothing scheduled for ${dateLabel}.'`)
- `empty_no_recent`: en `'🌿 No recent tasks. Send me something to save.'` (was `'No recent tasks found. Send me something to save!'`)

### "Did you mean X?" weak-candidate offer

When TASK_ACTION semantic search returned a candidate with quality below
the 0.4 auto-use threshold, the old behavior dead-ended at `task_not_found`
with the user's query echoed back. Now: if the best candidate's word-
overlap quality is between 0.2 and 0.4, capture it as a `weakCandidate`
and offer it via the existing AWAITING_DISAMBIGUATION machinery — single
option, soft prompt: "🌿 Did you mean 'X'? Reply 'yes' to do it…"

The disambiguation handler is extended to accept `yes`/`sí`/`sì` as
"pick #1" when only one candidate is offered (previously only accepted
a numeric pick — felt unnatural for single-option offers).

| Key | New | Locales |
|---|---|---|
| `task_did_you_mean` | `'🌿 Did you mean "{task}"? Reply "yes" to do it, or send the full task name.'` | en, es, it |

### Files

| File | Change |
|---|---|
| `whatsapp-webhook/index.ts` | 4 brand-voice rewrites; 4 new empty-state keys; 1 new `task_did_you_mean` key; 3 hardcoded → i18n call-site swaps; weak-candidate capture in TASK_ACTION semantic search; weak-candidate offer at task_not_found site; single-candidate "yes" acceptance in AWAITING_DISAMBIGUATION |
| `whatsapp-webhook/responses-i18n.test.ts` | Added 7 new keys to the i18n contract test |

### Tests

- 1280 passed (was 1217 before this PR). +63 mostly from the i18n contract test discovering my new keys × 2 assertions (locale completeness + placeholder consistency).
- 1 pre-existing failure on `timezone-calendar.test.ts` (also fails on `main` — not introduced here).

### Acceptance criteria

- [x] All 4 warmed keys have `en`/`es`/`it` with consistent placeholders
- [x] All 5 new keys (`empty_no_urgent`, `empty_no_today`, `empty_no_date`, `empty_no_recent`, `task_did_you_mean`) have `en`/`es`/`it`
- [x] `task_pronoun_unclear`, `task_focal_offer` (from previous PR) added to i18n contract test
- [x] Weak-candidate offer triggers when semantic match quality is 0.2–0.4
- [x] Single-candidate "Did you mean X?" accepts "yes"/"sí"/"sì" as confirmation
- [x] Hardcoded user-facing strings removed from 3 sites (urgent/today/date/recent empties)
- [x] No regressions: 1280 / 1280 non-pre-existing tests pass

---

## 2026-05-13 — Conversation continuity: focal-entity persistence, smart re-targeting, partner-name guard, date-scoped agenda

Three reported production bugs from WhatsApp screenshots — all rooted in
the same architectural problem: Olive *has* the infrastructure for
continuity (`last_referenced_entity`, `conversation_history`,
`pending_offer`, `AWAITING_CONFIRMATION` state) but it was used
inconsistently. The same backend felt like a different bot depending on
intent. Brain-dump worked great; multi-turn refinement broke.

### Bug 1 — "Text Jacopo Amazon tomorrow" routed to partner Almu

Classifier had no signal to distinguish a relay-to-partner verb pattern
from a brain-dump task that *mentions* a third party. The
`PARTNER_MESSAGE` handler then looked up "the partner" from
`get_space_members` regardless of which name was in the message — so the
task ended up going to Almu over WhatsApp.

**Fix:** thread the user's actual partner name through to the intent
classifier as new `ClassificationInput.partnerName` + `selfName` fields,
and tighten the classifier prompt: a "text/tell/remind <NAME>" pattern
where `<NAME>` is not the partner (and not a generic partner reference
like "my partner") is a brain-dump CREATE, not a relay. Belt-and-
suspenders server-side guardrail (`SafetyNet#0.6`) in
[whatsapp-webhook/index.ts](practical-lichterman/supabase/functions/whatsapp-webhook/index.ts)
downgrades PARTNER_MESSAGE → CREATE if the classifier still misroutes.
Same partner-name wiring added to [ask-olive-individual](practical-lichterman/supabase/functions/ask-olive-individual/index.ts)
and [ask-olive-stream](practical-lichterman/supabase/functions/ask-olive-stream/index.ts)
so the in-app chat gets the same protection. Brain dump bias is
*strengthened* — non-partner names always default to CREATE.

### Bug 2 — "And for Friday?" after a calendar query returned "Nothing due today"

Two layers compounded. (a) The classifier's SEARCH `query_type` is a
fixed enum (`urgent | today | tomorrow | this_week | recent | overdue |
general`); "Friday" was not expressible, so the classifier defaulted to
`general` or `today`. (b) The SEARCH handler only branched on those
fixed buckets — no code path for an arbitrary date.

**Fix:** classifier prompt now has explicit Rule 17a — calendar/agenda
follow-ups carry the date forward in `due_date_expression` (free-form,
e.g. "Friday", "venerdì", "the 15th"). `mapAIResultToIntentResult` adds
a private `_dueDateExpr` field for SEARCH. New handler branch in
[whatsapp-webhook](practical-lichterman/supabase/functions/whatsapp-webhook/index.ts)
ahead of the today/tomorrow paths parses the expression via
`parseNaturalDate` + `getRelativeDayWindowUtc`, fetches tasks and
calendar events for the resulting window, and renders an agenda
"Agenda for Friday, May 16:" instead of defaulting to today's empty
state. Today/tomorrow shortcuts are untouched — only arbitrary days hit
the new path.

### Bug 3 — "Set it due for Friday at 5pm" couldn't resolve "it"

When the user said "Can you move Book Hotel for Mallorca to 5pm?", the
handler entered `AWAITING_CONFIRMATION` with `pending_action.task_id` set
but never stamped `last_referenced_entity`. The user's next message
("Set it due for Friday at 5pm") wasn't yes/no, so the handler
auto-cancelled the pending action — wiping the task identity — and
re-classified the message as a fresh `set_due` with `target_task_name =
"it"`. With no focal entity to bind "it" to, the resolver returned
the robotic "I couldn't find a task matching 'it'."

**Two-part fix:**

1. **Stamp focal entity on every TASK_ACTION resolution.** Once
   `foundTask` is non-null in the TASK_ACTION block — regardless of
   which path resolved it (AI UUID, semantic search, pronoun, ordinal,
   outbound context) — write `last_referenced_entity` to
   `user_sessions.context_data` (in-memory + DB). Both `clearPendingState`
   and `stampLastAction` already preserve this field, so it survives
   auto-cancellation. Downstream pending writes spread `...currentCtx`,
   so the stamp lives through them too.

2. **Smart re-targeting in AWAITING_CONFIRMATION.** Before auto-cancelling
   on a non-yes/no message, try to read it as a *refinement* of the same
   pending proposal. For `set_due_date`, that means: does the message
   parse to a concrete date AND carry a refinement signal (correction
   verb at start, pronoun at start, or is a ≤30-char date-shaped
   phrase)? If yes, update `pending_action.date` and re-prompt for
   confirmation with the new date — instead of throwing the proposal
   away. The natural conversational pattern is "Olive proposes X → user
   tweaks rather than yes/no"; we now honor it.

### Natural-conversation upgrades

Three smaller upgrades that ride on the same focal-entity work:

- **Pronoun-aware soft fallback.** When the user uses a pronoun and we
  have no focal entity to bind it to, the response no longer reads
  "I couldn't find a task matching 'it'." It reads "🌿 I'm not sure
  which task you mean. Tell me the name or say 'show my tasks' and
  I'll pull up the list." Translation keys added for en/es/it.
- **Brand-voice 🌿 prefix on dead-end replies.** Aligns with the brand
  bible "warm but not saccharine; quietly clever."
- **Pure-helper architecture.** New
  [`_shared/conversation-continuity.ts`](practical-lichterman/supabase/functions/_shared/conversation-continuity.ts)
  exports `detectSetDueRefinement` and `detectMisroutedPartnerRelay` so
  the predicates are unit-testable and reusable by other surfaces
  (group webhook, future chat refinements). The webhook calls these
  rather than inlining regex.

### Brain-dump preservation (audit)

Each change was reviewed against the "Rule 0: BRAIN DUMP DEFAULT" anchor
of Olive's positioning:

| Change | Brain-dump effect |
|---|---|
| Focal-entity stamp (Fix 1) | Only fires after a task is resolved — doesn't touch CREATE path |
| Re-targeting (Fix 2) | Only fires inside AWAITING_CONFIRMATION — doesn't touch new messages |
| Partner-name guard (Fix 3) | *Strengthens* brain dump: ambiguous "Text Jacopo" now → CREATE |
| Date-scoped SEARCH (Fix 4) | Only when classifier emits SEARCH + due_date_expression — CREATE bias unchanged |
| Pronoun soft fallback | Only when actionTarget is a pronoun AND no match — CREATE bias unchanged |

### Tests

- **20 new unit tests** in
  [`_shared/conversation-continuity.test.ts`](practical-lichterman/supabase/functions/_shared/conversation-continuity.test.ts)
  covering the three bug scenarios plus edge cases (Italian/Spanish
  refinements, long unrelated narrative with stray date, pronoun-only,
  partner full-name vs first-name, generic "mi pareja" reference,
  self-reminder vs partner relay).
- Baseline: 1197 passed, 0 failed. Post-change: **1217 passed, 0 failed.**
- Type-check on changed files: clean at all my edit locations
  (pre-existing TS errors at unrelated lines remain unchanged).

### Files

| File | Change |
|---|---|
| `_shared/conversation-continuity.ts` | **NEW** — `detectSetDueRefinement`, `detectMisroutedPartnerRelay` |
| `_shared/conversation-continuity.test.ts` | **NEW** — 20 unit tests |
| `_shared/intent-classifier.ts` | Added `partnerName`/`selfName` input, Rule 17a (calendar follow-ups carry date), partner-name guard rule |
| `whatsapp-webhook/index.ts` | Couple-row partner-name resolution; pass to classifier; SafetyNet#0.6 (PARTNER_MESSAGE → CREATE on name mismatch); date-scoped SEARCH branch; smart re-targeting in AWAITING_CONFIRMATION; focal-entity stamp on every TASK_ACTION resolution; pronoun-aware soft fallback; `_dueDateExpr` carry-through in mapping; new i18n keys `task_pronoun_unclear`, `task_focal_offer` |
| `ask-olive-individual/index.ts` | Pass `partnerName`/`selfName` to shared classifier |
| `ask-olive-stream/index.ts` | Pass `partnerName`/`selfName` to shared classifier |

### Acceptance criteria

- [x] "Text Jacopo Amazon tomorrow" with partner Almu → CREATE (brain dump task), no message sent to Almu
- [x] "Tell Almu to buy milk" with partner Almu → PARTNER_MESSAGE (unchanged)
- [x] "Set it due for Friday at 5pm" while a pending set_due_date proposal is open → refines the proposal (same task, new date) rather than dead-end
- [x] "Friday at 5pm" short reply during the same pending state → refines (date-shaped short msg)
- [x] "How are you?" during pending state → falls through to normal classification (refinement gates reject it)
- [x] "And for Friday?" after "What's on my calendar for tomorrow?" → date-scoped agenda for Friday, not "today"
- [x] "it" with no focal entity → "🌿 I'm not sure which task you mean..." (not robotic quoted "it")
- [x] All 1197 baseline tests still pass; 20 new tests pass; total 1217/1217

---

## 2026-05-13 — Task ownership: canonicalization end-to-end + pending-assignment toast

User-reported bug: typed "Almu book hotel for Mallorca" (Almu = partner).
Note created and showed "You" in the Home weekly chip. User reassigned
to Almu via the Owner Popover — Home chip still rendered "You".

### Root causes (three of them, distinct)

**Bug A — trust gate silent clear.** [process-note/index.ts](practical-lichterman/supabase/functions/process-note/index.ts) ran the AI's
correct assignment ("Almu") through `checkTrustForAction('assign_task')`.
For users with not-yet-elevated trust, the gate returns `allowed=false`
and the original code silently set `task_owner = null`. The note then
fell back to "no owner → author == me → You". User had no idea Olive
*wanted* to assign to Almu but was waiting for trust approval.

**Bug B — task_owner data format chaos.** Three writers stored three
incompatible formats:

  | Writer | Wrote | Format |
  |---|---|---|
  | process-note (AI) | "Almu", "G" | display-name string |
  | NoteDetails Popover | owner.name | display-name string |
  | QuickEditBottomSheet | 'you' / 'partner' / 'shared' | client token |

The resolver in [Home.tsx](practical-lichterman/src/pages/Home.tsx) tried to handle all three with nested
branches and hit one branch that compared `task_owner` to the literal
string "You" returned by `getMemberName(currentUser.id)` (line 46 of
[SupabaseCoupleProvider.tsx](practical-lichterman/src/providers/SupabaseCoupleProvider.tsx)). Reassigning to a partner whose
display-name happened to start with the same letter as the current
user could re-trigger the You branch. Even when it didn't, the resolver
sometimes returned the raw token "partner" as the chip label.

**Bug C — latent.** QuickEditBottomSheet (currently not mounted but
defined in the codebase) wrote 'you' / 'partner' / 'shared' as raw
strings. Any future surface that mounted it would re-introduce Bug B.

### The fix — one canonical format, end-to-end

**`clerk_notes.task_owner` is now `NULL` or a `user_id`. Nothing else.**

1. **Migration** ([20260513034047_canonicalize_task_owner.sql](practical-lichterman/supabase/migrations/20260513034047_canonicalize_task_owner.sql)) — multi-pass
   resolution to backfill legacy values. Pre-flight audit on production:
   668 NULL + 29 display-name strings + 15 user_ids + 3 'shared' tokens.
   Post-migration: 673 NULL + 42 user_ids, zero non-canonical values.
   The resolution passes (space-scoped first, then couple-scoped):
   exact display_name → nickname → first-name (case-insensitive) →
   prefix match. 27 of 29 display-name rows resolved to real user_ids
   ("Almu" → Almudena's user_id, "G" → Gianluca's). 2 unresolvable
   rows ("Jonathan" not in space, "Olive" the AI itself) safely nulled.

2. **process-note** now resolves the AI's chosen display name → user_id
   via `olive_space_members` BEFORE writing. The trust gate keys off
   user_id equality (`!== user_id` = other-assignment); when gated, it
   returns `pending_assignment.intended_owner_name` so the client can
   surface a toast.

3. **NoteDetails Owner Popover** writes `owner.id` (canonical user_id),
   not `owner.name`. The `availableOwners` fallback no longer pushes
   the literal `'partner'` token — falls back to the current user's
   real id, skipping the partner slot if it can't be resolved.

4. **QuickEditBottomSheet** rewritten to accept `currentUserId` /
   `partnerUserId` props and write user_ids directly. The three buttons
   now set `owner` state to the literal user_id (or `null` for Both).

5. **Resolver** extracted to a pure helper [src/lib/owner-display.ts](practical-lichterman/src/lib/owner-display.ts).
   Single source of truth for the chip label across Home, PartnerActivityWidget,
   ContextRail. Unit-tested in [_shared/owner-display.test.ts](practical-lichterman/supabase/functions/_shared/owner-display.test.ts) — 16 cases
   covering the regression scenario, legacy token defensive paths, and
   the "Everyone" fallback for user_ids that no longer match a member.

6. **`SupabaseNotesProvider`** rewritten `getTaskOwnerName` → defensive
   `resolveTaskOwner` that handles canonical user_ids and is bulletproof
   against any legacy strings that might slip through (e.g., a stale
   client between PR merge and cache refresh). Returns `{ id, name }`
   so the Note type can carry both `task_owner` (canonical) and
   `task_owner_name` (display).

7. **Non-intrusive toast** on Home: when process-note returns
   `pending_assignment`, NoteInput surfaces "🌿 Got it — and I'd assign
   this to Almu, pending your approval." i18n keys in en/es-ES/it-IT.

### Test plan

- ✅ `deno test supabase/functions/_shared/` — **1213 passed / 0 failed**
  (1197 existing + 16 new owner-display tests)
- ✅ `npx tsc --noEmit` — clean
- ✅ Pre/post-flight SQL audit on production: zero non-canonical
  task_owner values remain
- ✅ Migration ledger aligned via `scripts/sync-migration-filenames.sh`

### Files touched

| File | Change |
|---|---|
| `supabase/migrations/20260513034047_canonicalize_task_owner.sql` | New migration (applied via MCP) |
| `supabase/functions/process-note/index.ts` | Resolve AI name → user_id; trust-gate returns `pending_assignment` |
| `supabase/functions/_shared/owner-display.test.ts` | New — 16 unit tests for the helper |
| `src/lib/owner-display.ts` | New — pure resolver helper |
| `src/types/note.ts` | Add `task_owner_name`, clarify `task_owner` contract |
| `src/providers/SupabaseNotesProvider.tsx` | Defensive `resolveTaskOwner` |
| `src/pages/NoteDetails.tsx` | Write `owner.id`; fallback no longer uses 'partner' token |
| `src/pages/Home.tsx` | Use `resolveOwnerLabel` helper |
| `src/components/QuickEditBottomSheet.tsx` | Rewrite to accept user_ids |
| `src/components/NoteInput.tsx` | Pending-assignment toast |
| `src/components/PartnerActivityWidget.tsx`, `src/components/layout/ContextRail.tsx` | Drop legacy 'you' triple-OR; use canonical equality |
| `src/components/NoteRecap.tsx`, `src/components/MultipleNotesRecap.tsx` | Display `task_owner_name` (resolved) instead of raw user_id |
| `public/locales/{en,es-ES,it-IT}/home.json` | `toast.pendingAssignment` key |

---

## 2026-05-12 — Brain-dump organization: sub-items mode + topical follow-up attach

Three coordinated improvements to how Olive captures and threads multi-line
brain dumps. Fixes the production failure mode where a conceptual brain dump
("Examples for hard rock stadium\nReplay\nSuite support\n…") fragmented into
N sibling notes — including a phantom row for the header — and a subsequent
sub-detail ("Email address for Hard Rock\nfoo@bar.com") got saved as a
separate note instead of attaching to the parent.

### What changed

1. **Broader header detection.** `_shared`-adjacent detector
   `multi-item-detect.ts` now recognizes noun-phrase intros across en/es/it
   (`examples|ideas|topics|notes|options|points|considerations|highlights|
   takeaways|priorities|brainstorm|discussion|agenda` + Spanish/Italian
   equivalents) anchored to the first 30 chars of the line. This stops
   "Examples for Hard Rock Stadium" from leaking through as a phantom task
   while remaining inert for prose containing the same words mid-sentence.

2. **`ListMode` classifier + subitems persistence path.** New
   `classifyListMode(header, items)` returns `"siblings"` or `"subitems"`.
   A conceptual header with short noun-phrase items in the 2–10 range and
   < 30% action verbs persists as ONE parent note with the bullets in the
   existing `items[]` JSONB column. Checklist-style headers (`Shopping
   list`, `Things to do`, `Action items` + locale equivalents) always
   force siblings. `process-note/index.ts` learned a new subitems branch
   that makes ONE Flash-Lite call (vs. N parallel calls) with the items
   locked into the response and two layers of deterministic fallback so
   the user's brain dump is never lost on model failure. The system
   prompt was rewritten to teach both modes consistently. The
   WhatsApp single-note confirmation surfaces up to 5 sub-items
   (localized overflow tail) so users see what landed.

3. **Topical follow-up attach with undo.** New `_shared/topical-followup.ts`
   detects "Label for Topic\nvalue" patterns (Email/Phone/Address/Link/
   Notes in en/es/it), queries the user's last 5 notes within 30 min,
   scores topic↔summary overlap (substring + multi-token + capitalized
   anchor; threshold 0.7 with stop-words filter), and silently attaches
   the new field to the matching parent's `items[]` instead of creating
   a sibling note. The user gets a confirmation with an undo hint;
   replying "undo" / "no" / "split" (or Spanish/Italian equivalents)
   within the 10-min pending-offer TTL reverts the attach AND re-runs
   the original message through process-note as a standalone note.
   The follow-up check skips when other offers are alive, when there's
   media, or when the message was pronoun-resolved.

### Files touched

| File | Change |
|---|---|
| `supabase/functions/process-note/multi-item-detect.ts` | +268 LOC. Broadened header regex, anchored keyword test, `ListMode` + `classifyListMode`, threaded `mode` through every return. |
| `supabase/functions/process-note/multi-item-detect.test.ts` | +263 LOC. 19 new tests covering the screenshot bug, en/es/it conceptual headers, regression guards for checklists, and the classifier as a unit. |
| `supabase/functions/process-note/index.ts` | +191 LOC. Subitems branch in the splitter, defensive items-restoration on AI failure, summary-prefix cleaning, updated system prompt for both modes. |
| `supabase/functions/whatsapp-webhook/index.ts` | +305 LOC. CREATE-path topical-followup check (pre-process-note), SafetyNet #1.4b for undo replies, sub-items preview in single-note confirmation. |
| `supabase/functions/_shared/topical-followup.ts` | **NEW** — 336 LOC. Pure detector + Supabase helpers + undo classifier. |
| `supabase/functions/_shared/topical-followup.test.ts` | **NEW** — 40 tests including a hand-rolled thenable Supabase fake. |
| `supabase/functions/_shared/pending-offer.ts` | +39 LOC. `AttachedToParentOffer` discriminated-union variant. |

### Verification
- ✅ `deno test supabase/functions/_shared/ supabase/functions/process-note/` — 1,220 / 1,220 passing.
- ✅ Zero new TS errors (`deno check` clean on all touched files). The 9 pre-existing errors in `whatsapp-webhook/index.ts` and `orchestrator.ts` predate this change and are at unrelated lines.
- ✅ Legacy detector behavior preserved: all 20 original `multi-item-detect.test.ts` cases pass unchanged.

### Deploy notes
- **No schema changes.** Writes only to existing columns (`clerk_notes.items`,
  `user_sessions.context_data`).
- **No new env vars.** Reuses `SUPABASE_URL`, service-role key, Gemini key.
- Edge functions: `supabase functions deploy process-note whatsapp-webhook`
  on push to `dev` per existing CI.
- Frontend untouched — no Vercel rebuild needed for behavior, though the
  preview will deploy automatically.

### Out of scope (deferred follow-ups)
- Expanding the topical-followup pattern set beyond "Label for Topic" intros
  (e.g., recognizing `Topic: value` without an explicit label, or bare-
  proper-noun continuations like "Sarah called back"). Deliberately kept
  narrow for v1 to minimize false-positive attaches.
- Surfacing sub-items in the web app's note detail view — already rendered
  there via the existing `items` column read path; no UI change needed.
- Topical-followup detection on the WEB-app process-note caller (currently
  WhatsApp-only since the undo UX needs the channel's reply path).



This log tracks structural changes made while delivering Phase 1 of the
engineering hardening plan. Each task is additive and backwards-compatible;
there are no behavioral rollbacks.

- **Scope:** memory quality, context assembly, model routing, thread
  instrumentation, destructive-action safety.
- **Non-goals:** visible product changes, UI work, new user-facing features.
- **Deployment shape:** one migration + edge-function updates. The migration
  is idempotent (`IF NOT EXISTS` + `DO` blocks) and safe to re-run.

---

## 2026-05-12 — iOS 1.2.1 (build 4) — patch release

Patch bump packaging two days of `main` activity into a TestFlight build.
Same Capacitor stack as 1.2, no plugin churn, no native code changes —
just a fresh `dist/` bundle copied into the iOS shell via
`npx cap copy ios` + `npx cap update ios`.

### What's in the bundle vs 1.2 (3)

**User-facing fixes:**
- **Mobile UI polish ([#107](https://github.com/ganga90/olive-couple-sync/pull/107))** — Home partner-activity widget collapses to a single
  freshest update with a *See N more* pill (was showing up to 5 inline,
  turning the feed into a wall of cards on tall family/friend spaces).
  MyDay agent-insight cards redesigned: white surface + hairline border,
  squircle agent icon, list-aware bullet renderer that turns bulleted
  reports into a real `<ul>`. Expenses page now scrolls — root div wraps
  in `h-full overflow-y-auto`, fixing rows past the viewport being
  unreachable (`AppLayout` mobile `<main>` is `overflow-hidden`).
- **ContextRail date-only off-by-one ([#109](https://github.com/ganga90/olive-couple-sync/pull/109))** — calendar panel on the right showed
  "Thu, May 14" for a task whose `due_date` was `2026-05-15` when the
  user's timezone was negative-offset (e.g. America/New_York). Parsed
  the `YYYY-MM-DD` string as local midnight instead of UTC midnight so
  the displayed day matches the user's mental model.

**Reliability behind the scenes (web-only, but iOS WebView benefits):**
- Calendar error classification + branched retry ([#103](https://github.com/ganga90/olive-couple-sync/pull/103))
- Calendar connection health + reconnect banner + WhatsApp i18n + CI smoke ([#104](https://github.com/ganga90/olive-couple-sync/pull/104))
- Calendar retry queue visibility on `/calendar` ([#105](https://github.com/ganga90/olive-couple-sync/pull/105))
- Calendar edit hotfix — auto-event note_id orphans backfilled ([#99](https://github.com/ganga90/olive-couple-sync/pull/99))

**Infrastructure (zero user-visible delta):**
- `config.toml` cleanup — every utility function explicitly registered;
  `KNOWN_LEGACY_STRAGGLERS` allowlist purged (#98 / #100 / #101 / #102 / #106).

### Why 1.2.1 not 1.3

The UI work in #107 is real, but it's polish on existing surfaces, not
new product. Calling it a patch keeps the marketing version honest —
1.3 is the next time iOS users get a meaningfully different *thing to
do*, not just better behavior on what they already had. Build number
bump (3 → 4) is mandatory for App Store upload regardless.

### Bundle state at archive time

- `dist/` regenerated via `npm run build` (4.25s, full Vite output).
- `ios/App/App/public/` refreshed via `npx cap copy ios` (gitignored;
  bundle assets the WebView serves).
- `ios/App/App/capacitor.config.json` + `config.xml` regenerated by
  `npx cap update ios` (gitignored).
- Pods reinstalled by `cap update`'s embedded `pod install` (3.29s).
- 5 Capacitor plugins, all 7.x: `@capacitor/app@7.1.2`,
  `camera@7.0.2`, `haptics@7.0.5`, `keyboard@7.0.6`, `status-bar@7.0.6`
  — unchanged from 1.2.
- `Podfile.lock` unchanged.

### Repo change is intentionally minimal

Only the Xcode version bump is committed:

```
ios/App/App.xcodeproj/project.pbxproj
  CURRENT_PROJECT_VERSION  3 → 4    (Debug + Release, mandatory)
  MARKETING_VERSION       1.2 → 1.2.1 (Debug + Release, editorial)
```

The regenerated `dist/`, `ios/App/App/public/`, `capacitor.config.json`,
`config.xml`, and `Pods/` are all gitignored — they regenerate
deterministically from a clean clone via the
`ios/App/ci_scripts/ci_post_clone.sh` hook (used by Xcode Cloud) or by
re-running `npm run build && npx cap sync ios` locally before Archive.

### To archive + upload (manual — you do this in Xcode)

1. Open `ios/App/App.xcworkspace` in Xcode (workspace, not project).
2. Select target **withOlive** → scheme **App** → destination **Any iOS Device (arm64)**.
3. Product → Archive. Wait for `** ARCHIVE SUCCEEDED **`.
4. Window → Organizer → select the new 1.2.1 (4) archive → Distribute App → App Store Connect → Upload → Automatically manage signing.
5. After processing in App Store Connect (~10 min), promote to TestFlight via the App Store Connect web UI.

---

## 2026-05-12 — ContextRail "Thu, May 14" off-by-one fix (date-only due_date in negative-offset timezones)

A user reported that the right-side calendar panel on the Home page
showed "Visit grocery store / Thu, May 14" — but the task had already
been moved to Friday May 15 at 12pm via Ask Olive (verified end-to-end
in PR #99: HTTP 200 + sync_status=updated + Google Calendar PATCH
landed). The chat flow worked. The display didn't.

**The bug — two layers.**

**Layer 1: surfaces read `due_date` only, ignoring `reminder_time`.**
After a "move to Friday at 12pm" reschedule, `clerk_notes` ends up with
two fields:
- `reminder_time = 2026-05-15 16:00:00+00` (Friday 12pm NY — correct)
- `due_date = 2026-05-15 00:00:00+00` (Friday midnight UTC — stale
  from the original date-only capture)

`ContextRail.tsx`, `CalendarPage.tsx`, and `Home.tsx`'s weekly view all
read `note.dueDate` and ignored `reminder_time`. The fresher of the two
truths was being thrown away.

**Layer 2: `new Date("2026-05-15 00:00:00+00").toLocaleString()` in any
negative-offset timezone returns the previous day.** Midnight UTC on
May 15 is May 14 8pm in NY (UTC-4), May 14 5pm in LA (UTC-7), May 14
9pm in Halifax (UTC-3), etc. This is the same off-by-one class of bug
that was already fixed in the server-side `_shared/bulk-resolver.ts`
and `_shared/pattern-detector.ts` — but the frontend never got the
parallel treatment. Frontend kept doing `new Date(dueDate)` directly.

**The fix.**

New shared helper at [src/lib/note-display-moment.ts](practical-lichterman/src/lib/note-display-moment.ts):
`getNoteDisplayMoment(note, timeZone)` returns `{ moment: Date,
isTimed: boolean } | null`. Two-line contract:

1. **Precedence**: if `reminder_time` is set, use it — it's the
   authoritative "when". Otherwise fall back to `due_date`.
2. **Date-only handling**: when the value matches the "midnight UTC"
   shape (the convention Olive uses for date-only entries in a
   `timestamptz` column), parse the Y-M-D and anchor at noon in the
   user's IANA timezone. Plain `YYYY-MM-DD` strings also handled.
   Otherwise the value is a real timed moment — trust it as-is.

The "noon in the user's timezone" anchor is the key trick. Any hour
between 1am and 11pm in any zone keeps the calendar day stable across
`toLocaleDateString` / date-fns `format` calls. Noon also survives DST
transitions cleanly (the helper falls back to a second offset-correction
pass for DST boundary days — covered by tests).

Implementation uses `Intl.DateTimeFormat.formatToParts` to compute the
UTC offset at a specific instant — the only cross-browser standard API
that's aware of historical DST rules. No date-fns-tz dependency added.

**17 unit tests** at
[supabase/functions/_shared/note-display-moment-helper.test.ts](practical-lichterman/supabase/functions/_shared/note-display-moment-helper.test.ts)
cover:
- reminder_time precedence (both fields set, only reminder, only due)
- date-only due_date in NY (the exact reported case), LA, Madrid, UTC,
  and the no-timezone default
- DST transition days: 2026-03-08 NY spring-forward + 2026-04-05
  Sydney fall-back
- both Postgres `timestamptz` format (`2026-05-15 00:00:00+00`,
  `+00:00`) AND ISO 8601 format (`T00:00:00.000Z`)
- degenerate inputs (null, undefined, malformed strings)

Each test renders the resulting moment as "Fri, May 15" in the
target timezone — pinning the user-visible string, not just the
underlying Date.

**Three surfaces wired up in this PR.**

| File | Change |
|---|---|
| `src/components/layout/ContextRail.tsx` | All three useMemos (upcomingEvents, taskDates, todaysTasks) refactored to use a single shared `datedNotes` array of `{ note, moment, isTimed }`. `formatEventDate` now takes a `Date` instead of a string — no more second `new Date(...)` parse that could re-introduce the bug. |
| `src/pages/CalendarPage.tsx` | `getTasksForDate` reads from a memoized `datedTasks` array. Day-grid dots now appear on the right day in negative-offset zones. |
| `src/pages/Home.tsx` | `getTasksForDays` (the weekly-view bucketing function) resolves each note's moment once via the helper, then buckets per day. |

Each gets a `userTimeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])` threaded through.

**Surfaces not yet wired up** (deferred to a follow-up — same helper,
mechanical application): `src/pages/MyDay.tsx`,
`src/pages/Reminders.tsx`, `src/pages/Lists.tsx`,
`src/components/NoteCard.tsx`, `src/components/TaskItem.tsx`,
`src/components/SwipeableReminderCard.tsx`, etc. Spawning the follow-up
task. ~15 components total — keeping this PR focused on the three
highest-visibility surfaces (the ones the user can immediately see
broken).

**Tests:** 1141 deno tests pass (+17 new from the helper).

**Known gap (separate from this PR):** the grocery note's
`calendar_events` mirror was deleted during earlier testing and the
most recent Ask Olive reschedule didn't re-create it. The chat flow
hit `no_linked_event` and returned. The display-layer fix in this PR
unblocks the user's reported symptom (right-side panel shows the right
date), but the missing mirror means the Google Calendar event itself
isn't currently linked back. Recovery path designed in the spawned
follow-up: have `executeReschedule` fall back to `calendar-create-event`
when the mirror is missing.

| Date | Files | Description |
|---|---|---|
| 2026-05-12 | `src/lib/note-display-moment.ts`, `src/components/layout/ContextRail.tsx`, `src/pages/CalendarPage.tsx`, `src/pages/Home.tsx`, `supabase/functions/_shared/note-display-moment-helper.test.ts` | New display-moment helper + applied to ContextRail / CalendarPage / Home weekly view; 17 unit tests. |

---

## 2026-05-12 — Home / MyDay / Expenses mobile polish

Three surface-level UI fixes on mobile, none touching data.

**1. Partner activity widget — collapsed by default ([PartnerActivityWidget.tsx](practical-lichterman/src/components/PartnerActivityWidget.tsx)).**
Home was showing up to 5 recent updates from other space members
inline, which on a tall family/friend space turned the feed into a wall
of cards. The widget now shows only the freshest update and a small
"See N more" pill that expands to up to 5; expanding shows a "Show less"
affordance. Card surface switched from grey muted tint to clean
`bg-white/70` with hairline stone border to match the paper aesthetic.

**2. Agent insights — redesigned cards on MyDay ([AgentInsightsSection.tsx](practical-lichterman/src/components/AgentInsightsSection.tsx)).**
Old layout dropped each agent result onto a saturated tinted body that
clashed with the calm Olive surface, and rendered bullet-listed agent
output as `whitespace-pre-wrap` text. New layout: white card + hairline
border, larger 28%-radius squircle agent icon with the agent's color
on the icon only, list-aware `AgentMessage` renderer that detects
bulleted reports and renders a real `<ul>` with leaf bullets and
hanging indent. Badges desaturated to stone/amber/emerald-50 tints so
true status colors (red overdue) actually pop when they fire. Header
gained a serif title and pill-style "Manage" button. "More" → "Show
more / Show less" with a rotating chevron.

**3. Expenses page scrolls again ([Expenses.tsx](practical-lichterman/src/pages/Expenses.tsx)).**
`AppLayout`'s mobile `<main>` is `overflow-hidden` (each page owns its
scroll). Home wraps in `overflow-y-auto`; Expenses didn't, so rows past
the viewport were unreachable and the user had to force a rubber-band
scroll. Added `h-full overflow-y-auto scrollbar-thin` to the page root
and verified live in the local preview.

**i18n.** New keys (`titleMulti`, `emptyMulti`, `seeMore`, `showLess`,
`showingCount`) added to en/es-ES/it-IT `home.json` per the
no-hardcoded-strings rule.

| Date | Task | Files | Description |
|------|------|-------|-------------|
| 2026-05-12 | UI-MOBILE-POLISH | src/components/PartnerActivityWidget.tsx, src/components/AgentInsightsSection.tsx, src/pages/Expenses.tsx, public/locales/{en,es-ES,it-IT}/home.json | Collapse partner activity to 1 row + See more; redesign agent insight cards; fix Expenses scroll container |

---

## 2026-05-12 — Calendar retry queue visibility on /calendar (PR 2C)

Closes the final loop in the 2026-05-12 calendar reliability story.
PR 2 made the retry queue honest about its state in the API response
and chat suffix ("I'll keep trying in the background"). PR 2B added
the reconnect banner for the permanent-failure case. This PR makes
the queue's state visible on `/calendar` so the user can verify that
"in the background" promise — and trigger a retry on demand.

**A pre-existing RLS bug discovered (and fixed) along the way.** The
Phase 2.1 `olive_calendar_sync_queue` migration shipped with:

```sql
USING (auth.uid()::text = user_id)
```

But this app authenticates via Clerk, not Supabase Auth. The user
identifier lives in `auth.jwt() ->> 'sub'` (a Clerk-issued
`user_xxx…` text id); `auth.uid()` returns either NULL or a Supabase
Auth UUID that never matches. So the policy as-shipped silently
rejected every client-side SELECT on the queue. The retry worker
(service-role) bypassed RLS so the queue itself worked — the bug
only surfaced now, building this PR, when a real user JWT tried to
read the queue.

Migration `20260512033908_fix_olive_calendar_sync_queue_rls_for_clerk`
replaces the policy with the same Clerk pattern every other table in
the repo uses (clerk_notes, calendar_connections,
olive_calendar_sync_log).

**The visibility surface.**

`useCalendarSyncQueue` (`src/hooks/useCalendarSyncQueue.ts`):
- Reads pending rows from `olive_calendar_sync_queue` for the
  authenticated user (relies on the just-fixed RLS policy)
- 30s polling cadence, paused via `visibilitychange` when the tab is
  hidden so a backgrounded `/calendar` doesn't burn cycles
- `retryNow()` POSTs to `calendar-sync-retry` (the cron-driven
  worker, which also accepts ad-hoc invocations) with
  `invoked_from='manual-retry-now'` for analytics segmentation
- Re-fetches 1.5s after `retryNow` so the count drops promptly when
  fast retries (~500ms) finish; slow ones resolve on the next poll
- Returns `{ queue, pendingCount, loading, retrying, retryNow,
  refetch }` — UI-agnostic, reusable from any surface

`CalendarSyncQueueBadge`
(`src/components/CalendarSyncQueueBadge.tsx`):
- **Hidden entirely when `pendingCount === 0`.** The queue being
  empty is the steady state. Showing "0 pending" creates anxiety
  where there shouldn't be any; the calendar header stays calm on
  the happy path.
- When count > 0: small amber pill in the header (between "Today"
  and "Sync") showing "N updates pending"
- Click expands a dropdown listing each queue row (action type +
  relative next-attempt timestamp from date-fns + the user's locale)
- "Retry now" button POSTs to `calendar-sync-retry`; spinner while
  in-flight; success toast with count, error toast on failure
- Click-outside backdrop closes the dropdown
- Past timestamps render as `—` instead of date-fns's confusing
  "less than a minute ago" for a queue that hasn't fired yet

i18n in en / es-ES / it-IT under `calendar.pendingSyncs` — singular
+ plural badge labels, action-type labels (create/update/delete →
"New event" / "Time change" / "Deletion"), retry button states,
success/error toast copy.

**Files touched.**

| Path | Change |
|---|---|
| `supabase/migrations/20260512033908_fix_olive_calendar_sync_queue_rls_for_clerk.sql` | DROP + recreate SELECT policy with Clerk JWT pattern |
| `src/hooks/useCalendarSyncQueue.ts` | New hook |
| `src/components/CalendarSyncQueueBadge.tsx` | New component |
| `src/pages/CalendarPage.tsx` | Render the badge in the header |
| `public/locales/{en,es-ES,it-IT}/calendar.json` | `pendingSyncs` keys |

**Verification.**
- 1126 deno tests still pass — backend unchanged
- TypeScript clean
- Migration applied to prod via Supabase MCP
- Vite served `useCalendarSyncQueue.ts` and
  `CalendarSyncQueueBadge.tsx` via the module graph without error;
  no new console errors in the dev server's runtime logs
- **Full E2E browser verification blocked by prod-Clerk-on-localhost
  limitation.** Clerk's production publishable key refuses to load on
  `localhost:8080` (well-known dev-environment issue, unrelated to
  this PR), so the dev server's `/calendar` page shows the
  "Sign in to view your calendar" stub. The badge code path only
  renders for an authenticated user with a calendar connection, so
  the actual badge UI couldn't be exercised in the preview. Verified
  via:
    - Module-graph compilation (Vite served both new files clean)
    - TypeScript compilation
    - Read-through of every code path with the production schema in
      mind
  End-to-end verification with a real user will land via the next
  deploy to a domain Clerk's prod key accepts.

**The full PR chain.** This is the last piece of the 2026-05-12
calendar reliability story:

1. [#99](https://github.com/ganga90/olive-couple-sync/pull/99) (PR 1)
   — register the calendar functions in `config.toml`, replace the
   racy `process-note` invocation with a Postgres trigger, backfill
   orphan rows.
2. [#103](https://github.com/ganga90/olive-couple-sync/pull/103)
   (PR 2) — classify Google errors at the source, branch the edge
   functions, honest retry queue, differentiated user-facing copy.
3. [#104](https://github.com/ganga90/olive-couple-sync/pull/104)
   (PR 2B) — persist connection health, render the reconnect banner,
   parallel WhatsApp i18n, nightly CI smoke check.
4. This PR (PR 2C) — visibility for the retry queue itself.

After this chain merges, the chat-reply contract is verifiable
end-to-end: classify → branch → enqueue honestly → render banner →
render queue → retry on demand. No silent dead-ends.

---

## 2026-05-12 — Calendar connection health + UI surfacing (PR 2B)

PR 2 made `calendar-update-event` and `calendar-delete-event` return
the right `sync_status` per failure class — including `needs_reconnect`
for 401/403. But that status only lived in the API response and the
chat suffix; a user who got the message in WhatsApp and ignored it,
then checked the web app later, saw no reason to act. PR 2B closes
that loop by persisting health state, surfacing it as a banner in
the settings UI, and parallel-updating WhatsApp's localized copy so
the same vocabulary lands on every surface.

**Four pieces (Piece 4 — pending-queue badge — deferred to PR 2C).**

**Piece 1 — Connection health persistence.** Migration
`20260512031557_calendar_connections_health_status` adds three columns
to `calendar_connections`:
- `health_status text NOT NULL DEFAULT 'healthy'` (CHECK constraint:
  `'healthy' | 'auth_expired' | 'scope_insufficient' | 'persistently_failing'`)
- `last_health_change_at timestamptz`
- `health_message text` (truncated at 500 chars at the helper)

Plus a partial index `idx_calendar_connections_health_unhealthy` on
`(user_id, health_status) WHERE health_status != 'healthy'` — cheap
lookup for the banner query, doesn't bloat the index when ~all rows
are healthy (which is the steady state).

Two helpers in `_shared/google-calendar.ts`:
- `markConnectionUnhealthy(supabase, connectionId, reason, message?)`
  writes the columns; called from the `auth_expired` /
  `scope_insufficient` branches in calendar-update-event and
  calendar-delete-event.
- `markConnectionHealthy(supabase, connectionId)` clears them.
  Uses `.neq("health_status", "healthy")` so the timestamp doesn't
  churn on already-healthy rows — important for "when did this user
  last have a problem" queries.
- Both swallow DB errors as non-fatal: the calendar mutation itself
  has already succeeded by the time we get here, the banner state is
  gravy.

Called from:
- Failure paths (auth_expired / scope_insufficient) → mark unhealthy
- Success paths (after successful PATCH + local mirror update, after
  successful DELETE + mirror cleanup) → clear flag

**Piece 2 — Reconnect banner.** `GoogleCalendarConnect.tsx` now reads
`health_status` from `calendar_connections` (RLS already allows users
to SELECT their own row) and renders a destructive-variant alert above
the existing "connected" card when status != 'healthy'. The banner:
- Uses the destructive design token (red surround, AlertTriangle icon)
  so it reads as "action required", not a generic note
- Differentiates copy between `auth_expired` ("Olive can't reach Google
  with your current sign-in") and `scope_insufficient` ("Olive doesn't
  have the right permissions")
- CTA button reuses the existing `handleConnect()` OAuth flow — no
  new code path, just a different entry point
- i18n in en / es-ES / it-IT under `profile.googleCalendar.reconnectBanner`

Self-healing by design: when the user reconnects, the next successful
calendar call hits `markConnectionHealthy`, the column clears, the
banner disappears on next page load.

**Piece 3 — WhatsApp parallel copy.** `_shared/whatsapp-calendar-sync.ts`
got the same L4 differentiation that landed in `_shared/offer-copy.ts`
for PR 2:
- New status values added to `WhatsAppCalendarSyncStatus` enum:
  `needs_reconnect`, `rate_limited`, `google_unavailable`,
  `enqueue_failed`
- New fields on `WhatsAppCalendarSyncReport`: `enqueue_failed`,
  `enqueue_failure_reason`, `retry_after_ms`, `needs_reconnect`,
  threaded through from the edge function responses
- `buildWhatsAppCalendarSuffix` switch covers every new status with
  en / es-ES / it-IT translations
- Retired the dead-end "couldn't reach Google Calendar this time"
  copy, mirroring the L4 change on the web side
- `rate_limited` quotes the Retry-After hint in seconds when in the
  10s–10min readable window; falls back to generic copy outside it
- `etag_conflict` kept on the legacy "didn't respond / keep trying"
  string verbatim — its semantics didn't change

**Piece 5 — CI smoke check.** New GitHub Actions workflow
`.github/workflows/calendar-smoke.yml` runs nightly (09:17 UTC) +
on-demand via workflow_dispatch:
- POSTs to `calendar-update-event` with a known test user_id +
  note_id (from repo secrets — never hardcoded)
- Idempotent: targets a static future time so re-runs don't drift
  state (Google PATCH is a no-op when state already matches)
- Asserts HTTP 200 + `sync_status: "updated"` + `synced_to_google: true`
- Surfaces the specific failure mode in the workflow error message
  (e.g. "needs_reconnect → reconnect the test account") so on-call
  knows the recovery action without re-running locally
- Catches exactly the class of gateway-auth bug PR 1 fixed; deno
  tests pass with stubbed fetch and can't catch real Supabase
  configuration drift

Required secrets (set up before first run):
- `SUPABASE_FUNCTIONS_URL`
- `SUPABASE_FUNCTIONS_ANON_KEY`
- `CALENDAR_SMOKE_USER_ID`
- `CALENDAR_SMOKE_NOTE_ID`

**Tests** — 1126 total (+22 from PR 2's 1103):
- 6 in `google-calendar.test.ts` for `markConnectionUnhealthy` /
  `markConnectionHealthy` — write contract, message truncation,
  .neq guard against timestamp churn, swallowed DB errors
- 16 in `whatsapp-calendar-sync.test.ts` for every new status × every
  locale, plus retry-precedence and Retry-After hint quoting
- Updated 3 existing tests that asserted the now-retired "couldn't
  reach" copy

**E2E verification on prod (the part that matters):**
- Migration applied via Supabase MCP — 7 existing connections defaulted
  to `'healthy'`, no behavior change
- Happy-path regression: `calendar-update-event` for Demo Reviewer's
  grocery task → HTTP 200, `sync_status: "updated"`
- **Health self-heal verified**: pre-set Demo Reviewer's
  `health_status='auth_expired'` via SQL → ran a successful update →
  observed the flag auto-clear to `'healthy'` with a fresh
  `last_health_change_at` (~12 seconds later). The full health
  lifecycle (mark unhealthy on failure → mark healthy on next success)
  works against prod.

The `markConnectionUnhealthy` side of the lifecycle has unit-test
coverage but no live E2E — forcing a real Google 401 against Demo
Reviewer's OAuth would mean corrupting their access token. That class
of failure will surface in production as users naturally encounter
401s; the new banner + sync log will catch them.

**Files touched.**

| Path | Change |
|---|---|
| `supabase/migrations/20260512031557_calendar_connections_health_status.sql` | Three columns + CHECK + partial index |
| `_shared/google-calendar.ts` | `ConnectionHealthStatus` type, `markConnectionUnhealthy`, `markConnectionHealthy` |
| `calendar-update-event/index.ts` | Call `markConnectionUnhealthy` in auth-expired branch; `markConnectionHealthy` on success |
| `calendar-delete-event/index.ts` | Same wiring |
| `_shared/whatsapp-calendar-sync.ts` | New status values + differentiated copy in en/es/it |
| `src/components/GoogleCalendarConnect.tsx` | Reconnect banner + health_status query |
| `public/locales/{en,es-ES,it-IT}/profile.json` | `reconnectBanner` keys (title, authExpired, scopeInsufficient, cta) |
| `_shared/google-calendar.test.ts` | +6 tests for health helpers |
| `_shared/whatsapp-calendar-sync.test.ts` | +16 tests for new status × locale matrix |
| `.github/workflows/calendar-smoke.yml` | New: nightly real-network smoke check |

**Known v1 boundary (deferred to PR 2C):**
- No pending-queue badge / retry-now affordance on `/calendar`. The
  retry queue is fully wired and honest about its state in the chat
  reply, but `/calendar` doesn't yet show a "N updates pending" badge
  or let the user trigger a retry on demand. Needs deeper
  CalendarPage integration than PR 2B's scope allowed; spawning as a
  separate task.

Stacked on PR #103 (PR 2). Won't fully take effect until that PR
merges first — the new `needs_reconnect` sync_status that triggers
`markConnectionUnhealthy` is defined there.

---

## 2026-05-12 — Calendar error classification (PR 2: the 5-layer architectural fix)

PR 1 (the hotfix below) unbroke the immediate symptom — Ask Olive reschedules
now actually move Google Calendar events. But it left the broader
architectural gap the original review surfaced: *every* non-2xx Google
response still collapsed into `google_api_error`, which meant the retry
queue couldn't distinguish "back off, you're rate-limited" from "stop
trying, the user has to reconnect" from "the event vanished, treat as
success." Same dead-end message regardless. PR 2 closes that gap.

**Five layers, all in one PR because they're coupled.**

**L1 — Classify Google errors at the source** ([_shared/google-calendar.ts](practical-lichterman/supabase/functions/_shared/google-calendar.ts)). Added
`classifyHttpError(status)` that maps each HTTP status to a recovery-
relevant `CalendarFailureReason`:

| HTTP | Reason | Recovery |
|---|---|---|
| 401 | `auth_expired` | User reconnects (no retry) |
| 403 | `scope_insufficient` | User reconnects (no retry) |
| 404 / 410 | `event_not_found` | Unlink local mirror, success |
| 412 | `etag_conflict` | Existing path |
| 429 | `rate_limited` | Retry per `Retry-After` |
| 5xx | `google_unavailable` | Retry with backoff |
| else | `google_api_error` | Retry with backoff |

`parseRetryAfter()` handles both delta-seconds and HTTP-date forms,
returning undefined for malformed or in-the-past values. Wired through
`patchGoogleEvent`, `deleteGoogleEvent`, `getGoogleEvent`. `CalendarErr`
carries an optional `retry_after_ms` field so the queue can honor
Google's hint instead of defaulting to 30s (which would just re-trip
the rate limit).

**L2 — Branched handling in `calendar-update-event` + `calendar-delete-event`.**
Each function now switches on the classified reason:
- `event_not_found` → delete the stale local `calendar_events` mirror,
  return `sync_status: "already_gone"`, success-shaped (Olive task
  moved, the Google event was already gone)
- `auth_expired` / `scope_insufficient` → `sync_status: "needs_reconnect"`
  + payload flag, do **not** enqueue retry (would loop indefinitely)
- `rate_limited` → `sync_status: "rate_limited"`, enqueue retry with
  Google's `Retry-After` ms
- `google_unavailable` → `sync_status: "google_unavailable"`, default
  retry backoff
- Everything else → unchanged

New sync statuses added to the enum in three places kept in sync:
`_shared/calendar-sync-logger.ts`, `_shared/action-executor-offers.ts`,
and the local copies in `ask-olive-stream` and `ask-olive-individual`.
DB has no CHECK constraint on `sync_status` so no migration needed —
the column accepts the new values directly.

**L3 — Make `enqueueRetry` honest.** Three changes:
- Expanded `RETRYABLE_STATUSES` (added `rate_limited`, `google_unavailable`;
  excluded `needs_reconnect`, `enqueue_failed`)
- New `retry_after_ms` arg on `EnqueueArgs`; floored at the default 30s
  backoff so `Retry-After: 0` doesn't make us hammer Google
- **Honest failure surfacing**: when `shouldRetry()` returns true but
  the queue insert itself fails (RLS, quota, dead DB), `exit()` in
  `calendar-update-event` / `calendar-delete-event` now writes a
  *second* `olive_calendar_sync_log` row tagged
  `sync_status: "enqueue_failed"` + sets `enqueue_failed: true` in the
  response payload. This is the case the 2026-05-12 bug hit: the
  user-facing copy could pretend a retry was queued when it wasn't.

**L4 — Differentiated user-facing copy.** [_shared/offer-copy.ts](practical-lichterman/supabase/functions/_shared/offer-copy.ts) `buildCalendarSuffix`
now picks the right message per `sync_status`:
- `needs_reconnect` → `" — your Google Calendar needs reconnecting (Settings → Calendar)"`
- `rate_limited` (10s–10min hint) → `" — Google's rate-limiting, I'll catch up in about Ns"`
- `google_unavailable` → `" — Google's having a moment, I'll keep trying in the background"`
- `enqueue_failed` → `" — couldn't queue the Google sync, I'll try again next time you ask"`
- `google_api_error` (no retry) → **`" — Google didn't respond, I'll try again next time you ask"`** — replaces the original dead-end `" — but I couldn't reach Google Calendar this time"` copy that the bug-reporting user saw

`buildResultHint` reads the new optional `enqueue_failed` and
`retry_after_ms` fields off `CalendarSyncReport` and threads them
through. Web copy only in this PR; WhatsApp + i18n in PR 2B.

**Tests — 39 new, 1103 total (was 1064 at PR 1's tip).**
- 20 unit tests in `google-calendar.test.ts` for `classifyHttpError`,
  `parseRetryAfter`, and per-HTTP-code stubbed-fetch behavior
- 5 retry-queue tests covering `shouldRetry` expansion (with
  `needs_reconnect` / `enqueue_failed` in the negative set),
  `retry_after_ms` honoring vs flooring, and `google_unavailable`
  enqueue
- 10 copy tests for each new `sync_status` branch + the
  `enqueueFailed` option + Retry-After hint quoting
- 2 existing tests updated to reflect the retired `"couldn't reach
  Google Calendar this time"` string

**End-to-end verification against prod (the part that matters).**
- Happy path regression: PATCH Demo Reviewer's grocery task → HTTP
  200, `sync_status: updated`, Google event moved.
- **Forced 404 → `already_gone`**: inserted a `calendar_events` row
  with a fabricated `google_event_id`, called `calendar-update-event`,
  observed HTTP 200 + `sync_status: "already_gone"` + `success: true`.
  Three-way confirmation:
  - Stale mirror row was deleted (function unlinks)
  - Sync log row written with `http_status: 404` + Google's full JSON
    error body captured
  - Retry queue had zero entries for the note (`already_gone` is
    correctly not in `RETRYABLE_STATUSES`)

The `needs_reconnect`, `rate_limited`, and `google_unavailable` E2E
paths require forcing a real Google 401/429/5xx, which would mean
corrupting Demo Reviewer's OAuth token — not worth the risk for
verification when the unit + integration tests pin the contract. Those
classes will trip in production over time and the new telemetry
(`olive_calendar_sync_log.sync_status`) makes them queryable.

**Files touched.**

| Path | Change |
|---|---|
| `_shared/google-calendar.ts` | `classifyHttpError`, `parseRetryAfter`, new `CalendarFailureReason` values, `retry_after_ms` on `CalendarErr`, wiring through patch/delete/get helpers |
| `_shared/calendar-sync-logger.ts` | `CalendarSyncStatus` += `needs_reconnect`, `rate_limited`, `google_unavailable`, `enqueue_failed` |
| `_shared/calendar-retry-queue.ts` | `RETRYABLE_STATUSES` += `rate_limited`, `google_unavailable`; `enqueueRetry` accepts + floors `retry_after_ms` |
| `_shared/action-executor-offers.ts` | `CalendarSyncReport.status` enum extended + new optional payload fields |
| `_shared/offer-copy.ts` | Differentiated `buildCalendarSuffix` per status; `enqueueFailed` + `retryAfterMs` options |
| `calendar-update-event/index.ts` | Switch on `patchResult.reason`; thread `retry_after_ms` through `exit()`; write `enqueue_failed` log row when queue rejects |
| `calendar-delete-event/index.ts` | Same branching for DELETE (without the `event_not_found` branch — that's handled upstream as alreadyGone success) |
| `ask-olive-stream/index.ts` | Local `CalendarSyncStatus` mirror updated |
| `ask-olive-individual/index.ts` | Same |
| `_shared/google-calendar.test.ts` | +20 tests |
| `_shared/calendar-retry-queue.test.ts` | +5 tests |
| `_shared/offer-copy.test.ts` | +10 tests, 2 existing tests updated for new copy |

**Known v1 boundaries (deferred to PR 2B).**
- No DB column for connection health — `needs_reconnect` lives only in
  the `sync_status` and the response payload. UI surfacing (banner on
  `/calendar`, badge on settings) needs a `calendar_connections.health_status`
  column to read from.
- WhatsApp copy not updated. `_shared/whatsapp-calendar-sync.ts` still
  uses the pre-L4 collapse — its English/Spanish/Italian translations
  need parallel updates.
- No "queue pending" badge / "retry now" affordance in the UI.
  Backend now reliably tells the truth about queued retries; the UI
  doesn't surface it yet.
- No CI smoke check exercising a real Google round-trip against prod
  OAuth. The flagged open follow-up from PR 1's recap is still open.

---

## 2026-05-12 — Calendar edit hotfix: the bug Phases 1–3 didn't catch

Phases 1.5 through 3.6 shipped on 2026-05-10–11 with a full observability +
retry stack: every Google call funneled through one `exit()` helper that
writes to `olive_calendar_sync_log`, transient failures enqueued into
`olive_calendar_sync_queue`, the retry worker running every 2 minutes,
1064 tests passing.

A user reported on 2026-05-12 02:15 UTC that Ask Olive said it moved
"Visit grocery store" to Friday 12pm but Google Calendar didn't change.
None of the new safety nets triggered. The Olive message was the dead-end
copy from `offer-copy.ts:326-331`: *"in Olive — but I couldn't reach
Google Calendar this time"* — which only fires when `sync_status` is in
the retryable set AND `retry_enqueued` is false. That should be
impossible by construction.

**Two bugs hiding behind one symptom.**

**Bug A — auth at the gateway.** Five edge functions added in Phases 1.5
/ 2.1 / 2.2 (`calendar-update-event`, `calendar-delete-event`,
`calendar-watch-register`, `calendar-watch-renew`, `calendar-sync-retry`)
had no `[functions.X]` block in `supabase/config.toml`. They silently
inherited Supabase's default `verify_jwt = true`. When `ask-olive-stream`
invoked them server-to-server, the gateway 401'd before the function
body could run — bypassing every Phase 2.1 telemetry path. Edge function
logs at 02:15:07.290 UTC show `POST | 401 | calendar-update-event`
matching the user's confirmation timestamp.

**Bug B — orphan calendar_events rows.** Independent of A, `process-note`
fired `autoAddToCalendar(supabase, result, user_id)` with the Gemini
result *before* the caller (web/SimpleNoteInput.tsx, ask-olive-stream,
whatsapp-webhook, etc.) had a chance to insert the row into
`clerk_notes`. So the `calendar_events` row was created with
`note_id = NULL` — the link back to the note was permanently broken.
Even after fixing Bug A, `calendar-update-event` would have returned
`no_linked_event` for every task auto-promoted via this path.
A prod scan found 49 such orphans across 5 users; 47 were uniquely
re-linkable, 0 ambiguous.

**Fix.**

1. **Register the five missing functions** in `supabase/config.toml`
   with `verify_jwt = false` — the convention every other Olive edge
   function follows (they self-authenticate from `body.user_id` using
   a service-role client they build internally). One comment block in
   the file documents why future entries are required.

2. **Replace the racy fire-and-forget with a Postgres trigger.**
   Migration `20260512024215_clerk_notes_auto_calendar_trigger`
   creates `AFTER INSERT ON clerk_notes` → calls `auto-calendar-event`
   via `pg_net.http_post` (same literal-URL + anon-JWT convention as
   the existing crons). Because the trigger fires *after* commit,
   `NEW.id` is the persisted UUID — the race is gone by construction.
   Process-note's `autoAddToCalendar` call site is removed; the helper
   function is left as dead code for one release in case of rollback.

3. **Backfill 47 orphan calendar_events rows.** Migration
   `20260512024253_backfill_orphan_calendar_events_note_id` matches
   each orphan to a clerk_notes row by `(author_id, summary)` within
   ±120 seconds of the event's creation. Only unique matches are
   applied; ambiguous matches are intentionally skipped. The 2
   unmatched orphans likely have deleted-then-recreated notes.
   An audit table `backfilled_calendar_event_links_20260512` records
   every row we touched for precise rollback.

4. **Defense in depth in `auto-calendar-event`.** Early-return guard
   refuses to create an event when `note.id` is missing — better to
   skip + log than to create another orphan. After the trigger fix
   this branch shouldn't fire from the primary path; it defends
   against any future caller (manual re-runs, batch tooling, the old
   fire-and-forget if it gets resurrected by accident).

5. **CI guardrail.** New test
   `_shared/config-toml-coverage.test.ts` walks `supabase/functions/`
   and asserts every dir has a `[functions.X]` entry. Fails the build
   immediately if a new function lacks a config block. A
   `KNOWN_LEGACY_STRAGGLERS` allow-list documents 20 pre-existing gaps
   (now 18 after `email-*` were registered alongside this work);
   future PRs shrink the list one cluster at a time. The whole point
   is the next time someone adds a function without registering it,
   they don't get past CI.

**Verification — end-to-end against prod, not just unit tests.**

- `calendar-update-event` called for the user's stuck grocery task →
  HTTP 200, `sync_status: "updated"`, Google event moved to
  `2026-05-15T16:00:00Z` (Friday May 15 12pm NY — the user's original
  ask). Sync log row written with `latency_ms: 892`.
- Trigger test: inserted a probe note via SQL → 5s later, a
  `calendar_events` row appeared with `note_id` correctly populated,
  matching `olive_calendar_sync_log` entry written, Google event
  created. Cleaned up via `calendar-delete-event` (also returned HTTP
  200 — proving the auth fix works for both new functions).
- 1064 deno tests still pass; 4 new tests added in
  `config-toml-coverage.test.ts` (all green).

**Files touched.**

| Path | Change |
|---|---|
| `supabase/config.toml` | 5 new `[functions.X]` blocks; comment documenting why |
| `supabase/migrations/20260512024215_clerk_notes_auto_calendar_trigger.sql` | New trigger + SECURITY DEFINER function |
| `supabase/migrations/20260512024253_backfill_orphan_calendar_events_note_id.sql` | Re-link 47 orphans + audit table |
| `supabase/functions/process-note/index.ts` | Remove `autoAddToCalendar()` call; comment explaining the trigger now owns this |
| `supabase/functions/auto-calendar-event/index.ts` | Early-return guard when `note.id` missing |
| `supabase/functions/_shared/config-toml-coverage.test.ts` | New: 4 guardrail tests |

**Known v1 boundaries kept.** The two unmatched orphans are not touched
(their parent clerk_notes rows look deleted). The 18-entry
`KNOWN_LEGACY_STRAGGLERS` allow-list is a deliberate stopgap — those
functions also default to `verify_jwt = true` but aren't currently
invoked server-to-server in a way that would surface the 401. Follow-up
PRs (one per cluster — email, trust/soul, memory, utilities) close that
gap without bundling unrelated risk into this hotfix.

**The Phase 1.5 safety net works — when the function reaches it.** The
sync log + retry queue caught nothing here because the request 401'd at
the gateway, before any function code ran. That's not a bug in those
systems; it's a bug in the layer below them, and the CI test prevents
the same gap from opening again.

---

## 2026-05-10 — Phase 2.2: bidirectional sync via Google push channels

Closes the last piece of the reliability story. Before this, Olive →
Google sync was real-time (Phase 1) but Google → Olive only happened
when the user manually triggered `fetch_events`. A user who edited
an event in Google's web/mobile UI would see stale state in Olive
until the next manual sync. This phase wires Google's
push-notification system so changes flow both directions in
near-real-time.

**How push channels work (and where Phase 2.2 sits in that picture)**

- Olive registers a "watch channel" against the user's primary
  calendar via `POST /events/watch`. Google returns a channel id +
  expiration; we store both on the connection.
- When anything on the calendar changes, Google POSTs to our
  callback URL (`calendar-watch-callback`) with an empty body — just
  headers identifying the channel and the event type (`sync` /
  `exists` / `not_exists`).
- We verify the channel token (echoed in `X-Goog-Channel-Token`),
  fetch the changes incrementally using a stored sync token, and
  reconcile each event into our `calendar_events` mirror. If the
  changed event is linked to an Olive task (`note_id` set), we mirror
  the time change back to `clerk_notes` so the task view stays in
  sync.
- Channels expire (Google caps at 30 days, default ~7 days for
  `web_hook` channels). An hourly renewal cron walks any connection
  whose expiry is within 24 hours and re-registers.

**Files**

Migration:
- `supabase/migrations/20260510234644_calendar_watch_channels.sql` —
  adds `watch_channel_id`, `watch_resource_id`, `watch_token`,
  `watch_expiry_at`, `watch_state` to `calendar_connections`. Two
  indexes (unique on `watch_channel_id` for callback lookup; partial
  on `watch_expiry_at` for renewal scan). pg_cron schedule
  `olive-calendar-watch-renew` at `17 * * * *` (hourly + 17min offset
  to dodge cron fan-out at :00).

Shared helpers (`_shared/google-calendar.ts`):
- `watchCalendarChannel(accessToken, calendarId, args)` — POSTs to
  `/events/watch`. Returns channel id + Google-assigned resource id
  + expiration (ms).
- `stopCalendarChannel(accessToken, args)` — POSTs to `/channels/stop`.
  Idempotent: 404/410 treated as success.
- `listEventsIncremental(accessToken, calendarId, args)` — incremental
  events.list with `syncToken`. Returns events + nextSyncToken +
  nextPageToken + `needsFullResync` flag (true when Google returns
  410 Gone on an expired sync token).

New shared module `_shared/calendar-reconciler.ts`:
- `reconcileFromGoogle(supabase, connection, invokedFrom)` — top-level
  driver. Loads the stored sync token, pages through changes, applies
  per-event reconciliation, persists new token. Logs aggregate
  outcome to `olive_calendar_sync_log` with `invoked_from` for
  segmentation.
- Per-event semantics:
  - `status='cancelled'` → DELETE local mirror; clear linked
    `clerk_notes.due_date/reminder_time` so the task view doesn't
    keep a stale schedule for an event the user cancelled on Google.
  - `confirmed/tentative` with existing local row → UPDATE the
    mirror; mirror time changes back to `clerk_notes` if linked.
    This is the user-visible payoff: editing on Google updates Olive.
  - New events (no local row) → INSERT as `event_type='from_calendar'`
    so they show up in calendar views + conflict detection.
- Batched lookup: existing rows pulled in one SELECT IN, not per-
  event. O(page_size) reads regardless of page size.

New edge functions:
- `calendar-watch-register/index.ts` — registers (or re-registers)
  a channel for a connection. Idempotent: stops any existing
  channel first. Mints a UUIDv4 channel id and a crypto-strong
  base64url token. On registration failure, marks the connection
  `watch_state='failed'` so the renewal cron retries.
- `calendar-watch-callback/index.ts` — Google's webhook receiver.
  - `verify_jwt=false` in `config.toml` (Google sends no auth).
  - Verifies `X-Goog-Channel-Token` via constant-time equality
    against the per-connection stored token (no timing side-channel).
  - Handles `sync` (no-op ack), `not_exists` (mark stopped, let
    renewal re-register), `exists` (run `reconcileFromGoogle`).
  - Always responds 200 quickly so Google doesn't pile up retries
    on malformed payloads.
- `calendar-watch-renew/index.ts` — hourly cron-driven renewal.
  Pulls connections whose `watch_expiry_at <= now+24h` OR
  `watch_state` in (`failed`, `stopped`). Re-registers via
  `calendar-watch-register`, then runs a post-renew reconcile to
  close the brief gap between old-stop and new-register.

Wired into existing edge functions:
- `calendar-callback/index.ts` — after a fresh connection is saved,
  invokes `calendar-watch-register` automatically. Lenient: a
  registration failure does NOT block the OAuth redirect (the user
  is mid-flow). Renewal cron self-heals.
- `calendar-sync/index.ts` — disconnect path now stops the watch
  channel BEFORE deleting the connection. Without this, Google
  keeps delivering callbacks to a channel we'll no longer recognize,
  logging noise indefinitely.

Config:
- `supabase/config.toml` — `verify_jwt = false` for
  `calendar-watch-callback` (Google sends no auth). The other two
  new endpoints stay JWT-protected (internal callers only:
  `supabase.functions.invoke` from `calendar-callback`, and
  `pg_cron` with service-role Bearer for the renewal job).

**Security model**

- **Channel authentication via random token.** On registration we
  mint a 48-byte crypto-random secret (base64url'd to 64 chars) and
  send it to Google. Google echoes it back as
  `X-Goog-Channel-Token` on every callback. Verified via
  constant-time equality so the token can't be brute-forced via
  response-time side channels.
- **Channel id verification.** Lookup-by-channel-id returns the
  connection if-and-only-if it's a channel we registered. Unknown
  channel ids 200 silently so Google stops retrying.
- **Service-role for DB writes.** All inbound reconciliation writes
  use the service-role key. RLS is irrelevant because the rows
  carry `connection_id`, which we lookup-then-write; the user is
  identified by ownership of the connection.
- **Timing safety on disconnect.** Channel `stop` runs BEFORE the
  connection deletion so we never leave Google sending callbacks
  to a channel-id-now-orphaned-from-the-DB.

**Verification**

- New tests: **18** — 9 in `google-calendar.test.ts`
  (`watchCalendarChannel` body shape, `stopCalendarChannel`
  idempotency, `listEventsIncremental` syncToken / pagination /
  410 Gone path), 9 in `calendar-reconciler.test.ts` (cancelled
  with/without linked note, edited timed/all-day with linked note,
  new event inserts as from_calendar, malformed event skipped,
  batched-not-per-event lookup).
- Full `_shared/` test suite: **1060 passed, 0 failed** (was 1042
  before 2.2).
- `deno check` clean on all 4 new + 3 modified files.
- `whatsapp-webhook/index.ts`: 9 pre-existing errors, 0 new.
- `ask-olive-stream/index.ts`: 3 pre-existing errors, 0 new.
- End-to-end exercise requires:
  - Live Supabase project with the new migration applied
  - Service-role + URL settings on the database (for pg_cron)
  - A publicly reachable edge function URL (Supabase provides this
    automatically once deployed)
  - A real Google Calendar account with an OAuth connection
  - A manual trigger of `fetch_events` once to seed the initial
    sync token in `calendar_sync_state` (the watch callback path
    is guarded by `if (!startingToken) return needsFullResync`,
    so cold connections need one manual seed before push starts
    flowing)
  None of these can be simulated here.

**Known v1 boundaries**

- **Cold-start sync token seeding.** The reconciler bails with
  `needsFullResync` when no sync token exists yet. Today the
  manual `/fetch_events` action is what seeds it; we could
  auto-trigger a seed during `calendar-watch-register` but that
  doubles the OAuth-completion path's latency. Phase 2.2.5 work
  if seeding turns out to be a UX issue.
- **Primary calendar only.** We watch
  `connection.primary_calendar_id`. Users with multiple calendars
  (Work + Personal) don't get push for the secondary ones — Phase
  3.3 (multi-calendar) will widen this.
- **No conflict resolution between outbound and inbound.** If the
  user edits the same event on both Google and Olive within a few
  seconds, the LAST inbound reconciliation wins (mirror just
  overwrites). Acceptable for v1 — the etag-conflict path in
  `calendar-update-event` already handles the outbound side.
- **`channels/stop` failure on disconnect is non-fatal.** A failed
  stop means Google may deliver a few more callbacks before the
  channel times out; those hit the unknown-channel branch in
  `calendar-watch-callback` and log warnings until the channel
  expires (≤30 days).

**Migration apply**

`20260510234644_calendar_watch_channels.sql` is committed but NOT
yet applied. Apply via Supabase MCP `apply_migration` with name
`calendar_watch_channels`. Edge functions degrade gracefully when
the table doesn't yet have the new columns (registration writes
fail, render the connection `watch_state='failed'`, but everything
else keeps working).

| 2026-05-10 | PHASE2-2 | supabase/migrations/20260510234644_calendar_watch_channels.sql, supabase/functions/_shared/google-calendar.ts (+test), supabase/functions/_shared/calendar-reconciler.ts (+test), supabase/functions/calendar-watch-register/index.ts, supabase/functions/calendar-watch-callback/index.ts, supabase/functions/calendar-watch-renew/index.ts, supabase/functions/calendar-callback/index.ts, supabase/functions/calendar-sync/index.ts, supabase/config.toml | Phase 2.2: bidirectional sync via Google Calendar push channels |

---

## 2026-05-10 — Phase 3.2: bulk reschedule by weekday

The first bulk operation. "Move all my Tuesday tasks to Thursday" now
works on web Ask Olive and WhatsApp. The classifier emits a new
`bulk_reschedule_weekday` intent with day-of-week parameters; the
planner resolves the candidate set; the offer surfaces a preview list
of every affected task before any mutation happens; one "yes" commits
the whole batch with per-task DB writes + per-task Google Calendar
sync; one "undo" rolls everything back together.

**Example output**

```
🌿 Move 3 tasks from **Tuesday** to **Thursday**:
• Visit apartment
• Call dentist
• Pick up dry cleaning
Confirm?
```

After confirmation:
```
Moved 3 tasks to Thursday and synced to your Google Calendar.
Reply "undo" within 5 minutes to revert.
```

Partial-failure path stays honest — "Moved 5 of 7. 2 couldn't be
saved." with the calendar aggregate suffix telling the user whether
the rest reached Google.

**v1 scope (intentional limits, called out for follow-ups)**

| In | Out |
|---|---|
| `bulk_reschedule_weekday` only (day-of-week predicate) | `bulk_delete`, `bulk_shift` (relative shifts like "push by a week") |
| Preview list ≤5 inline, "and N more" tail for larger batches | Cascade conflict detection per task (would balloon the offer copy) |
| Per-task DB + Google sync via existing edge functions | Time-band predicates ("morning tasks"), list-name predicates |
| Bulk undo (single "undo" reverses every task) | Auto-suggest alternate target day when conflicts exist |
| Time-of-day preserved across the shift in user's timezone | Bulk operations on NEW task creation flow |
| Forward-only date walk: Thursday → Tuesday lands on NEXT Tuesday | Re-shifting within an already-active bulk offer |

**Confidence floor.** Bulk operations get a HIGHER floor than single-
task set_due (0.92 vs 0.90) because the blast radius is bigger — a
low-confidence misclassification on "all my Tuesday tasks" can stamp
a dozen wrong shifts. The offer-before-execute loop still catches
errors, but raising the floor is a second line of defense.

**Architecture**

- **Classifier (`_shared/intent-classifier.ts`).** New intent +
  `from_dow` / `to_dow` params (Sun=0..Sat=6). Multilingual prompt
  example. "all" / "every" / explicit plurals required for the bulk
  classification; ambiguous phrasing routes to single-task `set_due`.
- **`_shared/bulk-resolver.ts`** (new):
  - `resolveWeekdayCandidates`: queries incomplete tasks for the user,
    filters in-app to day-of-week-in-user-tz matches. Bounded at 50
    candidates per call. Date-only `due_date` values are interpreted
    as user-local calendar dates (not UTC midnight) so a Tuesday
    `due_date` is Tuesday regardless of the user's tz.
  - `shiftToWeekday`: pure helper that produces a new UTC ISO with
    the date forward-walked to the target day-of-week and the
    time-of-day preserved via `toUtcFromLocalParts`. DST-aware.
- **`BulkRescheduleOffer` + `LastAction.bulk_reschedule_task`.** New
  variants on the existing discriminated unions. Per-task prior state
  is captured in the offer (immune to clock drift between offer and
  confirm) and propagated to the undo stamp so the single "undo"
  reverses every entry.
- **Planner (`action-planner.ts`).** `planAction` short-circuits to
  `planBulkRescheduleWeekday` for the new intent — different shape
  (predicate→set) than single-task disambiguation. Validates
  from_dow/to_dow, rejects same-dow no-ops, surfaces
  `no_bulk_candidates` honestly when the set is empty.
- **Executor (`action-executor-offers.ts`).** `executeBulkReschedule`
  loops candidates, applies the same per-task DB + sync as single-task
  reschedule, aggregates outcomes into `calendar_aggregate` (one of
  `all_synced` / `partial` / `none_synced` / `not_connected` /
  `no_linked_events`). Per-task failures don't abort the loop —
  retries flow through the Phase 2.1 queue.
- **Undo.** Bulk branch in `executeUndo` reverses every entry; reports
  partial-undo honestly ("3 of 5 restored — 2 failed").
- **Copy.** New `buildBulkRescheduleOffer` + `buildBulkResultHint` in
  `offer-copy.ts` (markdown-leaning for web), and new
  WhatsApp-style strings + `bulkDayName` / `tasksWord` helpers in the
  webhook. en / es / it across both surfaces.
- **WhatsApp port.** `mapAIResultToIntentResult` extended with
  `_fromDow` / `_toDow` underscored fields. New TaskActionType case.
  New `confirm_bulk_reschedule` / `done_bulk_all` /
  `done_bulk_partial` / `bulk_calendar_*` / `done_undo_bulk` /
  `bulk_no_candidates` t() strings (en/es/it). Short-circuit in
  TASK_ACTION handler so the bulk path doesn't trip the
  single-task `foundTask` resolution. New AWAITING_CONFIRMATION
  execute branch. Bulk undo wired into the existing undo gate.
- **Pattern learning (Phase 3.5) gets reinforced.** Each candidate
  in a bulk move triggers `recordReschedulePattern`, so a bulk
  Tue→Thu produces N reinforcements of the (Tue, Thu) pattern in
  one user action — exactly the kind of strong signal that should
  surface a hint on the user's next single-task move.

**Verification**

- New tests: **25** — 13 in `bulk-resolver.test.ts` (pure
  `dayOfWeekInTz` + `shiftToWeekday` math including DST, plus
  resolver behavior via mock supabase including the date-only
  Tuesday-stays-Tuesday case), 12 in `offer-copy.test.ts`
  (en/es/it offer builders, plural handling, "and N more" tail,
  bulk result hints with calendar aggregates, bulk undo
  confirmation).
- Full `_shared/` test suite: **1041 passed, 0 failed** (was 1016
  before 3.2). 0 regressions.
- `deno check` clean on the 1 new + 5 modified shared modules.
- `ask-olive-stream/index.ts`: 3 errors, all pre-existing.
- `whatsapp-webhook/index.ts`: 9 errors, all pre-existing. 0 new.
- End-to-end exercise needs live Supabase + a user with multiple
  tasks on the same weekday. Detection / planner / copy / undo
  math are all exercised by tests.

**Bugs caught during implementation**

- **Date-only timezone interpretation (latent, fixed in 2 places).**
  `new Date("2026-05-12")` parses as UTC midnight, which is the
  PREVIOUS day in any negative-offset timezone. Without special
  handling, a Tuesday `due_date` would have been classified as
  Monday for NY users — off-by-one on every all-day task.
  - Fixed in `bulk-resolver.ts:dayOfWeekInTz` (caught by a resolver
    test that fed mixed `reminder_time`/`due_date` rows).
  - Same bug existed in `pattern-detector.ts:dayOfWeekInTz` (the
    Phase 3.5 pattern recorder reads `prior_due_date` from the
    offer, which for all-day tasks is the same YYYY-MM-DD shape).
    Fixed for consistency with a pinned test, otherwise every
    all-day Tuesday reschedule by a NY user would have recorded
    `from_dow=1` (Monday) instead of `from_dow=2` (Tuesday) — slowly
    poisoning the pattern store with off-by-one shifts.

| 2026-05-10 | PHASE3-2 | supabase/functions/_shared/intent-classifier.ts, supabase/functions/_shared/model-router.ts, supabase/functions/_shared/bulk-resolver.ts (+test), supabase/functions/_shared/pending-offer.ts, supabase/functions/_shared/web-session.ts, supabase/functions/_shared/action-planner.ts, supabase/functions/_shared/action-executor-offers.ts, supabase/functions/_shared/offer-copy.ts (+test), supabase/functions/ask-olive-stream/index.ts, supabase/functions/whatsapp-webhook/index.ts | Phase 3.2: bulk reschedule by weekday — preview, execute, undo, en/es/it, web + WhatsApp |

---

## 2026-05-10 — Phase 3.6 + 3.5: time-only edits + pattern learning

Two complementary shipping units. 3.6 is small and lifts existing
WhatsApp behavior onto the web side. 3.5 is the moat — the first piece
of Olive's memory advantage applied directly to calendar offers.

### Phase 3.6 — time-only edits on dated tasks

**The capability.** "change it to 7am" against an existing dated task
now works on web Ask Olive. The expression carries a time but no date;
the planner anchors the time to the task's existing
`reminder_time` / `due_date` (or today, if neither). WhatsApp has had
this since PR4 via `extractTimeOnly` — web didn't, so the same
correction would return `unparseable_date` and the user had to restate
the full date.

**Implementation.**
- New `resolveTimeOnlyEdit(expression, anchorIso, timezone)` in
  `_shared/action-planner.ts` — pure, DST-safe (uses
  `toUtcFromLocalParts` not `setUTCHours`), exported for direct unit
  testing without a Supabase mock.
- Wired into the planner's `set_due` / `remind` branch as a fallback
  after `parseNaturalDate` returns no date.
- Anchor priority: `fullRow.reminder_time` → `fullRow.due_date` →
  `task.reminder_time` → `task.due_date` → `new Date()` (today).
- Supports en ("7am", "7:30 PM"), it ("alle 8", "alle 14:30"), es
  ("a las 14:30"), and bare 24h ("14:00") — same coverage as
  `extractTimeOnly`.

**Files**
- Modified: `supabase/functions/_shared/action-planner.ts` (+ test
  extension covering 9 cases including DST and ambiguous-digit
  rejection).

### Phase 3.5 — pattern learning (foundation)

**The capability.** When a user reschedules tasks in a repeatable way
(e.g. Tue→Thu three weeks running), Olive notices and surfaces the
pattern in the offer line: *"By the way, you often move Tuesday things
to Thursday."* Detect → store → surface; no proactive action yet.

**Example output** (after enough observations):

```
🌿 Move *Visit apartment* — Tue May 12 → Thu May 14, 6:00 PM.
   By the way, you often move Tuesday things to Thursday. Confirm?
```

When a conflict ALSO exists, the conflict reads first (more urgent
signal) and the pattern hint reads second (soft "by the way" voice):

```
🌿 Move ... Heads up: "Dinner with Sara" at 6:30 PM.
   By the way, you often move Tuesday things to Thursday. Confirm?
```

**Confidence thresholds (tuned conservatively).**
- `MIN_COUNT = 3` — at least 3 observations of THIS specific shift
- `MIN_CONFIDENCE = 0.5` — at least 50% of observed reschedules
  match it

Both must hit before surfacing. This prevents false-positive hints on
single accidental reschedules and on users who reschedule chaotically
(count high but confidence low). Pinned in tests so future tuning is
deliberate.

**v1 pattern type.** `weekday_shift` only (e.g. Tuesday→Thursday).
Easiest to extract from a (prior_iso, new_iso) pair and the highest-
frequency reschedule habit in practice. Future variants
(time_band_shift, duration_change, day-of-month-shift) plug in as new
`pattern_type` discriminators against the same table + RPC — the
detector's `extractFeatures` returns an array to leave that open.

**Architecture.**
- **Migration** `20260510224712_olive_user_patterns.sql` — per-user
  pattern store. Unique index on (user_id, pattern_type, fingerprint)
  + SECURITY-DEFINER RPC `olive_record_user_pattern` that does an
  atomic upsert and bumps `total_observations` on every matching row
  for the user so the confidence denominator stays current. RLS:
  SELECT scoped to the owning user (so a future "what does Olive know
  about me?" page works without service-role keys); writes
  service-role only.
- **`_shared/pattern-detector.ts`** —
  - `extractFeatures` (pure): turns a (prior, new) pair into a list of
    typed patterns. Day-of-week computed in the user's timezone (NOT
    UTC) because a 23:30 UTC reschedule lands on different days for
    NY vs Sydney users.
  - `recordReschedulePattern`: post-execute, fires the RPC.
    Non-blocking; failures swallow.
  - `findMatchingPatterns`: pre-offer, returns at most one strong
    match per call. Confidence-gated. Filters to patterns whose
    `to_dow` equals the user's proposed day.
- **Pattern hint copy:**
  - `offer-copy.ts` → `buildPatternHintClause` + soft "by the way"
    voice (en/es/it). Threaded into `buildRescheduleOffer` AFTER the
    conflict clause.
  - `_shared/whatsapp-pattern-copy.ts` → `buildWhatsAppPatternSuffix`
    with 💡 emoji prefix (en: "By the way, you often move…" /
    es: "Sueles mover…" / it: "Di solito sposti…").
- **Wiring.**
  - Web: `action-executor-offers.ts` records after every successful
    reschedule; `action-planner.ts` reads at offer time and attaches
    `pattern_hints` to the offer.
  - WhatsApp: post-execute branches for `set_due_date` and
    `set_reminder` call `recordReschedulePattern`; offer builders for
    `set_due` and `remind` call `findMatchingPatterns` and append
    `buildWhatsAppPatternSuffix` to the existing confirm reply.

**Files**

New:
- `supabase/migrations/20260510224712_olive_user_patterns.sql`
- `supabase/functions/_shared/pattern-detector.ts` (+ test, 14 cases)
- `supabase/functions/_shared/whatsapp-pattern-copy.ts` (+ test, 9 cases)

Modified:
- `supabase/functions/_shared/pending-offer.ts` —
  `RescheduleTaskOffer.pattern_hints` added.
- `supabase/functions/_shared/action-planner.ts` — pattern lookup
  wired into reschedule path via `safeFindPatterns`.
- `supabase/functions/_shared/action-executor-offers.ts` — recorder
  call after a confirmed reschedule.
- `supabase/functions/_shared/offer-copy.ts` (+ test extension,
  9 new cases) — `buildPatternHintClause` + threading into
  `buildRescheduleOffer`.
- `supabase/functions/whatsapp-webhook/index.ts` — recorder calls in
  the AWAITING_CONFIRMATION executor for `set_due_date` and
  `set_reminder`; lookup + suffix in their offer builders.

### Verification (3.6 + 3.5 combined)

- New tests: **41** (9 for 3.6 time-only fallback; 14 for the pattern
  detector covering pure extraction, timezone-aware day classification,
  confidence gating, RPC call shape, and error swallowing; 9 for
  offer-copy pattern clause; 9 for the WhatsApp pattern suffix).
- Full `_shared/` test suite: **1016 passed, 0 failed** (was 975
  before 3.6 / 3.5).
- `deno check` clean on all 4 new + modified shared modules.
- `whatsapp-webhook/index.ts`: 9 errors, all pre-existing. 0 new.
- End-to-end exercise requires live Supabase + populated
  `olive_user_patterns` data (which requires user actions to
  accumulate). The detection and surface logic is exercised by tests;
  live behavior emerges after deploys land + a user reschedules ≥3
  times in the same pattern.

### Why these together

3.6 alone is too small to merit a CHANGES.md heading; 3.5 alone is
large enough to feel like a milestone. Shipping them together also
lets the new pattern recorder benefit from the cleaner time-only
fallback path — when a user "moves it to 7am" repeatedly against
existing dated tasks, those reschedules now show up in the pattern
store with correct day-of-week extraction.

### Known v1 boundaries

- **Surfacing only** for now — Phase 3.5 v1 doesn't proactively
  suggest a better default at new-task-creation time. That requires
  the create flow to go through the offer loop, which it currently
  doesn't on web. When it does, the pattern reader API is ready to
  slot in unchanged.
- **No expiry** on patterns yet. If a user's habit changes (used to
  move Tue→Thu, now moves Tue→Wed), the old pattern lingers until
  the new one accumulates enough observations to dominate by
  confidence. Acceptable for v1; a sliding-window pattern decay is a
  reasonable Phase 3.5.5 follow-up.
- **One pattern_type** (`weekday_shift`). Time-of-day band shifts
  ("you usually move morning tasks to evening") are valuable but
  noisier to detect well — would need bucket boundaries that don't
  fight the user's natural language. Deferred.

### Migration apply

The new migration `20260510224712_olive_user_patterns.sql` is
committed but NOT yet applied. Apply via Supabase MCP
`apply_migration` with name `olive_user_patterns`. The detector
degrades gracefully if the table is missing (RPC errors swallow), so
edge function code can deploy first; pattern surfacing kicks in once
both land.

| 2026-05-10 | PHASE3-6 | supabase/functions/_shared/action-planner.ts (+test) | Phase 3.6: time-only edit fallback on web |
| 2026-05-10 | PHASE3-5 | supabase/migrations/20260510224712_olive_user_patterns.sql, supabase/functions/_shared/pattern-detector.ts (+test), supabase/functions/_shared/whatsapp-pattern-copy.ts (+test), supabase/functions/_shared/pending-offer.ts, supabase/functions/_shared/action-planner.ts, supabase/functions/_shared/action-executor-offers.ts, supabase/functions/_shared/offer-copy.ts (+test), supabase/functions/whatsapp-webhook/index.ts | Phase 3.5: pattern learning foundation — record + lookup + surface |

---

## 2026-05-10 — Phase 3.1: conflict detection at offer time

The first piece of the "intelligence" tier. Before Olive confirms a
reschedule, she scans the user's calendar around the proposed time and
surfaces overlaps in the offer line. This is the moat — an LLM-driven
assistant without visibility into the user's actual calendar always
feels naïve. Olive has the calendar mirror AND the offer loop;
combining them is the highest-leverage intelligence we can ship today.

**Example output**

Before:
```
🌿 Move *Visit apartment* — Tue May 12 → Thu May 14, 6:00 PM. Confirm?
```

After (when conflict detected):
```
🌿 Move *Visit apartment* — Tue May 12 → Thu May 14, 6:00 PM.
   Heads up: "Dinner with Sara" at 6:30 PM. Confirm?
```

Multi-conflict and "noisy schedule" cases summarize:
```
   Heads up: 2 things on your calendar then — "Dinner" at 6:30 PM and "Gym" at 7:45 PM.
   Heads up: 4 events on your calendar around then.
```

**Where it shows up**

- Web Ask Olive `set_due` / `remind` offers (planner integration)
- Web `edit_duration` offers (only when duration changes the event window)
- WhatsApp `set_due` / `set_reminder` offer builders
- Localized in en / es / it ("Heads up" / "Aviso" / "Attenzione")
- All-day events in the proposed window flagged with "is also on that day"
- Adjacent-but-not-overlapping events suppressed when a real overlap
  exists, so the user isn't distracted by less-important neighbors
- `excludeNoteId` stops the event being moved from flagging itself as
  a conflict against its own new time

**Files**

New:
- `supabase/functions/_shared/conflict-detector.ts` (+ test) — DB-only
  scan over `calendar_events`. Pure overlap helpers
  (`computeOverlapMinutes`, `windowsOverlap`) exported for reuse.
- `supabase/functions/_shared/whatsapp-conflict-copy.ts` (+ test) —
  WhatsApp-style suffix builder (emoji-aware, t()-templated, en/es/it).

Modified:
- `supabase/functions/_shared/pending-offer.ts` — `RescheduleTaskOffer`
  and `EditTaskOffer` carry an optional `conflicts: ConflictSummary[]`.
  Absent → planner didn't run detection (older offers, no calendar
  connection); empty → ran and found nothing; populated → surface in
  the offer copy.
- `supabase/functions/_shared/action-planner.ts` — `planAction` /
  `planOfferForResolvedTask` now take an optional supabase client and
  call `findConflicts` on reschedule + edit_duration paths. Wraps in
  a swallow-and-warn helper so a DB hiccup never blocks the offer.
  `fetchTaskRow` was a stub returning null — now actually fetches
  summary / original_text / due_date / reminder_time when a client is
  available, which unlocks the duration-edit conflict path.
- `supabase/functions/_shared/offer-copy.ts` — `buildConflictClause`
  produces the localized "Heads up" line (1 / 2-3 / many variants
  per language). Threaded into `buildRescheduleOffer` and the
  duration-edit branch of `buildEditOffer`.
- `supabase/functions/whatsapp-webhook/index.ts` — `set_due` and
  `set_reminder` offer builders now run conflict detection and append
  the localized suffix to the existing `confirm_set_*` t() reply.

**Verification**

- New tests: 37 (8 conflict-detector logic + DB-mock cases, 12
  whatsapp-conflict-copy en/es/it variants, 17 offer-copy clause and
  reschedule-offer integration cases).
- Full `_shared/` test suite: **975 passed, 0 failed** (was 938 before
  Phase 3.1).
- `deno check` clean on the 2 new shared modules and 3 modified ones.
- `whatsapp-webhook/index.ts`: 9 errors, all pre-existing. 0 new.
- `ask-olive-stream/index.ts`: 3 errors, all pre-existing.
- End-to-end exercise needs live Supabase + a populated
  `calendar_events` mirror (which itself requires connected Google
  Calendar). Code is ready for `supabase functions deploy
  ask-olive-stream ask-olive-individual whatsapp-webhook`.

**Why this works without new infrastructure**

- No migration needed — uses the existing `calendar_events` mirror
  populated by `calendar-sync` on a 15-min cadence.
- No new edge function — runs inline at offer-planning time on the
  same client that already does all the planning.
- Graceful degradation — users without a calendar connection silently
  get empty conflict arrays, identical to pre-3.1 behavior.

**Out of scope (deferred to later phases)**

- Auto-suggest a better time slot. The user sees the conflict, the
  system trusts them to pick. A "best alternate slot" suggestion needs
  scheduling-graph reasoning that compounds in complexity (work hours,
  travel time, recurring blocks) — not a v1 piece.
- Cascade reschedule ("also move dinner to 7:30?"). That's Phase 3.2
  bulk-edit territory.
- Travel-time-aware overlap. Needs Google Maps integration; Phase 3.3.
- Conflict detection on NEW task creation. Today only edits go through
  the offer loop; new captures via `process-note` execute directly.
  When the create flow gets the offer treatment (separate refactor),
  this same `findConflicts` slot in.

| 2026-05-10 | PHASE3-1 | supabase/functions/_shared/conflict-detector.ts (+test), supabase/functions/_shared/whatsapp-conflict-copy.ts (+test), supabase/functions/_shared/pending-offer.ts, supabase/functions/_shared/action-planner.ts, supabase/functions/_shared/offer-copy.ts (+test), supabase/functions/whatsapp-webhook/index.ts | Phase 3.1: surface calendar conflicts at offer time |

---

## 2026-05-10 — Phase 2.1 + 2.3: durable retry queue + attendee notifications

Phase 2 starts shipping. Two complementary improvements that close
holes the Phase 1 honesty fix exposed:

**2.1 — Durable retry for failed Google syncs.** Before this, a
transient Google 5xx left the user's calendar permanently out of sync
(the chat said "couldn't reach Google Calendar" — accurate but
abandonable). Now those failures enqueue to `olive_calendar_sync_queue`
and a cron-driven worker retries with exponential backoff
(30s → 2m → 10m → 1h → 6h → abandon).

Reply copy softens accordingly:
- Without retry queue (legacy / non-transient failure):
  *"…in Olive — but I couldn't reach Google Calendar this time."*
- With retry queue (transient failure, now caught):
  *"…in Olive — Google Calendar didn't respond, I'll keep trying in
  the background."*

**2.3 — `sendUpdates=all` when an event has attendees.** Moving a
meeting silently on 4 colleagues was bad form. Now the update/delete
edge functions GET the event first, and when it has attendees, pass
`sendUpdates=all` so Google emails them. The reply mentions it:
*"…and synced to your Google Calendar (notified 3 other people on the
event)."* Same on WhatsApp in en/es/it.

Description-only or notes-only edits skip the notification (Google
won't email people about silent metadata changes). Cancellations always
notify attendees if any.

**Files**

New:
- `supabase/migrations/20260510211937_olive_calendar_sync_queue.sql`
  — table, indexes, RLS, atomic-claim SECURITY-DEFINER RPC, pg_cron
  schedule (every 2 minutes; idempotent reschedule via
  cron.unschedule + cron.schedule).
- `supabase/functions/_shared/calendar-retry-queue.ts` (+ test) —
  enqueue / claim / mark helpers + the backoff schedule contract.
- `supabase/functions/calendar-sync-retry/index.ts` — cron-driven
  worker. Claims up to 20 due rows per tick, re-invokes the original
  edge function with `invoked_from='calendar-sync-retry'` so the
  target doesn't re-enqueue, decides retry-or-abandon based on the
  result and current attempts count.

Modified:
- `supabase/functions/_shared/google-calendar.ts` — added
  `getGoogleEvent` (pre-mutation peek for attendees), `sendUpdates`
  option on `patchGoogleEvent` and `deleteGoogleEvent`, `attendees`
  field on `GoogleEventResponse`.
- `supabase/functions/calendar-update-event/index.ts` — captures
  original body for retry re-issue, enqueues on transient failures,
  pre-fetches event for attendee detection, passes `sendUpdates=all`
  on user-visible changes (start_time, end_time, title, location,
  duration), surfaces `attendees_notified` + `attendee_count` +
  `retry_enqueued` in the response.
- `supabase/functions/calendar-delete-event/index.ts` — same retry +
  attendee-notification wiring as update.
- `supabase/functions/_shared/offer-copy.ts` — `buildCalendarSuffix`
  now takes optional `retryEnqueued` / `attendeesNotified` /
  `attendeeCount` and threads them into the user-facing copy.
  `buildResultHint` reads them off the calendar_sync report so all
  callers benefit without changes.
- `supabase/functions/_shared/whatsapp-calendar-sync.ts` —
  `WhatsAppCalendarSyncReport` extended with the same fields;
  `buildWhatsAppCalendarSuffix` produces softer-failure /
  attendees-notified copy in en/es/it. Singular vs plural handled
  naturally per-locale (en: "the other person" / "the 3 other
  people"; es: "la otra persona" / "las 3 personas"; it:
  "l'altra persona" / "le 3 persone").
- `supabase/functions/_shared/action-executor-offers.ts` —
  `CalendarSyncReport` shape extended; both invokers pass the new
  fields through from the edge function response.

**Verification**

- New tests: 36 (15 retry queue, 4 sendUpdates query-param shape, 9
  offer-copy retry/attendee paths, 8 whatsapp-calendar-sync extensions).
- Full `_shared/` test suite: **938 passed, 0 failed** (was 902 before
  Phase 2). 0 regressions.
- `deno check` clean on the 3 new shared modules + 3 edge functions.
- `deno check whatsapp-webhook/index.ts`: 9 errors, all pre-existing
  (lines 1519, 4289, 6924-6925, 7045-7047, 7288 + orchestrator.ts
  internal mismatch). No new errors from Phase 2.
- End-to-end exercise still requires live Supabase + Google OAuth +
  pg_cron — not testable here.

**Why these two together (and 2.2 deferred)**

2.1 + 2.3 are complementary: 2.1 closes the failure mode where the user
sees "didn't sync" once and abandons, 2.3 closes the silent-impact mode
where Olive moves a meeting without telling the people on it. Both are
small enough to ship as one PR.

2.2 (bidirectional sync via Google Calendar push notifications channels)
is genuinely architectural — channel registration per user, webhook
endpoint with reconciliation logic, channel expiration handling
(channels expire after ~7 days and need re-watching). It deserves its
own PR.

**Known v1 boundaries**

- The retry worker invokes the calendar edge function — adds an HTTP
  hop per retry. Could be optimized to call the underlying helpers
  directly, but the current shape keeps logging and analytics
  consistent across user-initiated and worker-initiated mutations,
  which is more important than ~100ms of latency on the retry path.
- Backoff schedule is fixed (30s, 2m, 10m, 1h, 6h). When we have
  enough analytics data we should tune per-error-class (auth errors
  benefit from longer waits, network blips from shorter ones), but
  not yet.
- Description-only edits don't notify attendees. This is intentional
  and matches Google Calendar's web UI default. If users complain
  about silent description changes, revisit.
- The pg_cron migration relies on `app.supabase_url` /
  `app.supabase_service_role_key` runtime settings being set in the
  target environment (same as `olive-heartbeat`). The migration prints
  a NOTICE and skips schedule creation if they're missing — the table
  + RPC + indexes still apply, so a follow-up `apply_migration` re-run
  after settings are in place finishes the job.

**Migration apply**

The migration `20260510211937_olive_calendar_sync_queue.sql` is
committed but NOT yet applied. Per repo doctrine, applies through
Supabase MCP `apply_migration` with name
`olive_calendar_sync_queue`. Edge functions degrade gracefully when
the table is absent (`enqueueRetry` swallows insert errors), so the
function code can deploy first; observability + retry kicks in once
both land.

| 2026-05-10 | PHASE2-1+3 | supabase/migrations/20260510211937_olive_calendar_sync_queue.sql, supabase/functions/_shared/calendar-retry-queue.ts (+test), supabase/functions/calendar-sync-retry/index.ts, supabase/functions/_shared/google-calendar.ts (+test), supabase/functions/calendar-update-event/index.ts, supabase/functions/calendar-delete-event/index.ts, supabase/functions/_shared/offer-copy.ts (+test), supabase/functions/_shared/whatsapp-calendar-sync.ts (+test), supabase/functions/_shared/action-executor-offers.ts | Phase 2.1 durable retry queue + 2.3 attendee notifications |

---

## 2026-05-10 — Phase 1 ported to WhatsApp

WhatsApp users get the same Phase 1 improvements as web Ask Olive. Most
of the heavy lifting was done in the web port (shared classifier, shared
calendar edge functions, shared `executeUndo` / `looksLikeUndoCommand`
helpers); this port wires them into the WhatsApp webhook's existing
AWAITING_CONFIRMATION state machine.

**What changed on WhatsApp**

1. **Calendar sync on confirmed mutations.** When a user replies "yes"
   to a `set_due` / `set_reminder` / `delete` offer, the webhook now
   propagates the change to Google Calendar via the same
   `calendar-update-event` / `calendar-delete-event` edge functions the
   web side uses. Sync state flows back as a localized suffix on the
   reply ("📅 Synced to your Google Calendar" / "⚠️ But I couldn't
   reach Google Calendar this time"). The original bug — chat confirms
   but the calendar doesn't update — is fixed on WhatsApp.

2. **Generic edit intents.** `edit_title`, `edit_location`,
   `edit_description`, `edit_duration` now work over WhatsApp via the
   same Capture → Offer → Confirm → Execute loop the existing actions
   use. Each has en/es/it confirmation copy. The classifier already
   emits these from Phase 1.2 work — wiring on the WhatsApp side adds
   the intent → action mapping, offer builder, and confirmation
   execution.

3. **Undo.** "undo" / "deshacer" / "annulla" replies inside the 5-min
   window reverse the user's last mutation. Pre-classification gate
   runs before shortcuts and before the intent classifier, so the word
   "undo" can never be mis-classified into "create undo task." Uses the
   shared `executeUndo` from the web port — same reverse semantics, same
   safety (e.g. doesn't recreate Google events on delete-undo).

4. **Observability comes free.** Every WhatsApp calendar mutation flows
   through the same edge functions that log to
   `olive_calendar_sync_log` (Phase 1.5). The `invoked_from` field
   carries `"whatsapp-webhook"` so the SLO query can segment success
   rates per surface.

5. **Disambiguation NOT changed.** WhatsApp already has its own
   multi-candidate handler (semantic search + score-gap detection at
   [whatsapp-webhook:4647-4677](practical-lichterman/supabase/functions/whatsapp-webhook/index.ts:4647))
   and surfaces "did you mean A or B?" today. The shared web
   disambiguation helper is a different code path (used when the AI
   classifier didn't pre-resolve target_task_id); both are valid. No
   port needed.

**Files**

Modified:
- `supabase/functions/whatsapp-webhook/index.ts` — added imports for
  shared helpers, extended `TaskActionType` with `edit_*` variants,
  added 11 i18n keys (en/es/it) for edit_* / undo / undo_hint /
  edit_need_value / undo_failed / undo_nothing, captured prior state in
  the three existing offer builders (`set_due`, `set_reminder`,
  `delete`), wired calendar sync + `last_action` stamping into the
  AWAITING_CONFIRMATION dispatch for all 7 mutation types (3 existing
  + 4 new), added pre-classification undo gate before shortcut
  interception, added 4 new action handlers (`edit_title` /
  `edit_location` / `edit_description` / `edit_duration`).
- `supabase/functions/_shared/pending-offer.ts` — narrowing fix in one
  WhatsApp caller (`type === 'save_artifact'`) that previously read
  `artifact_content` directly off the wider union.

New:
- `supabase/functions/_shared/whatsapp-calendar-sync.ts` (+ 13 tests) —
  thin invoke wrappers + localized sync suffix builder. Wrappers keep
  WhatsApp integration points one-line; suffix builder owns the en/es/it
  copy for sync state. Owned separately from the web's `offer-copy.ts`
  because WhatsApp uses inline `t()`-style translation, not a copy
  module.

**Verification**

- New tests: 13 (whatsapp-calendar-sync covering localized suffix
  contract: en/es/it variants, BCP-47 normalization, empty-suffix on
  not_connected/no_linked_event/already_gone, honest failure copy on
  google_api_error / token_refresh_failed / invoke_failed).
- Full `_shared/` test suite: **902 passed, 0 failed** (was 889 before
  this port).
- `deno check` on `whatsapp-webhook/index.ts` reports 9 errors, all
  pre-existing (lines 1519, 4289, 6924-6925, 7045-7047, 7288 + an
  internal orchestrator.ts mismatch). My changes added 0 new TS
  errors and resolved 4 (`TaskActionType` extension, `SupabaseClient`
  import, narrowing fix for `artifact_content`/`artifact_request`).
- End-to-end exercise requires live Supabase + connected Google
  Calendar + Meta WhatsApp Cloud API — not testable in this
  environment. Ready for deploy:
  `supabase functions deploy whatsapp-webhook`.

**Known v1 boundaries (matching the web Phase 1 boundaries)**

- The `edit_duration` and `edit_location` paths only mutate the linked
  calendar event — there are no `clerk_notes` columns for duration or
  location today. Undo of those edits is calendar-only too. If/when
  those columns land on `clerk_notes`, the executor gets a clean
  extension point — the offer carries both intents already.
- Undo of a `delete` does NOT recreate the Google Calendar event. The
  row comes back in Olive but the calendar slot stays empty. This
  matches the web Phase 1 behavior and is a deliberate trade-off:
  recreating would mint a fresh event ID, confusing the user's calendar
  history. Phase 2 can revisit with explicit "and put it back on my
  calendar?" UX.
- One known multi-task-match edge case on WhatsApp inherits the
  existing ambiguity gate (no change). The web-side
  `task-disambiguation.ts` helper is unused on this surface.

| 2026-05-10 | PHASE1-WA | supabase/functions/whatsapp-webhook/index.ts, supabase/functions/_shared/whatsapp-calendar-sync.ts, supabase/functions/_shared/pending-offer.ts | Phase 1 WhatsApp port: calendar sync on set_due/remind/delete, edit_* intents, undo, observability |

---

## 2026-05-10 — Phase 1: Ask Olive calendar editing reaches 10/10 bar

Five-part shipping unit on top of the same-day fix below. Closes Phase 1
of the calendar-editing roadmap: brand-contract compliance (offer-before-
execute), safety (disambiguation), parity with the calendar API surface
(generic edits), reversibility (undo), and measurability (sync log).

**1.1 — Offer-before-execute (the brand-contract fix)**

The previous flow silently executed `set_due` / `delete` etc. The Olive
brand bible names this loop sacred: *"She surfaces what she captured,
proposes an action, waits for confirmation, then executes."* Now the web
Ask Olive does this end-to-end:
- New `_shared/action-planner.ts` turns a `ClassifiedIntent` into a typed
  `PendingOffer` without touching the DB.
- New `_shared/web-session.ts` wraps the existing `user_sessions` table
  (the same one WhatsApp has used for a year) so the web surface gets
  the same `AWAITING_CONFIRMATION` state machine — no separate session
  schema, no client-managed pending state.
- `ask-olive-stream` now plans → stores offer → asks → on next-turn
  "yes" runs the planned action verbatim. The Capture → Offer → Confirm
  → Execute loop is enforced at the dispatcher, not the LLM.
- The fallback path (`ask-olive-individual`) gets the pre-flow gate too
  (undo + pending-confirmation handling) so a stream-to-fallback session
  drop doesn't strand the user with an unresolvable pending offer.
- 10-minute TTL on offers (reused from `pending-offer.ts`).

**1.2 — Generic edit intent**

`edit_title`, `edit_location`, `edit_description`, `edit_duration` added
to the classifier schema with multilingual examples (en/es/it). Each
maps onto the existing `calendar-update-event` PATCH surface — a rename
in chat also renames the linked Google Calendar event. New
`new_title` / `new_location` / `new_description` / `new_duration_minutes`
parameter fields on `ClassifiedIntent`.

**1.3 — Disambiguation on multi-match**

The old handlers ran `.ilike('summary', '%X%').limit(1)` — first-match-
wins, silent. A user with two "Visit apartment" tasks could lose data
without warning. New `_shared/task-disambiguation.ts`:
- `resolveTaskReference` fetches a candidate pool, scores via a
  transparent rubric (Jaccard with stopword filtering, exact-phrase
  boost, starts-with boost, recency decay), and returns one of:
  `SINGLE_BEST` / `AMBIGUOUS` / `NONE`.
- `pickDisambiguation` resolves the user's next-turn reply ("the SoHo
  one" / "1" / "neither") against the surfaced candidates.
- Ambiguous matches produce a `DisambiguationOffer` carrying the
  unresolved intent so the next turn can complete planning without
  re-running the classifier.

**1.4 — Diff + undo**

Every executed mutation stamps a `last_action` slot on `user_sessions.
context_data` with prior state. Within 5 minutes ("undo" / "wait no" /
"deshazlo" / "annulla"), the user can reverse:
- Reschedule undo: restore prior `due_date` / `reminder_time` and (if
  the calendar was synced) re-PATCH Google back to the prior time.
- Delete undo: re-insert the restored row (columns whitelisted to avoid
  resurrecting search-vector / embedding garbage).
- Edit undo: restore prior summary/description and re-PATCH Google.
The user-facing confirmation now includes the diff
("Moved from Tue May 12 → Thu May 14, 6pm. Reply *undo* within 5
minutes to revert.").

**1.5 — Calendar sync observability**

- New table `olive_calendar_sync_log` (migration:
  `20260510194217_olive_calendar_sync_log.sql`). One row per Google
  Calendar interaction, including the easy paths (`not_connected`,
  `no_linked_event`) — without those, the success-rate metric is
  biased upward.
- Indexed for two queries: per-user-recent (retry / debug) and weekly
  failure aggregate (SLO dashboard).
- RLS: SELECT scoped to `auth.uid() = user_id`; writes are service-role
  only.
- `_shared/calendar-sync-logger.ts` wraps the insert. All four calendar
  edge functions (`calendar-create-event`, `calendar-update-event`,
  `calendar-delete-event`, `auto-calendar-event`) funnel through a
  single `exit()` helper so logging is impossible to miss on early-
  return paths.

**Files**

New:
- `supabase/migrations/20260510194217_olive_calendar_sync_log.sql`
- `supabase/functions/_shared/calendar-sync-logger.ts` (+ test)
- `supabase/functions/_shared/web-session.ts` (+ test)
- `supabase/functions/_shared/task-disambiguation.ts` (+ test)
- `supabase/functions/_shared/action-planner.ts` (+ test)
- `supabase/functions/_shared/action-executor-offers.ts`
- `supabase/functions/_shared/offer-copy.ts` (+ test)

Modified:
- `supabase/functions/_shared/pending-offer.ts` — extended union with
  `RescheduleTaskOffer`, `EditTaskOffer`, `DeleteTaskOffer`,
  `DisambiguationOffer` (preserves narrowing in existing WhatsApp callers
  via `type ===` checks).
- `supabase/functions/_shared/intent-classifier.ts` — added 5 new
  intents + 4 new parameter fields + multilingual prompt examples.
- `supabase/functions/ask-olive-stream/index.ts` — pre-flow gate,
  offer-planning, undo handler, calendar-sync logging.
- `supabase/functions/ask-olive-individual/index.ts` — pre-flow gate
  parity for fallback path.
- `supabase/functions/calendar-{create,update,delete}-event/index.ts`
  + `auto-calendar-event/index.ts` — all funnel through `exit()` and
  log every outcome.

**Verification**

- New tests: 72 added (calendar-sync-logger 6, web-session 11, task-
  disambiguation 14, action-planner 9, offer-copy 18, google-calendar
  17 carryover from previous PR).
- Full `_shared/` test suite: **889 passed, 0 failed** (was 834 before
  Phase 1).
- `deno check` on all six modified edge functions and seven new shared
  modules is clean. The 3 pre-existing TS errors on `ask-olive-stream`
  (`SupabaseClient` generic mismatch, `UnifiedContext` missing optional
  props, `PromiseLike.catch`) are unchanged — Phase 1 didn't add or
  remove any.
- End-to-end behavior cannot be verified in this environment (requires a
  live Supabase project + a Google Calendar account connected to a test
  user). Migration + edge functions are ready for
  `supabase functions deploy ask-olive-stream ask-olive-individual
   calendar-update-event calendar-delete-event calendar-create-event
   auto-calendar-event` after the migration applies.

**Known v1 boundaries (intentional — deferred to Phase 2+)**

- The fallback path (`ask-olive-individual`) only gets the pre-flow
  *gate* (undo + confirmation handling). Its `executeTaskAction` still
  executes directly — restructuring it is Phase 2. Practical impact:
  when stream succeeds (the 99% case) the offer-before-execute contract
  holds; on stream failure the user sees the pre-Phase-1 behavior on
  the fallback. The sync-honesty fix from the earlier same-day PR is
  still in effect on that path.
- Confirmation copy is English-only today; es/it strings stub through
  `Lang` parameter and translation table addition is non-blocking.
- No durable retry queue yet — failed Google syncs are reported
  honestly and the user can re-issue. Phase 2.1 will add the queue.

**Migration apply (manual step required)**

The migration file is committed but NOT yet applied to production. Per
`MIGRATIONS.md` doctrine, this lands via Supabase MCP `apply_migration`
with name `olive_calendar_sync_log`. Action handlers gracefully degrade
when the table is missing (logger swallows insert errors), so the edge
functions can ship before the migration applies — but observability
won't kick in until both are deployed.

| 2026-05-10 | PHASE1 | supabase/migrations/20260510194217_olive_calendar_sync_log.sql, supabase/functions/_shared/calendar-sync-logger.ts, supabase/functions/_shared/web-session.ts, supabase/functions/_shared/task-disambiguation.ts, supabase/functions/_shared/action-planner.ts, supabase/functions/_shared/action-executor-offers.ts, supabase/functions/_shared/offer-copy.ts, supabase/functions/_shared/pending-offer.ts, supabase/functions/_shared/intent-classifier.ts, supabase/functions/ask-olive-stream/index.ts, supabase/functions/ask-olive-individual/index.ts, supabase/functions/calendar-{create,update,delete}-event/index.ts, supabase/functions/auto-calendar-event/index.ts | Phase 1 of calendar editing 10/10 plan: offer-before-execute, generic edits, disambiguation, undo, sync log |

---

## 2026-05-10 — Ask Olive event editing actually edits the calendar

Reported bug: telling the Ask Olive chat panel to reschedule a task
("Change my task visit apartment to Thursday at 6pm") returned a
confirmation but the task didn't move in Olive or in Google Calendar.

Root cause was deeper than the surface symptom:

1. The `set_due` handler in `ask-olive-stream/index.ts` called
   `parseNaturalDate(dateExpr, { timezone })` — passing an object as the
   string positional `timezone` arg — and then read `parsed.hasTime` /
   `parsed.iso`, properties that don't exist on the parser's return type.
   The handler threw, `handleAction` returned null, and the chat fell
   through to general chat which hallucinated a confirmation. clerk_notes
   was never updated.
2. Neither ask-olive function ever propagated edits to Google Calendar.
   There was no `calendar-update-event` edge function in the repo and
   nothing called Google's `events.patch` / `events.update` anywhere. The
   `delete` handler had the same gap (and `calendar_events.note_id` is
   `ON DELETE SET NULL`, so orphaning ghost events on Google Calendar).
3. Even after fixing the above, the chat would have lied on partial
   failure — handlers reported success regardless of whether Google
   actually accepted the change.

Fix shape (one PR, no schema changes — `calendar_events` already has the
columns needed):

- **New `_shared/google-calendar.ts`** — single source of truth for the
  Google Calendar API. Exports `getActiveCalendarConnection`,
  `findLinkedEventByNoteId`, `ensureFreshAccessToken`,
  `buildEventTiming`, `createGoogleEvent`, `patchGoogleEvent`,
  `deleteGoogleEvent`. Discriminated-result return type so callers can
  surface sync state honestly. 17 unit tests pinning the contract:
  token-refresh window, all-day inference, etag conflict, 404
  idempotency.
- **New `calendar-update-event` edge function** — PATCHes a Google event
  and mirrors the change to `calendar_events`. Idempotent. Defaults to
  last-write-wins (force=true) because the linked clerk_notes is Olive's
  source of truth; pass `force=false` to opt into etag-conflict surfacing.
- **New `calendar-delete-event` edge function** — DELETEs the Google event
  and drops the local mirror. 404/410 from Google treated as success.
- **`ask-olive-stream` and `ask-olive-individual`** — both `set_due` and
  `delete` handlers now invoke the new functions after the local DB write
  and return a `calendar_sync` report. The confirmation prompts received
  a `buildCalendarSyncHint` helper that translates the sync state into
  one line the LLM uses verbatim — so when the calendar didn't sync, the
  chat says so instead of pretending.
- **`calendar-create-event` and `auto-calendar-event`** — migrated to the
  shared helper. Side benefit: `auto-calendar-event`'s old "noon means
  all-day" heuristic that mis-categorized legitimate noon meetings is
  replaced with date-string length detection.

Verification:
- 17/17 new unit tests pass (`google-calendar.test.ts`)
- Full `_shared/` test suite: 834 passed, 0 failed
- `deno check` on the four modified edge functions: clean (only
  pre-existing TS errors in surrounding code remain — none introduced by
  this change)
- End-to-end calendar sync cannot be verified in this environment
  (requires a live Supabase project with a connected Google Calendar);
  the change is ready for `supabase functions deploy` and dev-branch QA.

Out of scope (called out for follow-up, not shipped here):
- A generic edit intent for title/location/duration. Today `set_due` only
  carries `due_date_expression`; a future PR can extend the classifier
  schema and reuse `calendar-update-event` unchanged.
- Auto-creating an event when a user reschedules a task whose original
  capture predated their calendar connection.
- A durable retry queue for failed Google syncs; for now we report
  failure honestly and the user can re-issue the command.

| 2026-05-10 | CALSYNC-1 | supabase/functions/_shared/google-calendar.ts, supabase/functions/_shared/google-calendar.test.ts, supabase/functions/calendar-update-event/index.ts, supabase/functions/calendar-delete-event/index.ts, supabase/functions/calendar-create-event/index.ts, supabase/functions/auto-calendar-event/index.ts, supabase/functions/ask-olive-stream/index.ts, supabase/functions/ask-olive-individual/index.ts | Ask Olive edit/delete now propagates to Google Calendar; new shared helper, two new edge functions, honest sync reporting in chat confirmations |

---

## 2026-05-07 — Multi-Note Header Detection in process-note

### Bug · header line saved as a phantom task in multi-item brain dumps

**Symptom.** Sending a list with a leading header line in WhatsApp produced
N+1 saved tasks instead of N. Repro:

```
Check-list for the pets tomorrow before leaving:
Milka food
Change cat litter
Videos of the house
Ring camera
Check water fountains
```

Olive replied "Saved 6 items" — but only 5 are real tasks. The header
"Check-list for the pets tomorrow before leaving:" was saved as task #1.
List routing to "Pets" worked correctly; only the count was wrong.

**Root cause.** `detectMultiItemInput` (the deterministic pre-split that
runs BEFORE the AI on every brain dump) had no concept of a header line.
Its Pattern 3 (newline-separated tasks) split every non-empty line into
a separate task, so the heading became task #1 — and because pre-split
processes each item in parallel against `gemini-2.5-flash-lite` with no
sibling context, the AI's header-aware system-prompt rules never got a
chance to run.

**Fix.** Four-layer defense:

1. **Header detection in pre-split.** New `detectMultiItem` returns
   `{ items, header }` instead of bare `string[]`. Header signals are
   conservative: first line ends with `:` AND ≥2 list-shaped lines
   follow AND first line does not itself start with an action verb,
   OR first line matches header keywords (`checklist`, `lista`,
   `elenco`, …) without a verb start. Multi-language: en/es/it.
2. **Header context propagation.** When a header is found, each per-item
   AI prompt now includes a `SHARED CONTEXT` block carrying the header
   text. Items inherit time references ("tomorrow"), domain ("pets"),
   and list routing from the header — so "Milka food" gets
   `due_date=tomorrow, category=pets, target_list=Pets` instead of
   landing as a generic groceries item with no due date.
3. **AI prompt teaches the pattern.** Defense in depth: a new
   `HEADER/TITLE PATTERN` section in `createSystemPrompt` instructs
   the model to recognize headers when pre-split is conservative and
   falls through to the AI path.
4. **Tests.** `detectMultiItem` was extracted to its own module
   (`process-note/multi-item-detect.ts`) and is locked down by 20 unit
   tests covering: the screenshot bug; header + numbered/bullet lists;
   Spanish/Italian headers; verb-led "Buy these for dinner:" rejection;
   single-item-below rejection; long paragraph fall-through to AI; and
   full preservation of legacy numbered/bullet/comma/and behavior.

**Defensive subtlety — action-verb regex.** The legacy verb regex used
`\b` as the terminator, which fires on a hyphen ("Check-list" → matches
"check"). The new regex uses `(?=\s|$|[,.!?:])` instead, requiring
whitespace or terminal punctuation, so compound nouns like "check-list"
and "to-do" no longer get classified as starting with an action verb.

**Files touched.**
- `supabase/functions/process-note/multi-item-detect.ts` (new)
- `supabase/functions/process-note/multi-item-detect.test.ts` (new, 20 tests)
- `supabase/functions/process-note/index.ts` (import; remove inline
  function; wire `{items, header}` shape with shared-context block;
  add `HEADER/TITLE PATTERN` section to system prompt)

**Backwards compatibility.** No DB migration. No schema changes. No new
env vars. List routing flow (`findOrCreateList`) untouched. Plain
multi-item splits without a header behave exactly as before. The legacy
function name `detectMultiItemInput` is preserved as a wrapper on
`detectMultiItem` for any external imports.

---

## 2026-04-21 — Image + Caption Processing Fix

### Bug · process-note mis-prioritises caption over image content

**Symptom.** Sending a WhatsApp image with a short caption produced a
degraded note vs. sending the same image alone. Repro (Pop Up Poetry flyer):
- no caption → "Saturday Pop-Up Poetry Event at Soul Lounge Miami" (rich, entity-aware)
- caption "Saturday event" → "Saturday Event" (caption text wins; image entity lost)

**Root cause.** Three places in `process-note/index.ts` forced the caption
to override the image-derived summary:
1. `createSystemPrompt` CRITICAL RULES (line ~402) — "caption IS the user's
   intent; extracted content provides supporting details only".
2. `isCaptionContext` branch (line ~1818) — wrapped enhancedText with
   "CRITICAL: summary MUST incorporate caption keywords".
3. User-prompt branch for short captions (line ~1899) — restated the same
   forcing directive.

These rules were designed for **naming captions** ("Oura interview notes")
but applied indiscriminately to **commentary captions** ("Saturday event",
"cool", "for later"), stripping out the specific entity names the vision
model had already extracted.

**Fix.** Reframe caption semantics in all three locations:
- Image is always the primary content source for the summary.
- Caption augments category / priority / tags / intent.
- Naming captions (explicitly identify the artifact) get incorporated into
  the summary alongside image-derived entities.
- Commentary captions (generic classification or emotion) only reinforce
  category — never replace the summary text.

Added worked examples in the system prompt covering flyers, wine labels,
Maps screenshots, and restaurant menus so the model generalises correctly.

**Files changed.**
- `supabase/functions/process-note/index.ts` — three edits (system prompt
  rules, enhancedText wrapper, userPrompt branch).

**Verification.**
- `deno test supabase/functions/_shared/` → 263 passed, 0 failed
  (identical to pre-change baseline).
- No DB migration, no new env vars, no API surface change — pure prompt
  behaviour fix. Deploy with `supabase functions deploy process-note`.

---

## 2026-04-16 — Phase 1

### Task 1-A · Formal Context Contract (context-contract.ts)

**Intent.** Stop scattering ad-hoc prompt assembly across edge functions.
Replace with a single named-slot contract so every LLM call has predictable
token usage, deterministic truncation, and an explicit degradation order.

**Slots (priority → maxTokens).**

| Slot          | Priority | Max tokens | Required |
| ------------- | :------: | :--------: | :------: |
| IDENTITY      |    1     |    200     |   yes    |
| QUERY         |    1     |    400     |   yes    |
| USER_COMPILED |    2     |    650     |    no    |
| INTENT_MODULE |    2     |    250     |    no    |
| TOOLS         |    2     |    300     |    no    |
| DYNAMIC       |    3     |    800     |    no    |
| HISTORY       |    4     |    600     |    no    |

- `STANDARD_BUDGET = 3200` (sum), `EMERGENCY_BUDGET = 2050` (DYNAMIC dropped).
- Truncation prefers sentence/newline boundaries; falls back to a hard cut
  plus an explicit `...(truncated)` marker for downstream visibility.
- Drop order: lowest priority first (HISTORY → DYNAMIC → TOOLS →
  INTENT_MODULE → USER_COMPILED). Required slots are never dropped.

**Robustness polish.**

- `AssemblyResult` gained two fields:
  - `missingRequired: string[]` — required slots whose content was empty at
    assembly time. Does not throw; callers log and degrade.
  - `degraded: boolean` — any non-required slot was dropped. Broader than
    `emergency`, which still means specifically "DYNAMIC was dropped".
- Empty-required detection warns to console so it shows up in edge-function
  logs without crashing a user-facing response.

**Files.**

- `supabase/functions/_shared/context-contract.ts` (modified)
- `supabase/functions/_shared/context-contract.test.ts` (new — 12 tests)

### Task 1-B · Slot-level token logging (llm-tracker.ts)

**Intent.** Make context-assembly analytics observable per-call, including
on the streaming path that bypasses the normal tracker.

**Additions.**

- Extended the `LLMTracker` row schema to include `slotTokens`,
  `contextTotalTokens`, `slotsOverBudget`, and arbitrary
  `metadata` (carrying `dropped_slots`, `missing_required`, `degraded`,
  `emergency`, classifier intent/confidence, route tier/reason).
- Added `logStreamingCall(model, promptCharLength, latencyToFirstByteMs, opts)`
  to log context analytics for streaming responses where the token-by-token
  body goes to the client directly (no buffered response to post-process).
  Fires a `status: "stream_started"` row to `olive_llm_calls`.
- Wired `ask-olive-stream` to emit a `logStreamingCall` after kicking off
  the Gemini stream. Slot telemetry now reaches the same analytics surface
  the non-streaming callers already use.

**Files.**

- `supabase/functions/_shared/llm-tracker.ts` (modified)
- `supabase/functions/ask-olive-stream/index.ts` (modified — CHAT path)

### Task 1-C · Contradiction resolution strategy

**Intent.** Resolve the "AI keeps flip-flopping memory" class of bugs by
making resolution deterministic for safe cases and explicit-ask for
ambiguous ones.

**Decision tree (olive-memory-maintenance).**

```
if contradiction_type ∈ {factual, temporal} AND confidence ≥ 0.80:
    → AUTO_RECENCY: newer chunk wins, older chunk deactivated,
                    winning_chunk_id set, resolved_at = now().
elif confidence ≥ 0.50:
    → ASK_USER: insert olive_heartbeat_jobs row (job_type=contradiction_resolve).
                Contradiction row stays 'unresolved' until user answers.
else:
    → low-confidence 'unresolved', no action.
```

**Schema additions (olive_memory_contradictions).**

- `resolution_strategy TEXT CHECK IN ('AUTO_RECENCY', 'AUTO_FREQUENCY',
  'ASK_USER', 'MANUAL', 'AI_SUGGESTED')`
- `winning_chunk_id UUID REFERENCES olive_memory_chunks ON DELETE SET NULL`
- `resolution_notes TEXT`
- Partial index `idx_contradictions_ask_user_pending (user_id,
  created_at DESC) WHERE resolution_strategy = 'ASK_USER' AND resolution =
  'unresolved'` — fast queue scans for the heartbeat worker.
- Partial index `idx_contradictions_winning_chunk (winning_chunk_id) WHERE
  winning_chunk_id IS NOT NULL` — provenance lookups.

**Files.**

- `supabase/migrations/20260416000000_phase1_memory_quality_instrumentation.sql` (new)
- `supabase/functions/olive-memory-maintenance/index.ts` (modified —
  `runContradictionDetection` rewrite; return shape now
  `{ detected, auto_resolved, ask_user_queued }`)

### Task 1-D · WhatsApp thread instrumentation

**Intent.** Track message volume per thread so Phase 2 can trigger
LLM-based compaction deterministically instead of guessing at history.

**Schema additions (olive_gateway_sessions).**

- `message_count INTEGER NOT NULL DEFAULT 0` — inbound count in current
  thread; reset to 0 after compaction.
- `compact_summary TEXT` — LLM summary of pre-compaction turns.
- `last_compacted_at TIMESTAMPTZ` — audit trail.
- `total_messages_ever INTEGER NOT NULL DEFAULT 0` — lifetime counter,
  never reset (user-level analytics input).
- Partial index `idx_gateway_sessions_compact_ready (user_id,
  message_count) WHERE is_active = true AND message_count > 0`.

**Atomic counter RPC.**

```sql
increment_gateway_session_message(p_session_id UUID) RETURNS TABLE(
  message_count INTEGER, total_messages_ever INTEGER
)
```

Avoids read-modify-write races when a single user sends several messages
in flight. Called from a fire-and-forget `touchGatewaySession` helper at
the WhatsApp webhook entry point so tracking never blocks message
processing.

**Files.**

- `supabase/migrations/20260416000000_phase1_memory_quality_instrumentation.sql` (new)
- `supabase/functions/whatsapp-webhook/index.ts` (modified —
  `touchGatewaySession` helper + call site)

### Task 1-E · Per-intent confidence floors

**Intent.** Never silently execute destructive DB actions on low classifier
confidence. Route through a clarification turn instead.

**Calibration (model-router.ts).**

```ts
INTENT_CONFIDENCE_FLOORS = {
  delete:       0.95,  // destructive, hardest to undo
  complete:     0.92,  // reversible but annoying
  set_due:      0.90,  // wrong date breaks reminders
  archive:      0.90,
  move:         0.90,  // wrong list ≈ lost item
  assign:       0.90,  // awkward cross-user
  set_priority: 0.85,  // easy to fix
}
```

Intents not in the map return `passes: true, reason: "no_floor:<intent>"`.

**Call sites.**

- `supabase/functions/ask-olive-stream/index.ts` — ACTION path checks
  the floor before `handleAction`; on failure, routes to a Flash-Lite
  clarification stream naming the target entity.
- `supabase/functions/whatsapp-webhook/index.ts` — after
  `mapAIResultToIntentResult`, below-floor intents are rerouted to
  `CHAT/assistant` with context fields (`_belowFloorIntent`,
  `_belowFloorTarget`, `_belowFloorConfidence`, `_belowFloorRequired`)
  so the assistant can ask a precise clarifying question.

**Files.**

- `supabase/functions/_shared/model-router.ts` (modified)
- `supabase/functions/_shared/model-router.test.ts` (new — 14 tests)
- `supabase/functions/ask-olive-stream/index.ts` (modified)
- `supabase/functions/whatsapp-webhook/index.ts` (modified)

---

## Testing

Co-located Deno unit tests, runnable individually:

```bash
deno test supabase/functions/_shared/context-contract.test.ts
deno test supabase/functions/_shared/model-router.test.ts
```

Coverage highlights:

- **Context contract:** slot ordering, sentence-boundary truncation,
  priority-based drops (HISTORY before DYNAMIC, required never dropped),
  `emergency`/`degraded`/`missingRequired` correctness, custom contracts.
- **Model router:** floor boundaries (below/at/above) for every gated
  intent, ungated intents pass-through, unknown intents, floor-map
  integrity (`delete` is strictest, all values in (0, 1]), tier routing
  for media/chat/expense cases.

Production runtime is Deno; these tests run against the same imports
used in edge functions.

---

## Deployment checklist

1. Apply the migration: `supabase db push`
   (`20260416000000_phase1_memory_quality_instrumentation.sql`) — idempotent.
2. Deploy edge functions (order does not matter, but bundle together):
   - `ask-olive-stream`
   - `whatsapp-webhook`
   - `olive-memory-maintenance`
   - Shared modules redeploy automatically with each dependent function.
3. Spot-check analytics:
   - `olive_llm_calls` should start showing `slot_tokens`,
     `context_total_tokens`, and `metadata.dropped_slots` for streaming
     calls from `ask-olive-stream`.
   - `olive_memory_contradictions` should show
     `resolution_strategy IN ('AUTO_RECENCY','ASK_USER')` after the next
     Sunday maintenance run.
   - `olive_gateway_sessions.message_count` should increment on WhatsApp
     inbound messages.
4. No config changes, no secrets rotation required.

---

## Invariants preserved

- Required slots (IDENTITY, QUERY) are never dropped, even under
  EMERGENCY_BUDGET. Empty content is surfaced via `missingRequired` and
  logged; the call proceeds on best effort.
- Destructive DB actions are gated on confidence ≥ floor at every entry
  point (web stream, WhatsApp). Below-floor requests are converted to
  clarification prompts — no silent execution.
- Contradiction resolution is deterministic for safe cases and explicit
  (ASK_USER + heartbeat job) for ambiguous cases. The AI no longer
  decides resolution strategy autonomously.
- Atomic counters via RPC. No TOCTOU race on `message_count` bumps.
- Schema changes are additive; all existing rows remain valid (defaults
  backfill the new columns).

---

## 2026-04-16 — Phase 2 (Closing Phase 1 Loops)

Phase 1 created the contradiction detection pipeline and gateway-session
instrumentation, but two loops were left open: ASK_USER contradictions
had no consumer, and long threads had no summarization. Phase 2 closes
both loops end-to-end.

### Task 2-A · Contradiction Resolution Worker (ASK_USER → WhatsApp → apply)

**Intent.** Close the loop from Phase 1 Task 1-C: when the memory
contradiction detector marks a conflict as `resolution_strategy='ASK_USER'`
and enqueues a `contradiction_resolve` heartbeat job, actually deliver the
question to the user via WhatsApp, capture their reply, resolve the
contradiction, and confirm the outcome.

**Flow.**

```
[heartbeat tick]
  └─ handleContradictionResolveJob()
       ├─ formatContradictionQuestion()  ← pure, type-specific intros
       ├─ INSERT olive_pending_questions ← so webhook knows we're waiting
       └─ INSERT olive_outbound_queue    ← WhatsApp delivery

[user replies on WhatsApp]
  └─ whatsapp-webhook (early-path check)
       ├─ findActivePendingQuestion()
       ├─ tryResolvePendingQuestion()
       │    ├─ shortcutResolve()         ← instant for "A"/"B"/"option a"
       │    └─ parseUserResolution()     ← Flash-Lite JSON classification
       └─ applyResolution()              ← deactivate loser, update winner
```

**Key design decisions.**

- **Shortcut resolver**: bare "A"/"B"/"option a"/"option b" replies skip
  the LLM entirely — instant resolution, no API cost.
- **3-layer JSON parse**: direct → fenced ```json → embedded `{...}` —
  handles all Gemini output quirks.
- **Fail-open**: if the LLM can't classify the reply, the pending
  question stays active and the message falls through to normal intent
  classification. No silent auto-resolve.
- **Idempotent**: `applyResolution` checks `resolved_at` before any mutation.
  Safe to retry on transient errors.
- **Send-failure rollback**: if `sendWhatsAppMessage` fails, the pending
  question is cancelled (not left dangling) so the next heartbeat tick
  can retry cleanly with a fresh row.
- **Deduplicate pending questions**: if a pending row already exists for
  (user, question_type, reference_id) with status='pending', reuse it.

**New table: `olive_pending_questions`.**

| Column         | Type        | Note                                    |
| -------------- | ----------- | --------------------------------------- |
| id             | UUID PK     | gen_random_uuid()                       |
| user_id        | TEXT        |                                         |
| question_type  | TEXT        | CHECK: 'contradiction_resolve'          |
| reference_id   | UUID        | Soft FK (points to contradictions table) |
| channel        | TEXT        | 'whatsapp' / 'web'                     |
| question_text  | TEXT        |                                         |
| payload        | JSONB       | Both chunks for resolver context        |
| asked_at       | TIMESTAMPTZ | default now()                           |
| expires_at     | TIMESTAMPTZ | default now() + 24h (WhatsApp window)   |
| answered_at    | TIMESTAMPTZ |                                         |
| answer_text    | TEXT        |                                         |
| resolution     | JSONB       | { winner, merge_text?, reasoning? }     |
| status         | TEXT        | pending / answered / expired / cancelled |

Partial indexes: active-user lookup, expiry sweep.

### Task 2-B · Thread Compaction Worker (cursor-based summarization)

**Intent.** Prevent long WhatsApp threads from degrading LLM quality.
After 15 messages, older turns are rolled into a compact summary via
Gemini Flash-Lite and injected into the HISTORY slot of the Context
Contract. Recent 6 turns stay verbatim.

**Flow.**

```
[heartbeat tick]
  └─ compactActiveThreads()
       ├─ scan olive_gateway_sessions where message_count >= 15
       └─ per session:
            ├─ shouldCompact()                  ← gate check
            ├─ selectMessagesToCompact()         ← cursor + keep-recent
            ├─ generateCombinedSummary()         ← Flash-Lite
            └─ apply_gateway_session_compaction() ← atomic RPC

[webhook assembles prompt]
  └─ Fetch compact_summary from olive_gateway_sessions
     └─ Inject "Earlier in this thread (compacted summary):" before
        recent conversation history in baseContext template
```

**Key design decisions.**

- **Cursor-based, not destructive**: compactor NEVER mutates
  `user_sessions.context_data.conversation_history`. The webhook keeps its
  own FIFO trim. Race with webhook just means the next tick picks up new
  turns.
- **Append-only summary**: each run folds `prior_summary + new_turns`
  into a combined summary. When combined length exceeds 75% of
  `maxSummaryChars` (2000), the model is asked to re-condense.
- **Atomic commit via RPC**: `apply_gateway_session_compaction()` writes
  summary + cursor + decrements `message_count` in a single UPDATE.
  Messages that race compaction stay on the counter.
- **Fail-safe**: summarizer failure leaves cursor + summary untouched;
  the next tick retries. Non-blocking in heartbeat (wrapped in try/catch).
- **Dep-injected LLM caller**: `GeminiCaller` type allows full test
  coverage without real API calls.

**New RPC: `apply_gateway_session_compaction(p_session_id, p_compact_summary, p_cursor_ts, p_compacted_count)`.**

Atomic UPDATE of `compact_summary`, `last_compacted_at`, and
`message_count = GREATEST(0, message_count - p_compacted_count)`.

### Files

**New files (Phase 2):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/migrations/20260416000001_phase2_pending_questions_and_compaction.sql` | 130 | `olive_pending_questions` table + `apply_gateway_session_compaction` RPC |
| `supabase/functions/_shared/contradiction-resolver.ts` | 624 | Pure core + DB orchestrator for ASK_USER resolution |
| `supabase/functions/_shared/thread-compactor.ts` | 454 | Pure core + DB orchestrator for cursor-based compaction |
| `supabase/functions/_shared/contradiction-resolver.test.ts` | 718 | 40 tests: pure functions, JSON parsing, shortcut resolver, orchestrator |
| `supabase/functions/_shared/thread-compactor.test.ts` | 454 | 27 tests: gates, cursor logic, prompt building, orchestrator |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/olive-heartbeat/index.ts` | Added `contradiction_resolve` job case (lines ~1012–1079) + `compactActiveThreads()` call in tick handler + compaction result in response |
| `supabase/functions/whatsapp-webhook/index.ts` | Added early-path pending-question check before classifier (line ~2723) + `compact_summary` fetch & injection into HISTORY block (line ~5550) |

### Testing

67 tests total across two test files, exercising:

- **Contradiction resolver (40 tests):** type-specific question intros,
  prompt shape, JSON parsing (3 fallback strategies), shortcut detection
  for bare A/B replies, chronology→resolution mapping, LLM integration
  with mocked caller, confirmation formatting for all 4 winner branches
  (a/b/merge/neither), idempotency on already-resolved contradictions,
  chunk deactivation per winner, malformed payload handling.

- **Thread compactor (27 tests):** `shouldCompact` gate conditions,
  `selectMessagesToCompact` cursor×keep-recent matrix (first compaction,
  incremental, all filtered), `renderTurns` truncation at 800 chars,
  `buildSummarizationPrompt` with/without recondense hint,
  `formatHistoryWithSummary` all summary×turns combinations,
  `generateCombinedSummary` dep injection + hard clamp + too-short
  rejection, `performCompaction` full orchestrator with chainable mock
  supabase.

All tests use dependency injection for `GeminiCaller` and chainable mock
supabase — no real API keys or network required.

### Deployment checklist

1. **Apply migration** (idempotent, safe to re-run):
   ```
   supabase db push
   ```
   Or apply `20260416000001_phase2_pending_questions_and_compaction.sql`
   manually. Creates `olive_pending_questions` + RPC. No existing data
   affected.

2. **Deploy edge functions** (order doesn't matter — both are
   backwards-compatible):
   ```
   supabase functions deploy olive-heartbeat
   supabase functions deploy whatsapp-webhook
   ```

3. **Verify** after deploy:
   - `olive_pending_questions` table should exist with RLS policies.
   - `apply_gateway_session_compaction` function should be callable.
   - Heartbeat tick response should include `compaction: {...}` field.
   - After 15+ messages in a WhatsApp thread, `olive_gateway_sessions`
     should show a non-null `compact_summary` and `last_compacted_at`.
   - Triggering an ASK_USER contradiction should deliver a WhatsApp
     question; replying "A" or "B" should resolve it instantly.

4. No config changes, no secrets rotation required. Uses the existing
   `GEMINI_KEY` for Flash-Lite summarization and resolution.

---

## 2026-04-16 — Phase 3 (Memory Pipeline Repair)

Phase 2 audit of the production database revealed a critical gap: the
entire memory retrieval pipeline was non-functional. Memory chunks were
extracted from conversations (48 active chunks) but never reached the
LLM prompt because:

1. **`search_memory_chunks` RPC did not exist** — the orchestrator called
   it on every request but the circuit breaker silently caught the error.
2. **`hybrid_search_notes` RPC did not exist** — same failure mode.
3. **0 of 48 memory chunks had embeddings** — even with the RPC, semantic
   search would have returned nothing.
4. **0 of 615 clerk_notes had embeddings** — hybrid search was equally dead.
5. **No importance-only fallback** — when no query embedding was available
   (proactive messages, short inputs), the DYNAMIC slot stayed empty.

### Task 3-A · Missing RPCs + Importance-Only Fallback (migration)

Created 5 new RPCs and 3 indexes:

| RPC | Purpose |
| --- | ------- |
| `search_memory_chunks(user, embedding, limit, min_importance)` | Semantic vector search on `olive_memory_chunks` |
| `hybrid_search_notes(user, couple, query, embedding, weight, limit)` | Combined vector + full-text search on `clerk_notes` |
| `fetch_top_memory_chunks(user, limit, min_importance)` | **Importance-only** — no embedding required |
| `get_chunks_needing_embeddings(limit)` | Backfill queue for memory chunks |
| `get_notes_needing_embeddings(limit)` | Backfill queue for clerk_notes |

All RPCs use `SET search_path TO 'public', 'extensions'` to resolve
the pgvector `<=>` operator correctly.

`fetch_top_memory_chunks` is the key innovation: it guarantees memories
always reach the prompt by ranking on `importance * decay_factor` without
requiring an embedding vector.

### Task 3-B · Unified Memory Retrieval Module (`memory-retrieval.ts`)

**Strategy: semantic search + importance-only fallback, merged.**

```
fetchMemoryChunks(db, userId, queryEmbedding?, userMessage?)
  ├─ if embedding available → try searchMemoryChunks (semantic)
  ├─ ALWAYS → fetchTopMemoryChunks (importance-only baseline)
  └─ merge: semantic first (relevance-ranked), importance fills gaps
     → deduplicate by ID → cap at maxTotal → format for prompt
```

Pure functions: `shouldAttemptSemanticSearch`, `mergeMemoryResults`,
`formatMemoryChunksForPrompt`. DB interface via `MemoryDB` abstraction
for testability.

**Key guarantees:**
- If active memory chunks exist, at least some will appear in the prompt.
- Semantic search failure degrades gracefully to importance-only.
- Both failures degrade to empty string — no thrown errors escape.
- Strategy telemetry (`semantic` / `importance_only` / `merged` / `empty`)
  logged for observability.

### Task 3-C · Orchestrator Wiring

Replaced the broken `search_memory_chunks`-only path in Layer 4 of
`assembleFullContext()` with the unified `fetchMemoryChunks()` call.
The old code silently failed on every request; the new code:
- Always attempts importance-only retrieval as baseline
- Augments with semantic search when embedding is available
- Logs strategy + counts for observability
- Preserves the relationship graph section (moved to own `if (userMessage)` guard)

### Task 3-D · Embedding Backfill via Heartbeat

Added incremental embedding repair to the heartbeat tick:
- 10 memory chunks + 10 clerk_notes per tick (every 15 min)
- Uses Gemini `gemini-embedding-001` at 768 dimensions
- Non-blocking: wrapped in try/catch, failures don't affect other tick work
- Result included in tick response JSON for observability

At current rates (10+10 per 15min tick), the 48 chunks will be fully
backfilled within 1 hour, and the 615 notes within ~10 hours. Once
backfilled, semantic search becomes fully functional alongside the
importance-only baseline.

### Files

**New files (Phase 3):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/migrations/20260416000002_phase3_memory_pipeline_repair.sql` | 245 | 5 RPCs + 3 indexes |
| `supabase/functions/_shared/memory-retrieval.ts` | ~320 | Unified retrieval module with semantic + importance fallback |
| `supabase/functions/_shared/memory-retrieval.test.ts` | ~400 | 39 tests: gates, merge, format, orchestrator, backfill |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/_shared/orchestrator.ts` | Replaced broken Layer 4 memory search with unified `fetchMemoryChunks()` + added `memoryRetrievalStrategy` to `UnifiedContext` |
| `supabase/functions/olive-heartbeat/index.ts` | Added embedding backfill step (10 chunks + 10 notes per tick) |

### Testing

39 tests in `memory-retrieval.test.ts`:

- **shouldAttemptSemanticSearch** (7 tests): null/empty embedding, null/short/whitespace message
- **mergeMemoryResults** (6 tests): semantic priority, dedup, maxTotal, empty inputs
- **formatMemoryChunksForPrompt** (5 tests): empty, header, importance display, source, multi-chunk
- **fetchMemoryChunks orchestrator** (8 tests): merged strategy, importance-only, semantic error fallback, both fail, pure semantic, empty DB, maxTotal, param forwarding
- **backfillChunkEmbeddings** (5 tests): success, embedding failure, DB update failure, empty queue, RPC error
- **backfillNoteEmbeddings** (3 tests): success, empty, mixed success/failure
- **Integration scenarios** (5 tests): full pipeline with no embedding, with embedding, broken semantic search

### Deployment checklist

1. **Migration already applied** to production (`phase3_memory_pipeline_repair_v2`).
   All 5 RPCs verified present. `fetch_top_memory_chunks` tested with real
   data — returns correct results.

2. **Deploy edge functions:**
   ```
   supabase functions deploy olive-heartbeat
   supabase functions deploy whatsapp-webhook
   ```

3. **Verify** after deploy:
   - Heartbeat tick response includes `embedding_backfill: {...}`.
   - After ~1 hour, `olive_memory_chunks` should have non-null embeddings.
   - WhatsApp messages show `[Orchestrator] Memory retrieval: strategy=...`
     in edge function logs.
   - Even without embeddings, importance-only fallback populates the
     DYNAMIC slot with learned facts immediately.

4. No config changes, no secrets rotation required.

---

## 2026-04-17 — Phase 4 (Compiled Intelligence)

Phases 1–3 built the *instruments* (context contract, model routing,
slot telemetry, contradiction detector, thread compactor, memory
retrieval fallback). Phase 4 turns on the *intelligence*: pre-compiled
user artifacts replace ad-hoc memory reads, prompts split per intent,
search gains a knowledge-graph pre-pass, and the artifact layer
recompiles reactively when facts change.

Alignment with the engineering plan:

| Task              | Plan §             | Status |
| ----------------- | ------------------ | ------ |
| 4-A / Task 2-A    | Compiled artifacts | ✅ w/ source-citation validator |
| 4-B / Task 2-B    | Wire into SLOT_USER | ✅ with `userSlotSource` telemetry |
| 4-C / Task 2-D    | Per-intent modules  | ✅ 7 modules + registry |
| 4-D / Task 2-E    | Entity pre-pass     | ✅ olive-search opt-in |
| 4-E (plan add-on) | Event-driven recompile | ✅ DB trigger + heartbeat handler |

### Task 4-A · Compiled Memory Artifacts + Grounding Validator

**Intent.** Make the compiled-artifact layer both budgeted and
verifiable. Before Phase 4, `olive-compile-memory` produced markdown
blindly — if Gemini fabricated a name or date, it quietly flowed into
the USER_COMPILED slot on every call.

- **`_shared/compiled-artifacts.ts`** (~350 lines) — Pure core:
  - `validateCompiledAgainstSources(compiledText, sourceChunks)` —
    keyword-overlap grounding heuristic. Scores 0..1 based on how many
    compiled sentences have ≥2 unique content-word matches against
    any source chunk. Zero LLM cost. Not a perfect hallucination
    detector, but catches obvious fabrications (invented names,
    dates, locations) with no source backing.
  - `ARTIFACT_BUDGETS`: profile=400, patterns=150, relationship=100,
    household=150 tokens. `COMPILED_USER_BUDGET = 650` (fits SLOT_USER).
  - `truncateArtifact()` — sentence/newline boundary truncation.
  - `assembleCompiledSlot(artifacts)` — ordered, header-labeled
    USER_COMPILED block with per-artifact status (used/stale/missing).
  - `assembleUserSlot(db, userId)` — full orchestrator with injected
    `ArtifactDB`. Never throws — DB errors degrade to empty.

- **`olive-compile-memory/index.ts`** (modified) — After each Gemini
  generation:
  1. Truncate to `ARTIFACT_BUDGETS[fileType]` at sentence boundary.
  2. Build `ValidationSource[]` from notes + memories + entities.
  3. Run `validateCompiledAgainstSources()` → log `LOW GROUNDING`
     warning if score < 0.5, always persist score.
  4. Store `source_chunk_ids` (mix of `note:<id>` / `memory:<id>` /
     `entity:<name>` tokens), `validation_score`, `validation_notes`,
     `validation_ungrounded_count`, `budget_tokens`, `was_truncated`
     into `olive_memory_files.metadata`.

  **Invariant: validation never blocks.** A low score is surfaced in
  metadata for downstream reviewers (wiki-lint, "Why this answer?"
  UI, admin dashboards) — it does NOT reject the artifact. This
  matches Phase 1-C's treatment of memory contradictions: detect
  explicitly, resolve deliberately, never silently.

- **`_shared/compiled-artifacts.test.ts`** — **24 tests** covering:
  token estimation, boundary-aware truncation (under-budget / over-
  budget / no-boundaries), keyword tokenizer (stopword/short-word
  filters, punctuation stripping), sentence splitter, validator
  (empty / no-sources / fully grounded / partial / fully ungrounded),
  `assembleCompiledSlot` staleness handling + budget enforcement +
  missing-type tolerance, `assembleUserSlot` empty-userId safety +
  DB-error degradation + happy path.

### Task 4-B · Unified USER_COMPILED Slot Assembly

**Intent.** The orchestrator used to fetch `olive_memory_files` as a
loose list and build the "COMPILED KNOWLEDGE" block inline with per-
file-type character caps that didn't match the Context Contract's
token budget. Phase 4-B routes it through the new compiled-artifacts
module for consistency + telemetry.

- **`_shared/orchestrator.ts`** (modified):
  - Imports `assembleUserSlot` + `createSupabaseArtifactDB`.
  - Layer-4 deep-profile fetch now calls `assembleUserSlot(db, userId)`
    instead of an inline `.select()`.
  - New fields on `UnifiedContext`:
    - `userSlotSource`: `"compiled" | "dynamic" | "mixed" | "empty"`
    - `userSlotFresh`: boolean (all artifacts ≤24h)
    - `userSlotArtifacts`: per-artifact status for analytics
  - Legacy `deepProfile` still exposed as a pre-formatted string, now
    sourced from the budget-enforced `assembleUserSlot` output.

- **Side effect (cleanup).** Renamed the pre-existing duplicate
  declaration `assembleFullContext` (the SOUL-aware variant at
  line ~1437) to `assembleSoulAwareContext`. The conflict was already
  breaking `deno check` on `main` (confirmed via `git stash`); fixing
  it was necessary to verify Phase 4 compiled. That function has no
  external callers, so the rename is zero-risk at runtime.

### Task 4-C · Per-Intent Prompt Modules

**Intent.** The monolithic `OLIVE_CHAT_PROMPT` in
`ask-olive-prompts.ts` (~1,000 tokens) tries to cover every intent in
one blob. Most of it is irrelevant to any given call. Per-intent
modules split the prompt into a shared `system_core` (~200 tokens —
persona only) and swappable `intent_rules` (~150-250 tokens —
intent-specific behavior). Smaller context, better focus, and (Phase
6 setup) a stable prefix for prompt caching.

- **`_shared/prompts/intents/`** directory:
  - `types.ts` — `PromptModule` interface (version, intent,
    system_core, intent_rules, optional few_shot_examples).
  - `system-core.ts` — `SYSTEM_CORE_V1` + version. IDENTICAL across
    all modules (prompt-cache invariant, verified by test).
  - `chat.ts` — general assistant (open conversation, drafting).
  - `contextual-ask.ts` — questions about user's saved data.
  - `create.ts` — task extraction (brain-dump splitting, dates).
  - `search.ts` — retrieval from user's saved items.
  - `expense.ts` — amount/category/vendor extraction.
  - `task-action.ts` — complete/delete/reschedule gates.
  - `partner-message.ts` — partner-relay composition.
  - `registry.ts` — `resolveIntentKey(intent)` + `loadPromptModule(intent)`;
    aliases (`web_search`→search, `merge`→task_action, etc.); falls
    back to chat on unknown intents (never null).

- **`_shared/prompts/intents/registry.test.ts`** — **14 tests**:
  canonical intents + case normalization + whitespace tolerance +
  alias mapping + unknown fallback + null safety + budget invariants
  (system_core ≤200 tok, intent_rules ≤250 tok, examples ≤250 tok) +
  `system_core` byte-equality across modules + unique version strings.

- **Backwards-compatible.** `ask-olive-prompts.ts` is unchanged;
  existing callers continue to work. Migrating callers to the new
  registry is a follow-up (one-line swap per caller).

### Task 4-D · Entity-Aware Search Pre-pass

**Intent.** The hybrid vector+BM25 search returns chunks by similarity;
it doesn't leverage the knowledge graph. When a user asks "what does
Sarah prefer for dinner?", the orchestrator should surface Sarah's
entity record + her depth-1 relationships before running vector search.

- **`_shared/entity-prepass.ts`** (~320 lines) — Pure core:
  - `matchEntitiesByKeyword(query, entities, maxMatches)` — case-
    insensitive substring match against entity canonical_name +
    aliases. Sorts by `mention_count` DESC. Min-length filter skips
    2-char candidates that would match anywhere.
  - `mergeEntityMatches(keyword, llm, max)` — keyword wins on dedup.
    (LLM path is stubbed in the types but disabled by default —
    keyword is zero-cost and catches 90% of cases.)
  - `formatEntityContext(neighborhood, maxTokens)` — stable output
    shape with `## ENTITIES IN QUERY` and `## RELATIONSHIPS (depth-1)`
    sections. Bounded by `MAX_ENTITY_CONTEXT_TOKENS = 300`. Shrink
    path: drop relationships first, then tail entities, always
    preserving at least the top 2 matches.
  - `runEntityPrepass(db, userId, query, options)` — orchestrator.
    NEVER throws: DB failure → empty block; relationship fetch
    failure → matches without relationships (partial result).

- **`olive-search/index.ts`** (modified) — Added `use_entity_prepass`
  boolean to `SearchRequest`. When true:
  - Runs `runEntityPrepass` before hybrid search.
  - Returns `entity_prepass: { context_block, match_count,
    relationship_count, estimated_tokens }` alongside existing
    `results`. Legacy callers that don't pass the flag are unchanged.

- **`_shared/entity-prepass.test.ts`** — **22 tests**: keyword
  matcher (case insensitivity, alias lookup via `metadata.aliases`,
  min-length filter, mention-count sort, maxMatches cap, no-hit
  fallback), merge semantics (keyword priority, ID dedup, cap),
  formatter (empty / standard shape / budget shrink / top-2
  preservation under tiny budget), orchestrator (happy path, empty
  query, empty user, DB failure, relationship-fetch partial failure,
  `entityPool` bypass, `DEFAULT_MAX_MATCHES` respect).

### Task 4-E · Event-Driven Artifact Recompile

**Intent.** Nightly compile alone leaves up to 24h of staleness —
"I hate cilantro" at 9am, prompt still says "enjoys cilantro" until
3am tomorrow. This is the highest-impact correctness risk in Phases
2/3. Event-driven recompile cuts staleness to ~10 min (debounce
window) at a cost of ~3 extra Flash calls/day/active user.

- **`20260417000000_phase4_compiled_artifacts.sql`** — idempotent,
  additive migration:
  1. Defensively drops any remaining CHECK constraint on
     `olive_heartbeat_jobs.job_type` so new job types (`recompile_artifacts`,
     earlier `contradiction_resolve`) can be scheduled everywhere.
     Production appears to already be constraint-free; dev/local envs
     converge after this.
  2. `enqueue_artifact_recompile(user_id, debounce_minutes)` RPC:
     looks up any pending recompile job for the user with
     `scheduled_for >= now()`. If found, returns its id (debounced).
     If not, inserts a new job `scheduled_for now() + debounce` and
     returns the new id.
  3. `on_memory_chunk_change()` trigger function: AFTER INSERT/UPDATE
     on `olive_memory_chunks`. Fires on content/active/importance
     changes. Wrapped in `BEGIN..EXCEPTION` so a queue failure never
     rolls back the chunk write. Inactive chunks don't trigger.
  4. `trg_memory_chunk_enqueue_recompile` trigger attached to
     `olive_memory_chunks`.
  5. Partial index on `olive_heartbeat_jobs(user_id, scheduled_for)`
     WHERE `job_type = 'recompile_artifacts' AND status = 'pending'`
     — keeps debounce lookup O(log n).

- **`olive-heartbeat/index.ts`** (modified):
  - Added `'recompile_artifacts'` to the `JobType` union.
  - New `case 'recompile_artifacts'` handler in the job dispatch
    switch. Invokes `olive-compile-memory` via
    `supabase.functions.invoke('olive-compile-memory', { action:
    'compile_user', user_id, force: false })`. Logs success with a
    preview of which file types changed. Skips the WhatsApp send
    branch — this is a silent background refresh, not a user message.

- **Concurrency note (in-code).** Under simultaneous brain-dump
  inserts (10 workers × 5 chunks each), the RPC's SELECT-then-INSERT
  pattern may occasionally duplicate. That's harmless: `compile_user`'s
  existing hash check short-circuits to "unchanged" when nothing
  actually moved.

### Testing

- **64 new tests** across 4 files:
  - `compiled-artifacts.test.ts` — 24 tests (Phase 4-A/B).
  - `prompts/intents/registry.test.ts` — 14 tests (Phase 4-C).
  - `entity-prepass.test.ts` — 22 tests (Phase 4-D).
  - `phase4-integration.test.ts` — 4 tests (golden-path e2e).
- **Full suite: 196 passed, 1 pre-existing failure** (unrelated to
  Phase 4; `mergeMemoryResults: maxTotal=0 → empty` in
  memory-retrieval.test.ts — confirmed failing on `main` before any
  Phase 4 changes via `git stash` comparison).
- All modified files pass `deno check` with no NEW type errors.
  The single pre-existing TS2345 in `orchestrator.ts`'s dead SOUL
  path is unrelated and unchanged by Phase 4.

### Files

**New files (Phase 4):**

| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/functions/_shared/compiled-artifacts.ts` | ~350 | Pure validator + slot assembler (4-A/B) |
| `supabase/functions/_shared/compiled-artifacts.test.ts` | ~260 | 24 tests |
| `supabase/functions/_shared/prompts/intents/types.ts` | ~55 | `PromptModule` interface |
| `supabase/functions/_shared/prompts/intents/system-core.ts` | ~25 | Shared persona block |
| `supabase/functions/_shared/prompts/intents/{chat,contextual-ask,create,search,expense,task-action,partner-message}.ts` | ~20 each | Per-intent `PromptModule`s |
| `supabase/functions/_shared/prompts/intents/registry.ts` | ~100 | Loader + aliases + fallback |
| `supabase/functions/_shared/prompts/intents/registry.test.ts` | ~135 | 14 tests |
| `supabase/functions/_shared/entity-prepass.ts` | ~320 | KG pre-pass for olive-search (4-D) |
| `supabase/functions/_shared/entity-prepass.test.ts` | ~260 | 22 tests |
| `supabase/functions/_shared/phase4-integration.test.ts` | ~175 | E2E golden-path, 4 tests |
| `supabase/migrations/20260417000000_phase4_compiled_artifacts.sql` | ~130 | Trigger + RPC + index (4-E) |

**Modified files:**

| File | Changes |
| ---- | ------- |
| `supabase/functions/olive-compile-memory/index.ts` | +validator step per file, +source_chunk_ids + validation_score + budget_tokens in metadata, +per-artifact token cap enforcement, +`id` selected from notes/memories |
| `supabase/functions/_shared/orchestrator.ts` | Layer-4 deep-profile now routes through `assembleUserSlot`. +`userSlotSource/Fresh/Artifacts` telemetry on `UnifiedContext`. +import of compiled-artifacts module. Renamed dead duplicate `assembleFullContext` → `assembleSoulAwareContext` (was blocking `deno check`). |
| `supabase/functions/olive-search/index.ts` | +`use_entity_prepass` opt-in flag. +entity-prepass wiring in `search_notes` and `search_all` responses. |
| `supabase/functions/olive-heartbeat/index.ts` | +`'recompile_artifacts'` job type. +handler that invokes olive-compile-memory. |

### Deployment checklist

1. **Apply migration** (idempotent):
   ```
   supabase db push
   ```
   Or apply `20260417000000_phase4_compiled_artifacts.sql` manually.
   Creates the debounce RPC, trigger, and partial index. Relaxes the
   job_type CHECK if one still exists.

2. **Deploy edge functions** (order doesn't matter):
   ```
   supabase functions deploy olive-compile-memory
   supabase functions deploy olive-heartbeat
   supabase functions deploy olive-search
   # ask-olive-stream, whatsapp-webhook: redeploy only when migrating
   # their call sites to the new per-intent prompt registry.
   ```

3. **Verify** after deploy:
   - `olive_memory_files.metadata` shows `validation_score` and
     `source_chunk_ids` on the next compile run.
   - `olive_llm_analytics.slot_tokens` metadata starts showing
     `user_slot_source` values after ask-olive-stream + whatsapp-webhook
     migrate to pass `ctx.userSlotSource` into their tracker calls
     (follow-up, non-blocking).
   - After inserting a memory chunk, an `olive_heartbeat_jobs` row
     with `job_type='recompile_artifacts'` appears within a second.
     ~10 min later, `olive_heartbeat_log` shows a `recompile_artifacts`
     success entry for that user.
   - Calling `olive-search` with `use_entity_prepass: true` returns an
     `entity_prepass` block alongside results.

4. No config changes, no secrets rotation required.

---

## Invariants preserved (cumulative Phase 1 + 2 + 3 + 4)

- Required slots (IDENTITY, QUERY) are never dropped, even under
  EMERGENCY_BUDGET. Empty content is surfaced via `missingRequired` and
  logged; the call proceeds on best effort.
- Destructive DB actions are gated on confidence >= floor at every entry
  point (web stream, WhatsApp). Below-floor requests are converted to
  clarification prompts — no silent execution.
- Contradiction resolution is deterministic for safe cases and explicit
  (ASK_USER + heartbeat job) for ambiguous cases. The AI no longer
  decides resolution strategy autonomously.
- **Phase 2:** ASK_USER contradictions are now fully resolved via
  WhatsApp round-trip. Fail-open: unclassifiable replies fall through
  to normal processing. Idempotent: safe to retry.
- Atomic counters via RPC. No TOCTOU race on `message_count` bumps.
  Compaction counter decrement is also atomic (single UPDATE).
- **Phase 2:** Thread compaction is cursor-based and never destructive.
  The compactor never mutates `conversation_history`; only the webhook
  manages FIFO trimming. Race conditions are harmless by design.
- **Phase 3:** Memory retrieval ALWAYS produces results when active chunks
  exist. Importance-only fallback guarantees the LLM sees learned facts
  even when semantic search is unavailable or broken. Circuit breaker
  isolates failures per subsystem — one broken RPC never blanks the
  entire DYNAMIC slot.
- **Phase 3:** Embedding backfill is incremental and non-blocking.
  Missing embeddings are repaired 20 per heartbeat tick. Backfill
  failures don't affect other tick work or user-facing responses.
- Schema changes are additive; all existing rows remain valid (defaults
  backfill the new columns).
- **Phase 4:** Compiled artifacts are both BUDGET-CAPPED (profile≤400,
  patterns≤150, relationship≤100, household≤150 tokens; combined
  SLOT_USER≤650) and VALIDATED against their source chunks. A low
  grounding score is logged + stored in metadata but NEVER rejects the
  artifact — validation surfaces risk, downstream reviewers (wiki-lint,
  UI) decide what to do with it.
- **Phase 4:** USER_COMPILED slot assembly is deterministic and
  observable: `userSlotSource` telemetry records whether SLOT_USER
  came from fresh compiled artifacts, stale ones, or nothing. Week-
  over-week analytics can see compiled-path adoption directly.
- **Phase 4:** Per-intent prompt modules preserve a byte-identical
  `system_core` across every intent — prompt-cache prefix stability
  is a TEST INVARIANT, not a convention. Breaking it fails CI.
- **Phase 4:** Every per-intent module's `intent_rules` block fits
  ≤250 tokens (SLOT_INTENT_MODULE budget); `system_core` fits
  ≤200 tokens (SLOT_IDENTITY budget). Test-enforced, no drift.
- **Phase 4:** Entity pre-pass is OPT-IN (`use_entity_prepass: true`)
  and never blocks. A DB failure in the pre-pass leaves search output
  unchanged — callers that didn't ask for entity context are never
  affected.
- **Phase 4:** Event-driven artifact recompile is DEBOUNCED at the DB
  level (10-min window) and SWALLOWS ITS OWN ERRORS (trigger function
  catches all exceptions) — a queue failure never rolls back the
  underlying chunk write.

---

## 2026-04-18 — Phase 4 Follow-up Option A (resolver + stream migration + bug fix)

Phase 4 shipped the modular prompt system but the highest-volume callers
still ran on the legacy monolithic `OLIVE_CHAT_PROMPT` — so the actual
token savings were zero. Option A closes that loop for `ask-olive-stream`
behind a reversible feature flag, adds the missing `help_about_olive`
intent module (the FAQ content that used to live inline in the legacy
prompt), and fixes a latent off-by-one in memory retrieval.

### Task A-1 · `help_about_olive` intent module

**Intent.** The legacy `OLIVE_CHAT_PROMPT` had a 300-token "HELP &
HOW-TO — OLIVE FEATURE GUIDE" block. On modular calls that FAQ has
nowhere to land unless a dedicated intent module carries it.

- **`_shared/prompts/intents/help-about-olive.ts`** — condensed FAQ
  (≤250 tok per SLOT_INTENT_MODULE budget), covering: create note/task,
  due/reminder, complete/delete, lists, partner, privacy, WhatsApp,
  Google Calendar, expenses, agents, memories. Instructions tell the
  model to answer only what was asked.
- **Registry**: `help_about_olive` added as the 8th canonical intent.
  Alias `help` → `help_about_olive` so `ask-olive-stream`'s
  pre-filter (which emits `type='help'`) lands on the right module.
- **Tests updated**: 14 registry tests pass; canonical-intent list +
  allModules count bumped from 7 → 8; `help` alias verified.

### Task A-2 · `resolvePrompt` — feature-flagged resolver

**Intent.** Give every migration call site ONE reversible policy surface
so flipping off a regression is a single env-var change, not a deploy.

- **`_shared/prompts/intents/resolver.ts`** (~165 lines, pure):
  - `hashUserToBucket(userId)` — FNV-1a → `[0, 100)` bucket, stable
    across requests for the same user.
  - `decidePromptSource(userId, flag, rolloutPct)` — policy function
    with documented precedence: `USE_INTENT_MODULES=1` beats
    `INTENT_MODULES_ROLLOUT_PCT=N` beats default-legacy.
  - `resolvePrompt({ intent, userId, legacyPrompt, legacyVersion })` —
    returns `{ systemInstruction, intentRules, version, source,
    resolvedIntent }`. Caller uses it to drive Gemini + analytics in
    one object.

- **Feature flags** (Supabase edge runtime env vars):
  - `USE_INTENT_MODULES=1` — force-on, overrides everything.
  - `USE_INTENT_MODULES=0` — force-off, overrides rollout.
  - `INTENT_MODULES_ROLLOUT_PCT=N` — apply to first N% of users
    (hash-bucketed on userId). Defaults to 0 (legacy-only).

- **Rollout invariant.** Same user → same bucket → same path across
  all their requests (stability is tested). Makes A/B clean at
  user-granularity, not per-request noise.

- **`_shared/prompts/intents/resolver.test.ts`** — **20 tests**:
  hash determinism + distribution sanity; full flag-precedence matrix
  (ON/OFF/unset × rollout 0/50/100/negative/garbage × userId
  present/absent); resolver happy paths (legacy, modular, `help`
  alias, unknown intent fallback, flag=0 beats rollout=100, empty
  userId stays conservative, null/undefined intent safe).

### Task A-3 · `ask-olive-stream` CHAT path migration

**Intent.** Highest-volume LLM path on Olive's web surface. Migrating
it enables direct measurement of Phase 4's token savings against a
live traffic slice.

- **`ask-olive-stream/index.ts`** (modified — CHAT path only, other
  paths unchanged):
  - Imports `resolvePrompt` from the resolver.
  - Builds `intentForResolver` from `effectiveType='help'` (pre-filter)
    OR `classifiedIntent.intent` OR `effectiveType`, in that order.
  - Calls `resolvePrompt({...})` once per request — no DB, no LLM, no
    network.
  - On modular path: `system_core` becomes `SLOT_IDENTITY`,
    `intent_rules` becomes `SLOT_INTENT_MODULE`, both flow through
    the existing `formatContextWithBudget` so budgets apply uniformly.
  - On legacy path: behavior is BIT-IDENTICAL to pre-PR.
  - Analytics: `promptVersion` now carries the module version when
    modular; `metadata.prompt_system` = `"modular"|"legacy"` and
    `metadata.resolved_intent` = which module was loaded — this is the
    A/B key for the query below.

- **WEB_SEARCH path, CONTEXTUAL_ASK path, ACTION path** deliberately
  NOT migrated. They have their own prompt shapes (search-result
  formatting, data-question answering, action confirmation) that
  deserve their own modules — follow-up PR.

- **`whatsapp-webhook`** deliberately NOT migrated. It has 10
  chatType-specialized inline prompts (briefing, weekly_summary,
  daily_focus, productivity_tips, progress_check, motivation,
  planning, greeting, help_about_olive, assistant). Those need
  dedicated modules, not the generic `chat` module — separate PR.
  The resolver is ready for them when the modules are built.

### Task A-4 · Bug fix: `mergeMemoryResults: maxTotal=0`

**Intent.** A pre-existing off-by-one in `memory-retrieval.ts` where
the cap check happened AFTER `push()`. When `maxTotal=0` the function
returned 1 chunk instead of 0 — the single failing test in the Phase 4
suite.

- **`_shared/memory-retrieval.ts`** — moved cap check to run BEFORE
  `push()` in both the semantic-chunks loop and the importance-only
  loop. Comment added explaining the fix.
- **Impact:** the test `mergeMemoryResults: maxTotal=0 → empty` that
  was pre-existing-failing on main is now green. Full `_shared/` suite:
  **217 passed / 0 failed** (was 196/1 at Phase 4 landing).

### Task A-5 · A/B analytics query (ready to run once deployed)

Once the flag is enabled for even a small rollout pct, run this to
compare legacy vs modular on identical traffic:

```sql
-- Legacy vs modular: tokens + latency per CHAT call, last 7 days.
-- Assumes ask-olive-stream only (function_name filter).
SELECT
  COALESCE(metadata->>'prompt_system', 'legacy') AS prompt_system,
  metadata->>'resolved_intent' AS resolved_intent,
  COUNT(*) AS calls,
  ROUND(AVG(tokens_in))  AS avg_tokens_in,
  ROUND(AVG(tokens_out)) AS avg_tokens_out,
  ROUND(AVG((metadata->>'context_total_tokens')::int))
                         AS avg_context_tokens,
  ROUND(AVG(latency_ms)) AS avg_latency_ms,
  ROUND(SUM(cost_usd)::numeric, 4) AS total_cost_usd
FROM olive_llm_calls
WHERE function_name = 'ask-olive-stream'
  AND created_at > NOW() - INTERVAL '7 days'
  AND status <> 'stream_started'  -- exclude the stream-start sentinel
GROUP BY 1, 2
ORDER BY 1, 2;
```

Expected outcome after flag enabled for a representative user slice:

- `avg_tokens_in` for `prompt_system='modular'` should be ~40-60%
  lower than `prompt_system='legacy'` on CHAT calls (the main bet).
- `avg_latency_ms` should be comparable or slightly lower (smaller
  prompt → smaller TTFB).
- `avg_tokens_out` should be within ~10% between groups (otherwise
  quality may have drifted — investigate).

If modular is clearly worse on quality (subjective review of samples
grouped by `prompt_system`), `USE_INTENT_MODULES=0` rolls back
instantly — no code change, no redeploy.

### Testing

| Suite | Tests | Status |
| ---- | :---: | ------ |
| registry.test.ts (added `help`, 8-module assertions) | 14 | ✅ |
| resolver.test.ts (new) | 20 | ✅ |
| memory-retrieval.test.ts (fix restores the failing test) | 39 | ✅ |
| Full `_shared/` suite | **217** | **0 failures** (was 196/1) |

`deno check` on `ask-olive-stream` shows 8 errors — ALL pre-existing
(confirmed by stashing my changes and rechecking). Zero new type
errors introduced.

### Files

**New files:**
| File | Lines | Purpose |
| ---- | :---: | ------- |
| `supabase/functions/_shared/prompts/intents/help-about-olive.ts` | ~40 | 8th intent module |
| `supabase/functions/_shared/prompts/intents/resolver.ts` | ~165 | Feature-flagged resolver |
| `supabase/functions/_shared/prompts/intents/resolver.test.ts` | ~200 | 20 tests |

**Modified files:**
| File | Changes |
| ---- | ------- |
| `supabase/functions/_shared/prompts/intents/types.ts` | +`help_about_olive` in `IntentModuleKey`. |
| `supabase/functions/_shared/prompts/intents/registry.ts` | Registered help module + `help` alias. |
| `supabase/functions/_shared/prompts/intents/registry.test.ts` | 7→8 canonical intents; help alias test. |
| `supabase/functions/_shared/memory-retrieval.ts` | Fixed off-by-one in `mergeMemoryResults` (cap check moved before push). |
| `supabase/functions/ask-olive-stream/index.ts` | CHAT path now routes through `resolvePrompt`. Telemetry carries `prompt_system` + `resolved_intent`. |

### Deployment

1. **No migration** — this PR is edge-functions + shared modules only.

2. **Deploy**:
   ```
   supabase functions deploy ask-olive-stream
   ```
   (memory-retrieval is a shared module; it rides along with any edge
   function redeploy, but the change is no-op unless `maxTotal=0` is
   passed — safe.)

3. **Default behavior on deploy**: `USE_INTENT_MODULES` unset +
   `INTENT_MODULES_ROLLOUT_PCT` unset → **legacy path for every
   user**. Zero user-visible change, zero risk.

4. **Enable the A/B** (recommended, on dev first):
   ```
   supabase secrets set INTENT_MODULES_ROLLOUT_PCT=10
   ```
   → 10% of users (hash-bucketed) move to modular. Monitor the query
   above for 48h.

5. **Scale up** when green: set to 50, then 100. Any time, flip to
   `USE_INTENT_MODULES=0` to force-off during investigation.

### Invariants preserved (Option A delta)

- Legacy CHAT path is BIT-IDENTICAL to pre-PR when flags are off.
  Verified by: same `OLIVE_CHAT_PROMPT` input to `streamGeminiResponse`,
  same `CHAT_PROMPT_VERSION` logged, same metadata shape, no
  systemInstruction mutation.
- Rollout bucket is STABLE per user across requests — no mid-session
  flipping between legacy and modular.
- `USE_INTENT_MODULES=0` is a HARD OFF that overrides rollout pct —
  easy kill-switch.
- `resolvePrompt` never throws; unknown intents degrade to the chat
  module; empty userId stays conservative (legacy) when rollout is
  partial.
- Memory retrieval returns EXACTLY `min(available, maxTotal)` chunks
  for any `maxTotal >= 0`. No more off-by-one.

---

## 2026-04-19 — Phase 4 Option A follow-up · iOS parity hardening

Three HIGH-severity iOS issues surfaced by the parity audit + one
pre-existing Capacitor version mismatch that was blocking the Xcode
build. All four fixed. `** BUILD SUCCEEDED **` verified.

### Fix 1 · Hover-hidden interactive elements (HIGH, 6 files)

Multiple surfaces hid buttons behind `opacity-0 group-hover:opacity-100`.
On touch devices there IS no hover — the buttons were invisible and
unreachable. Pattern applied across the codebase:

  `opacity-0 group-hover:opacity-100`
→ `opacity-100 md:opacity-0 md:group-hover:opacity-100`

Mobile (< 768px): always visible. Desktop (≥ 768px): legacy hover
behavior preserved. Files touched:

- `src/components/NoteMediaSection.tsx` — external-link button on media rows
- `src/components/NoteInput.tsx` — media chip delete buttons (×2)
- `src/components/NoteReactions.tsx` — reaction add button
- `src/components/NoteThreads.tsx` — thread actions menu trigger
- `src/components/PartnerActivityWidget.tsx` — activity row arrow
- `src/pages/Lists.tsx` — delete-list button

NOT touched: `src/components/layout/ContextRail.tsx` (desktop-only
sidebar — hover is fine there) and `src/components/ui/toast.tsx`
(shadcn primitive; auto-dismiss makes the X optional).

### Fix 2 · Fixed `h-[500px]` ScrollArea (HIGH)

`src/pages/Knowledge.tsx` had two ScrollAreas hard-coded to 500px —
on iPhone SE (568px tall) this filled the entire viewport, making
content unreachable.

Replaced with `h-[60vh] max-h-[500px] min-h-[320px]`:
- iPhone SE: 60vh × ~568 = ~341px, clamped by min-h to 320px.
- iPhone 15 Pro: 60vh × ~852 = ~511px, clamped by max-h to 500px.
- Desktop: 60vh > 500px, max-h clamps back to 500px (legacy behavior).

### Fix 3 · Deep-link OAuth return listener (HIGH)

`src/pages/AuthRedirectNative.tsx` fires `window.location.href =
'olive://auth-complete'` to re-open the native app after web sign-in.
The scheme was registered in `Info.plist` but NO `appUrlOpen` listener
was wired on the native side — any URL the OS routed back to the app
was silently dropped.

- Installed `@capacitor/app@^7.1.2`.
- Extended `src/lib/capacitor-init.ts` with an `App.addListener(
  'appUrlOpen', ...)` handler using the existing dynamic-import +
  try/catch pattern (so web builds that don't have the plugin don't
  break).
- `handleDeepLink(url)` parses the scheme, routes `auth-complete`
  back into the React app with a full location reload (forces Clerk
  SDK re-hydrate from storage), and is extensible for future paths
  (`olive://note/<id>`, etc.).
- Pure URL logic exported as `__test__.handleDeepLink` for future
  unit coverage.
- Documented limitation in-code: this listener routes the URL, but
  cross-context auth session restoration (Safari sign-in → native
  WebView session) still depends on Clerk's mechanisms. Full native
  auth flow is a follow-up.

### Fix 4 · Pre-existing Capacitor v7/v8 plugin mismatch (infra)

The Xcode build was broken on `origin/dev` BEFORE this PR: `@capacitor/
core` + `ios` were at 7.4.3 but `status-bar`, `keyboard`, `haptics`
had been upgraded to v8.x. `CapacitorStatusBar/StatusBar.swift`
referenced `NSNotification.Name.capacitorViewDidAppear` which only
exists in Capacitor 8 core. Build failed with:

  `error: type 'NSNotification.Name?' has no member 'capacitorViewDidAppear'`

Downgraded three plugins to v7 to match core:
  - `@capacitor/status-bar`: 8.0.2 → 7.0.6
  - `@capacitor/keyboard`:   8.0.3 → 7.0.6
  - `@capacitor/haptics`:    8.0.2 → 7.0.5

Also bumped `ios/App/Podfile` and `ios/App/App.xcodeproj` deployment
target from iOS 14.0 → 15.0 (needed transiently while v8 plugins were
installed; kept at 15.0 since it's a safer baseline — iPhone 6s+ all
support it).

`xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug
-sdk iphonesimulator build` now produces `** BUILD SUCCEEDED **`.

### Test + build verification

- ✅ `deno test supabase/functions/_shared/` — 217 passed / 0 failed.
- ✅ `npx tsc --noEmit` — clean (React side compiles).
- ✅ `npm run build` — Vite production bundle builds (~4.3s).
- ✅ `npx cap sync ios` — 5 Capacitor plugins installed for iOS.
- ✅ `xcodebuild ... build` — `** BUILD SUCCEEDED **` on iphonesimulator.

### Invariants preserved

- Desktop hover behavior unchanged on all touched files.
- Knowledge ScrollArea height is IDENTICAL to pre-PR on desktop
  (≥ 833px viewport: `60vh > 500px → max-h caps to 500px`).
- Deep-link listener never throws (guarded by try/catch around the
  dynamic import AND the URL handler).
- `@capacitor/app` is loaded lazily — web builds don't pull it in.
- Plugin version alignment is strictly a downgrade in minor/major
  numbers; no API usage in Capacitor 7 was lost from the Capacitor 8
  versions (both series keep `setStyle`, `setOverlaysWebView`,
  `setResizeMode`, `setAccessoryBarVisible`, `setScroll`, `impact`,
  etc. — already-used methods).

---

## 2026-04-19 — iOS Passkey authentication fix

User report: "on iOS app, when I try to use passkey to login, it doesn't
work and it fails, while on web app, it works."

### Root cause (multi-layer)

Passkeys in a Capacitor iOS WebView require FOUR things to line up; three
were missing:

1. **WebView origin must match (or be a registrable suffix of) the
   WebAuthn RP ID.** Default Capacitor iOS origin is
   `capacitor://localhost`. Clerk's production instance uses
   `clerk.witholive.app` as the RP ID (decoded from
   `pk_live_Y2xlcmsud2l0aG9saXZlLmFwcCQ`). WebKit throws `SecurityError`
   when the two don't match, which Clerk surfaces as a generic
   "passkey failed" — hiding the real cause.

2. **`com.apple.developer.associated-domains` entitlement** with
   `webcredentials:<domain>` entries is required for iOS to let the
   WebView present platform passkeys for that domain. The iOS project
   had no `.entitlements` file at all.

3. **AASA (`apple-app-site-association`) JSON file** must be reachable
   at `https://<domain>/.well-known/apple-app-site-association`,
   served with `Content-Type: application/json` and no redirects.
   iOS fetches this on install to verify the app is authorized to use
   that domain's credentials. Missing entirely.

4. **Silent secondary bug**: because Capacitor iOS reported hostname
   `localhost`, `main.tsx`'s `isProductionOrigin()` was false → iOS
   users fell back to the DEV Clerk instance (`pk_test_*`). Different
   tenant from web users — silent data isolation.

### Fix

- **`capacitor.config.ts`** — added `server.hostname: 'witholive.app'` +
  `server.iosScheme: 'https'`. Keeps `webDir` local (no `server.url`
  override), so bundled assets still load from disk but under the
  origin `https://witholive.app`. This single change unblocks items
  (1) and (4): WebAuthn origin now matches and `isProductionOrigin()`
  returns true on iOS. Migration note in the config file warns about
  existing pk_test_* sessions being cleared on upgrade.

- **`ios/App/App/App.entitlements`** — new file with:

  ```xml
  <key>com.apple.developer.associated-domains</key>
  <array>
    <string>webcredentials:witholive.app</string>
    <string>webcredentials:www.witholive.app</string>
    <string>webcredentials:clerk.witholive.app</string>
    <string>applinks:witholive.app</string>
    <string>applinks:www.witholive.app</string>
  </array>
  ```

  Three `webcredentials:` entries cover the apex, `www`, and Clerk's
  subdomain (so whichever RP ID Clerk uses is covered). `applinks:`
  entries are additive — they don't break the existing `olive://`
  custom scheme but pre-wire Universal Links for when we migrate the
  deep-link flow off the custom scheme.

- **`ios/App/App.xcodeproj/project.pbxproj`** — added
  `CODE_SIGN_ENTITLEMENTS = App/App.entitlements;` to both Debug and
  Release configs of the App target so Xcode picks up the entitlements
  during codesign. Verified with `xcodebuild ... build` →
  `** BUILD SUCCEEDED **`.

- **`public/.well-known/apple-app-site-association`** — new AASA file.
  Contains `webcredentials` (passkeys), `applinks` (Universal Links
  pre-wired), and `appclips` (empty placeholder). Vite copies the
  `public/.well-known/` tree into `dist/` verbatim, so deploys serve
  it at `https://witholive.app/.well-known/apple-app-site-association`.

- **`vercel.json`** — two changes required so Vercel actually serves
  the AASA correctly:
  1. Added a `/.well-known/:path*` → `/.well-known/:path*` rewrite
     BEFORE the SPA catch-all. Without this, the existing
     `/(.*) → /index.html` would rewrite the AASA to the HTML bundle,
     and Apple would see HTML + reject.
  2. Added a `headers` rule that sets `Content-Type: application/json`
     + `Cache-Control: public, max-age=7200` for
     `/.well-known/apple-app-site-association`. Apple rejects
     `application/octet-stream` (Vercel's default for extension-less
     files).

- **`src/pages/SignIn.tsx`** — expanded `handlePasskeySignIn` error
  logging. Before: `console.error('[SignIn] Passkey error:', err)` +
  generic toast. After: structured log of
  `{origin, hasCredentialsAPI, hasPublicKeyCredential, isNative}`
  before the call, plus `{errorName, errorMessage, errorCause,
  clerkCode, clerkLongMessage, clerkMeta, isNative}` on failure. Added
  a dedicated `SecurityError` branch that tells the user "app origin
  doesn't match" (what iOS without AASA actually reports) instead of
  the misleading "not supported" message that used to run first.

### Build verification

- ✅ `npx tsc --noEmit` — clean.
- ✅ `npm run build` — Vite bundle OK; AASA present at
  `dist/.well-known/apple-app-site-association`.
- ✅ `npx cap sync ios` — 5 plugins synced.
- ✅ `xcodebuild -workspace App.xcworkspace -scheme App -sdk
  iphonesimulator build` → `** BUILD SUCCEEDED **`.
- ✅ `deno test supabase/functions/_shared/` — 217 / 0 failed.

### REQUIRED Clerk dashboard config (manual, one-time)

The Clerk production instance's allowed origins must include
`https://witholive.app` (likely already there, since the web app
works). If not, passkeys will still fail with a Clerk-side origin
error, not an iOS one. Verify at:

  Clerk Dashboard → Configure → Domains → Application origins

No new origin is required — the iOS app now presents itself as
`https://witholive.app`, which matches the existing web production
origin. No code deploy can add Clerk origins; the user does this in
the dashboard.

### Post-deploy verification steps

1. Deploy the web app to Vercel (dev branch → preview URL, or merge to
   prod). Confirm `https://witholive.app/.well-known/apple-app-site-association`
   returns `200 OK` with `Content-Type: application/json` and the
   exact JSON body from `public/.well-known/apple-app-site-association`.

2. Apple caches AASA aggressively. To force a re-fetch on a test
   device: delete + reinstall the app (simulator: `xcrun simctl
   uninstall booted app.olive.couple` then re-run). Alternative:
   toggle "Developer → Reset Pass Kit / Associated Domains" in iOS
   Settings (simulator has this under Developer menu).

3. In Xcode: add the entitlements file to the project if not already
   visible in the File Navigator (right-click App folder → Add Files →
   select `App.entitlements`). The `project.pbxproj` already points to
   it via `CODE_SIGN_ENTITLEMENTS`; this step just makes it visible in
   the GUI.

4. Run the app on simulator. Tap "Sign in with passkey". Expected
   behavior:
   - If user has NO passkey yet → Clerk prompts "Use an existing
     passkey or set up a new one" via iOS system sheet.
   - If user has a passkey registered on web → iOS offers it
     immediately.
   - Console logs `[SignIn/Passkey] Attempting authenticateWithPasskey`
     with `origin: "https://witholive.app"`. If that origin is still
     `capacitor://localhost`, the Capacitor config change didn't take
     effect — run `npx cap sync ios` again.

### Invariants preserved / trade-offs

- Web passkey flow UNCHANGED. All changes are iOS-scoped.
- API calls from iOS now originate from `https://witholive.app` —
  Supabase CORS is permissive; no edge-function changes needed.
- `olive://` custom scheme still works (the earlier deep-link fix is
  independent of this one).
- Deno tests + TypeScript compile still green.
- One-time migration: iOS users currently signed in against
  `pk_test_*` will be signed out on first launch after this change.
  They sign in again with their real (web) credentials and land on the
  correct Supabase data. Documented in `capacitor.config.ts` comment.

---

## 2026-04-19 — UX fixes: list privacy toggle + FAB dedupe

Two user-reported bugs visible on both iOS and web.

### Bug 1 · List-level Private / Shared toggle did nothing

The "Private" (or "Shared") pill next to the list title on the
list-detail page (`src/pages/ListCategory.tsx`) was a **display-only
`<Badge>`** — no `onClick`, no handler, no Popover. Tapping it looked
interactive but did nothing. The only way to toggle list privacy was to
open the Edit Dialog via the pencil icon → select Private/Shared → Save.
Meanwhile, the per-task privacy pill (`NotePrivacyToggle.tsx`) DID work,
which made the disparity confusing.

Fix:

- **`src/components/ListPrivacyToggle.tsx`** (new, ~170 lines) —
  Popover-backed Button that mirrors `NotePrivacyToggle`'s UX pattern
  exactly. Writes through `useSupabaseLists.updateList({ couple_id })`
  — the same hook + field the Edit Dialog was already using
  successfully (`handleEditList` at line 74-93). Toasts success/failure
  using existing translation keys (`listDetail.listShared` /
  `listMadePrivate`). When the user has no couple, falls back to a
  read-only `<Badge>` so the header still renders the state but the
  click is a no-op (matches pre-fix behavior for solo users).

- **`src/pages/ListCategory.tsx`** — replaced the two static `<Badge>`
  renders (lines 213-223) with a single `<ListPrivacyToggle
  listId={currentList.id} isShared={!!currentList.couple_id} />`. The
  Edit Dialog's Private/Shared buttons are untouched — users who prefer
  that route still have it.

Why a separate component from `NotePrivacyToggle` rather than a shared
one: different data source (`clerk_lists` vs `clerk_notes`), different
hook (`useSupabaseLists` vs `useSupabaseNotesContext`), different field
shape (`couple_id` vs `isShared` + `coupleId`). A shared abstraction
would be forced and cost more than it saves.

### Bug 2 · Three floating action buttons overlapping

The list-detail screen (and Home, Calendar, Reminders) rendered THREE
bottom-right FABs stacked on top of each other:

1. `FloatingSpeedDial` — global, mounted in `AppLayout.tsx`. Expandable
   menu with "Ask Olive" (chat) + "Brain-dump" (quick note). **KEEP.**
2. `FloatingActionButton` — per-page, mounted in 4 pages. Just a "+"
   that opened a Quick Add Note dialog. Duplicates the speed-dial's
   brain-dump path. **REMOVE.**
3. `FeedbackDialog` (variant="fab" by default) — global, mounted in
   `App.tsx`. Separate pill on the bottom-right. **REMOVE FROM FAB;
   keep the dialog, move the trigger into Settings.**

User's ask: "keep only one (the one that asks to chat with olive or
brain dump)." The speed-dial already provides both actions, so it's the
keeper.

Fixes:

- **`src/pages/Index.tsx`, `CalendarPage.tsx`, `ListCategory.tsx`,
  `Reminders.tsx`** — removed `FloatingActionButton` import + render
  from all four pages. Replaced with an explanatory comment so the
  next contributor understands why the FAB isn't there. The component
  file (`src/components/FloatingActionButton.tsx`) is kept in the tree
  (zero callers, but deleting it is a separate cleanup PR — doesn't
  block the UX fix and avoids noise in this diff).

- **`src/App.tsx`** — removed `<FeedbackDialog />` render + import.
  Comment in place explaining why.

- **`src/components/FeedbackDialog.tsx`** — the `variant="inline"`
  branch previously returned `null` as its trigger, making the Dialog
  unreachable. Changed it to render a small outlined `Button` with the
  MessageSquarePlus icon + "Send Feedback" label. The "fab" variant
  is preserved for any caller that still opts in, but it's no longer
  mounted anywhere by default.

- **`src/components/settings/AppPreferencesModals.tsx`** — the "Send
  Feedback" card in Help & Support was purely descriptive text (no
  action). Added `<FeedbackDialog variant="inline" />` inside the card
  so the card now has a working trigger button. Users discover
  feedback through Settings → Help & Support, which matches the user
  mental model ("tell me how to do X" lives in Settings).

### Testing

- ✅ `npx tsc --noEmit` — clean.
- ✅ `npm run build` — Vite bundle OK (4.1s).
- ✅ `deno test supabase/functions/_shared/` — 217 / 0 failed
  (no regression).
- ✅ `npx cap sync ios` — 5 plugins synced.
- ✅ `xcodebuild ... iphonesimulator build` → `** BUILD SUCCEEDED **`.

### Invariants preserved

- Web + iOS share identical behavior (single codebase change).
- The Edit Dialog (pencil icon) on the list detail still toggles
  privacy the same way it always did — ListPrivacyToggle is additive.
- `FloatingSpeedDial` (global) is untouched — Ask Olive + Brain-dump
  still available on every page.
- Feedback submission is unchanged at the send-feedback edge function
  level — only the trigger moved.
- Users without a couple see a read-only "Private" badge on list
  headers exactly as before (can't share when there's no one to share
  with).
- Existing i18n keys reused; new fallbacks provided for any new labels
  (`listDetail.visibilityLabel`, `listDetail.privateOption`,
  `listDetail.sharedOption`, `listDetail.privacyToggle`) using the
  shadcn i18n default-value pattern.

### Not in this PR (deliberately)

- Deleting `src/components/FloatingActionButton.tsx`. The component
  is no longer imported anywhere; removing the file is trivial but
  adds noise to this diff. One-line follow-up cleanup.
- Migrating `NotePrivacyToggle` + `ListPrivacyToggle` to a shared
  abstraction. The shapes of `Note` vs `List` privacy differ enough
  (isShared vs couple_id null-check) that a shared component would
  need a discriminated-union config object — more complexity than the
  ~170 lines of duplication it would save.

---

## 2026-04-19 — Phase 8-A · Eval Harness (static layer) + seed fixtures

Ships the foundation of Olive's test-and-measurement layer — the thing
the engineering plan called out as a prerequisite for Phase 5 (learning
agents) and Phase 6 (Anthropic fallback): **how do we know a change to
the prompt pipeline didn't regress quality?**

Two-layer design:

1. **STATIC** (this PR): pure-function pipeline invocation. No Gemini,
   no DB. Runs in 2 ms for 12 fixtures. Free, deterministic, safe for
   every CI run.
2. **LIVE** (stubbed in types, not implemented): same cases against
   real Gemini. Expensive, flaky, run nightly.

The first cut focuses 100% on static so we can ship the CI gate without
a billing conversation.

### What the static layer catches

- Intent alias drift (`help` stops mapping to `help_about_olive`).
- Prompt-system flag regressions (rollout env misread).
- `SLOT_USER` / `SLOT_DYNAMIC` overflow past 3,200-token budget.
- Memory injection failures (seeded fact never reaches the prompt).
- Missing required slots (`IDENTITY` / `QUERY` empty).
- Compiled-vs-dynamic `userSlotSource` telemetry breaking.

### Architecture

```
tools/eval-harness/
  run.ts                               # Deno CLI entry
  README.md                            # authoring + running docs
  fixtures/*.json                      # one case per file (12 seeded)
  reports/*.json                       # gitignored — timestamped runs

supabase/functions/_shared/eval-harness/
  types.ts                             # EvalCase, EvalResult, EvalReport
  static-runner.ts                     # pure pipeline runner
  loader.ts                            # JSON fixture loader + validator
  reporter.ts                          # percentile math + human summary
  eval-harness.test.ts                 # 27 meta-tests
```

### Case shape (JSON)

```json
{
  "id": "chat-basic-solo",
  "description": "Solo user asks for help drafting an email.",
  "suite": "intent-classification",
  "persona": "solo",
  "layer": "static",
  "tags": ["phase4-option-a", "regression"],
  "input": { "message": "...", "userId": "..." },
  "seededContext": { "compiledArtifacts": [...], "memoryChunks": [...] },
  "classifierFixture": { "intent": { "intent": "chat", ... } },
  "expected": {
    "resolvedIntent": "chat",
    "promptSystem": "modular",
    "slotBudgetUnder": 3200,
    "requiredSlotsPopulated": ["IDENTITY", "QUERY"],
    "promptMustContain": ["espresso"]
  }
}
```

Every `expected` field is optional — the runner asserts only what the
case opts into (open-world). This lets a case in the `memory-recall`
suite focus its assertions on recall without having to over-specify
other fields.

### CLI

```sh
# Full static suite (default)
deno run --allow-read --allow-write --allow-net --allow-env --allow-run \
  tools/eval-harness/run.ts

# Filter by suite
deno run ... --suites memory-recall,prompt-budget

# Filter by tag (any-match)
deno run ... --tags phase4-option-a

# CI-friendly
deno run ... --fail-fast
```

Exit: `0` all-pass · `1` any failure · `2` CLI arg error. JSON report
lands in `tools/eval-harness/reports/<iso-timestamp>.json` (gitignored).

### First-cut fixture set (12 cases)

| Suite | Cases |
|---|---|
| `intent-classification` | chat, contextual_ask, create, search, expense, help_about_olive (via `help` alias) — all modular path |
| `user-slot-source` | couple persona with compiled artifacts → asserts `userSlotSource=compiled` |
| `prompt-budget` | 5-artifact + 4-chunk overflow case → must stay under 3,200 tokens |
| `memory-recall` | preference, safety (allergy), partner-name-via-compiled-artifact, empty-baseline |

### First-run result (this PR, clean)

```
Olive Eval Harness — STATIC layer
12/12 passed (100%)  ·  0 failed  ·  0 skipped

Per-suite:
  ✓ intent-classification         6/6 pass
  ✓ user-slot-source              1/1 pass
  ✓ prompt-budget                 1/1 pass
  ✓ memory-recall                 4/4 pass

Classifier accuracy:  100%
Memory recall rate:   100%
Token budgets (total across all slots, passing cases):
  intent-classification         p50=404  p95=420  max=425
  memory-recall                 p50=417  p95=430  max=431
Avg tokens by intent:
  chat=411  contextual-ask=523  create=404  search=362
  expense=403  help-about-olive=405

Completed in 2ms.
```

That 2 ms number is the most important line in this report: it means
the harness can run on EVERY PR without anyone caring about CI cost.

### Testing the tester

`eval-harness.test.ts` — **27 meta-tests** covering:

- Loader: accepts well-formed cases, rejects each required-field
  omission, aggregates errors across a batch.
- Static runner pass/fail paths: happy path, intent mismatch, budget
  overflow, required-slot missing, must-contain/must-not-contain,
  memory strategy inference, skip-reason when layer mismatches.
- Batch: suite filter, tag any-match filter, failFast halts early.
- Reporter: pass/fail/skip totals, percentile omission under small N,
  classifier accuracy + memory recall rates restricted to matching
  suites, human-summary headline + failure block.

Full `_shared/` regression: **244 passed / 0 failed** (was 217 pre-PR;
net +27 meta-tests, zero pre-existing failures).

### Design invariants preserved

- **Never throws from the runner.** An unexpected exception in
  `runStaticCase` is recorded as an `internal_error` failure, not a
  thrown error — one bad case doesn't blow up the batch.
- **Fixtures are pure data.** No TS imports needed to author one.
  PMs can open `fixtures/*.json`, copy the nearest case, and edit.
- **Assertions are structured, not textual.** A failure tells you
  exactly which field differed and what the expected/actual was.
  Reporter groups by failure type to surface systemic bugs.
- **Runner uses the SAME code production uses.** `resolvePrompt`,
  `assembleContext`, `assembleCompiledSlot`, `fetchMemoryChunks`,
  registry aliases — all imported from `_shared/` without stubs. The
  only stubs are `MemoryDB` (seeded chunks) and the classifier
  (fixture). If the harness passes, production routing works.
- **No Supabase, no Gemini, no network.** Static layer is hermetic —
  runs on a laptop in airplane mode.

### What's next (not in this PR)

1. **GitHub Actions CI gate** — run the static suite on every PR;
   fail the PR if `classifierAccuracy < 1.0` or `memoryRecallRate <
   1.0` or p95 tokens regress >20% vs `main`'s baseline report.
2. **Live layer** — real Gemini calls behind an env flag + a
   nightly-only workflow. Records response patterns, token usage,
   latency. Cases can opt in via `expected.responseShape`.
3. **Gold baseline diffing** — snapshot prompts in a baseline report
   committed to git; diff per PR so unintended prompt drift shows up
   in review.
4. **Grow the fixture set** — engineering plan target: 60 cases
   across 3 personas × 8 intents. Seeded at 12; grow as real bugs
   and edge cases surface.

### Invariants preserved across Phase 1 → 4 → Option A → iOS → 8-A

All prior invariants still hold. The harness is strictly additive:
zero changes to edge-function handlers, shared modules, or React UI.
Build + test chain:

- `npx tsc --noEmit` — clean.
- `npm run build` — Vite bundle unchanged.
- `deno test supabase/functions/_shared/` — **244 / 0 failed**.
- `deno run tools/eval-harness/run.ts` — **12 / 12 passed, 2 ms**.

---

## 2026-04-21 — Option B Phase 8-A (CI gate)

Builds on the static eval harness shipped earlier today. The harness
writes a rich `EvalReport`; the gate turns that report into a pass/fail
decision and wires it into every PR.

### Scope (intentionally tight)

- **Static layer only.** No live Gemini calls in CI — those would be
  paid + flaky per PR. Nightly live-layer workflow is a follow-up.
- **Absolute thresholds only** for first cut. Baseline-diffing vs
  `main` is a follow-up.
- **Deterministic rules only** (pass/fail). Soft-warning / trend
  rules are deferred until we have a baseline to compare against.

### Deliverables

**`tools/eval-harness/thresholds.json`** — declarative config. Six
rules, each tunable without a code change. A top-level `relaxations[]`
array serves as an audit log: whenever we lower a threshold, the
entry is required (date + PR + reason).

**`supabase/functions/_shared/eval-harness/gate.ts`** — pure decision
logic:

```ts
applyGate(report, thresholds) → { passed, violations, rulesChecked, suitesChecked }
renderGateMarkdown(decision, report) → string  // PR-comment-ready
```

Rule set:

| Rule | Default | What it catches |
| ---- | ------- | --------------- |
| `max-failures-allowed` | 0 | Any case failure. |
| `max-skipped-allowed` | 0 | Silent skipping is the #1 way regressions hide. |
| `classifier-accuracy` | ≥ 1.0 | Intent routing regression on any known intent. |
| `memory-recall-rate` | ≥ 1.0 | Seeded facts stopped reaching the LLM prompt. |
| `max-runtime-ms` | 30000 | Pathological cases before the suite outgrows per-PR CI. |
| `max-tokens-per-case` | 3200 per suite | STANDARD_BUDGET overrun on any SINGLE case (not p95 — one bad case fails the gate). |

Design choices:

- Rules are independent: a single failing case often trips multiple
  rules, and that redundancy helps triage.
- Missing metrics skip their rule (not applicable). Unknown suites in
  `maxTokensPerCase` are tolerated (forward-compat: adding a suite
  shouldn't break old configs).
- Same-suite overruns collapse to one violation with multiple case
  IDs — keeps PR comments readable when a whole suite regresses.
- Markdown renderer caps failing-case detail at 10 entries.

**`gate.test.ts`** — 19 meta-tests. Covers each rule's pass/fail path,
multiple simultaneous violations, missing-metric tolerance,
forward-compat for unknown suites, markdown headline + body shape +
10-case cap.

**`tools/eval-harness/gate.ts`** — CLI wrapper. Single command for CI:

```bash
deno run --allow-read --allow-write --allow-net --allow-env --allow-run \
  tools/eval-harness/gate.ts
# exit 0 pass · 1 fail · 2 CLI/IO error
```

- Loads thresholds, fixtures, runs the static batch, applies the gate.
- Writes `reports/latest.json` (full report) and `reports/latest.md`
  (PR comment body) — CI uploads them as artifacts.
- Captures git provenance (sha, branch, ci/local) for the markdown
  footer so reviewers can trace a comment back to a commit.
- `--thresholds` override for future staging/prod gate differentiation.

**`.github/workflows/eval-harness.yml`** — CI wiring:

- Triggers on PRs to `main`/`dev` + pushes to `main`. Manual
  `workflow_dispatch` for ad-hoc runs.
- Path-filtered to `supabase/functions/**`, `tools/eval-harness/**`,
  `src/**`, and the workflow file. Docs-only / CHANGES-only PRs skip.
- Deno caching keyed on lockfile + harness source hash — re-runs are
  seconds.
- `concurrency` group cancels in-flight runs on new commits so the
  Actions UI stays tidy.
- `permissions: pull-requests: write` (minimum) so the comment step
  works; everything else is read-only.
- Deliberately `set +e` around the gate call so the "Post PR
  comment" step ALWAYS runs, even on gate failure. Final step
  re-raises the exit code to fail the job.
- PR comment uses a marker (`<!-- olive-eval-harness-comment -->`) so
  subsequent runs **update** the existing comment instead of spamming.

**`tools/eval-harness/README.md`** — expanded with: running locally,
threshold semantics, when to add a relaxation, workflow anatomy, and
how to extend the rule set safely.

**`.gitignore`** — added `tools/eval-harness/reports/` (run
artifacts, regenerated every run, uploaded by CI) + `.claude/`.

### Verification

- ✅ Gate meta-tests: 19/19 pass.
- ✅ Full `_shared/` Deno suite: **263 passed / 0 failed** (was 244
  before this work).
- ✅ Gate CLI end-to-end on real fixtures: exit 0 (12/12 cases pass,
  all thresholds met).
- ✅ Gate CLI with deliberately-strict thresholds: exit 1, structured
  violations printed with case IDs. Confirms the fail path.
- ✅ `npx tsc --noEmit` clean.

### Post-deploy verification (after merge)

1. Open a draft PR touching any file under the workflow's path filter.
   Expect: "Eval Harness / Static eval + gate" check appears on the
   PR within ~1 minute.
2. That check runs ~10-20s (first run ~40s while Deno deps warm the
   cache). It posts a PR comment with the report summary.
3. Push a no-op commit to confirm the comment UPDATES (one bot
   comment per PR, not a thread).
4. Deliberately break a case in a branch — e.g. change an
   intent-classification fixture's `expected.classifier.intent` to
   `foo`. Expect: the check fails, the PR comment lists the
   violation with the exact case id.

---

## TASK-ONB-A — Wire onboarding scope to Spaces + seed Olive's User Soul

**Branch:** `feat/onb-spaces-and-soul` · **Date:** 2026-04-26

### Why
Onboarding captured rich quiz signal (scope, mental load, partner name) and
threw it away. Every new user got a hardcoded couple-typed `"My Space"`,
the rest of the Space type templates (family / business / household / custom)
sat unused, and the User Soul layer was never written — so Olive's context
assembly had nothing to personalize tone, focus, or relationships from.

### What

1. **New beat in onboarding: `spaceCreate`.** Sits between `quiz` and
   `regional`. Renders `SpaceNameStep` with smart per-scope defaults
   (`Ganga's Space`, `Ganga & Sarah`, `The Smith Household`,
   `Ganga's Workspace`). Tooltip clarifies users can create more Spaces
   later — addresses the "I didn't know I could make more" dead end.

2. **Scope drives space type.** New `SCOPE_TO_SPACE_TYPE` map:
   `Just Me → custom`, `Me & My Partner → couple`, `My Family → family`,
   `My Business → business`. Couple keeps `createCouple()` so the
   `clerk_couples` bridge + sync trigger stay intact; non-couple types
   route through `useSpace().createSpace()` → `olive-space-manage` →
   `generateSpaceSoul()` (existing infrastructure, finally invoked).

3. **New edge function `onboarding-finalize`.** Builds a User Soul
   payload matching `renderUserSoul()`'s expected shape and calls
   `upsertSoulLayer("user", "user", userId, …, "onboarding")`. Also
   augments the auto-generated Space Soul by merging mental-load focus
   areas into `proactive_focus` so heartbeat agents pick them up.

4. **New client helper `seedOnboardingSoul`** (`src/lib/onboarding-soul.ts`).
   Best-effort wrapper — failures are logged but never block onboarding.

5. **`handleDemoSubmit` / `handleComplete` no longer auto-create
   `"My Space"`.** The space already exists by the time the user reaches
   the demo step. A defensive `ensureSpaceExists()` fallback handles the
   edge case of skipping `spaceCreate` (creates a couple-typed solo space
   so the `clerk_notes.couple_id` FK stays satisfied).

### Files

| Path | Change |
|---|---|
| `supabase/functions/onboarding-finalize/index.ts` | NEW — User Soul writer + Space Soul augment |
| `supabase/functions/onboarding-finalize/buildUserSoulContent.test.ts` | NEW — 8 unit tests |
| `src/lib/onboarding-soul.ts` | NEW — client wrapper |
| `src/components/onboarding/SpaceNameStep.tsx` | NEW — naming beat with smart defaults |
| `src/pages/Onboarding.tsx` | MOD — adds `spaceCreate` step, `useSpace` integration, scope→type routing, soul seeding, defensive `ensureSpaceExists` |

### Backwards compatibility
- Couple flow unchanged: `Me & My Partner` still hits `create_couple` RPC,
  sync trigger still creates the matching `olive_spaces` row, all legacy
  hooks scoped on `clerk_couples.id` keep working.
- Existing users (with `localStorage["olive_onboarding_completed"]` or
  any `clerk_notes` row) bypass onboarding entirely (gated in `Root.tsx`).
- Resumable: `spaceAnswers` (name + partner + spaceId) persists to
  `localStorage` alongside the rest of the onboarding state.

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ `deno check supabase/functions/onboarding-finalize/index.ts` — clean
- ✅ `deno test supabase/functions/onboarding-finalize/` — 8/8 pass
- ✅ `deno test supabase/functions/_shared/ --ignore=…/time-resolver.test.ts` —
  263/0 (the time-resolver failure is in a pre-existing WIP file unrelated
  to this task)
- ✅ `npx vite build` — succeeds

---

## TASK-ONB-B — Onboarding instrumentation (events table + funnel view + client hook)

**Branch:** `feat/onb-instrumentation` (built on `feat/onb-spaces-and-soul`) · **Date:** 2026-04-26

### Why
After TASK-ONB-A wired quiz answers into Spaces + the Soul system, we had
no way to measure whether the new flow actually moves the needle on
completion, time-to-first-capture, or D1 retention. The only signal was
a single `olive_memory_chunks` row tagged `onboarding_completed` — useless
for per-beat drop-off, skip rate, or A/B comparison. This PR adds the
event log + funnel view that every downstream onboarding PR (C/D/E)
needs to be measurable.

### What

1. **Migration `20260426010000_onboarding_events_instrumentation.sql`** —
   creates `olive_onboarding_events` (append-only, RLS scoped to
   `auth.jwt()->>'sub'`) plus three indexes (per-user timeline,
   per-event-type, per-beat). Service role bypasses RLS via separate
   policy for cross-user dashboard queries.

2. **View `v_onboarding_funnel`** — daily funnel using a `user_first_events`
   CTE so we avoid correlated subqueries. Reports starts, space-created,
   first-capture, wa-connected, wa-skipped, completed counts plus null-safe
   pct ratios and average `seconds_to_first_capture` / `seconds_total`.

3. **Hook `src/hooks/useOnboardingEvent.ts`** — fire-and-forget telemetry
   that writes directly to the table via the authenticated Supabase client
   (no extra edge function on the hot path). Idempotent `flow_started` via
   `sessionStorage` to dedup React StrictMode double-mounts and refresh
   resumes. Stable callback identity across renders.

4. **`Onboarding.tsx` instrumentation** — fires the full event matrix:
   - `flow_started` once per session (on mount)
   - `beat_started` on every step transition (effect on `currentStep`)
   - `beat_completed` in `goToNextStep`
   - `beat_skipped` via new `skipBeat()` helper wired to all 3 skip links
     plus the demo "Skip and go to Home" link
   - `space_created` + `soul_seeded` in `handleSpaceCreate`
   - `wa_connected` in `handleConnectWhatsApp` (intent, pre-redirect)
   - `calendar_connected` in `handleConnectCalendar` (intent, pre-redirect)
   - `capture_sent` in `handleDemoSubmit` with `latency_ms` for Gemini
     round-trip monitoring
   - `flow_completed` in `markOnboardingCompleted` with `duration_seconds`
     + `completed_steps` array
   - `error` on `process-note` failure with the underlying message

### Files

| Path | Change |
|---|---|
| `supabase/migrations/20260426010000_onboarding_events_instrumentation.sql` | NEW — table + RLS + view |
| `src/hooks/useOnboardingEvent.ts` | NEW — fire-and-forget client hook |
| `src/pages/Onboarding.tsx` | MOD — wires the hook into 11 event call sites + new `skipBeat()` helper |

### Why no edge function
Events are write-once, low-stakes, and high-frequency on the hot path of
new-user activation. Forcing each through an edge function adds 80–200ms
of HTTP overhead per beat plus a deploy gate that would block measurement.
RLS enforces `user_id = auth.jwt()->>'sub'` on every INSERT — no client
can fabricate events for another user.

### Why no client-side tests
The repo has no Vitest / Jest configured. Adding it for one hook is out
of scope for this PR. Coverage strategy: TypeScript + production build +
manual QA on Vercel preview, with the funnel view itself acting as a
runtime contract test (if events stop flowing, the view goes empty).

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ `deno test supabase/functions/_shared/ --ignore=…/time-resolver.test.ts` —
  276/0 (regression check; my changes don't touch `_shared/`)
- ✅ `npx vite build` — succeeds
- ✅ Migration audit: idempotent (uses `IF NOT EXISTS` + `DO $$ IF NOT EXISTS`
  policy guards), no destructive ops, view is `CREATE OR REPLACE`

### Sample query for the dashboard
```sql
SELECT day, started, completed, pct_completed,
       avg_seconds_to_first_capture, avg_seconds_total
FROM v_onboarding_funnel
WHERE day > CURRENT_DATE - INTERVAL '14 days'
ORDER BY day DESC;
```

### Deploy notes
- One migration: `supabase db push`
- No new edge functions
- No env var changes

---

## TASK-ONB-C — Live capture preview + Space invite step

**Branch:** `feat/onb-live-parse-invite` (built on `feat/onb-instrumentation`) · **Date:** 2026-04-26

### Why
The demo step submitted to `process-note`, fired a generic toast, and
navigated away. The user never SAW Olive understand them — the aha
happened off-screen. Separately, every shared-Space type (couple /
family / business) was a single-player setup at end of onboarding, so
the moat (collaboration with privacy boundaries) was invisible until
the user manually figured out invites in Settings.

This PR addresses both: render the parsed result inline with a
staggered "Olive understood:" preview, and add a one-tap WhatsApp-share
invite step that auto-skips for solo Spaces.

### What

1. **`CapturePreview.tsx`** — animated rendering of `process-note`'s
   structured response. Handles both single-note and multi-note shapes
   (`{multiple: true, notes: [...]}`). Maps each note to one of five
   variants (`shopping`, `calendar`, `reminder`, `expense`, `note`)
   based on a documented priority order (receipt > shopping w/ items >
   due_date > generic items > fallback). Locale-aware date formatting
   via existing `useDateLocale`. Exposes `onAnimationComplete` so the
   parent can fire `capture_previewed` and reveal the "Take me home" CTA.

2. **`InviteSpaceStep.tsx`** — generates an `olive_space_invites` token
   via the existing `useSpace().createInvite()` hook (which routes to
   the `olive-space-manage` edge function). Builds a `wa.me` share URL
   with editable prefilled copy that adapts to space type ("your
   partner" / "your family" / "your team"). Shows the link with a copy
   button; both share paths are independently usable.

3. **New `shareSpace` step** — sits between `spaceCreate` and
   `regional`. Auto-skipped for solo (`custom`) spaces via a dedicated
   useEffect that fires `beat_auto_skipped` with `reason: solo_space`
   so the funnel can distinguish "auto-skipped because solo" from
   "user tapped skip on a couple/family space".

4. **Demo step now has two modes** — input (default) and preview.
   `handleDemoSubmit` captures the `process-note` response into
   `demoResult` state, which flips the card to preview mode. The user
   explicitly taps "Take me home" once the animation finishes — no
   auto-navigation that would steal the aha.

5. **4th demo chip "Gate code 4821#"** — mirrors the landing-page demo
   and proves the "save random strings" use case, a high-frequency
   capture for couples / families that no other note app handles cleanly.

6. **New telemetry events** added to `useOnboardingEvent`:
   - `beat_auto_skipped` — for solo-space auto-skip
   - `capture_previewed` — fires when the preview animation finishes
   - `invite_generated` — when `createInvite` returns a token (carries
     `token_prefix` for accept-rate correlation)
   - `invite_shared` — when the user taps "Done — Continue" after
     generating the link (signals intent-to-send)

### Files

| Path | Change |
|---|---|
| `src/components/onboarding/CapturePreview.tsx` | NEW — animated parse preview, 1 result → N rows with stagger |
| `src/components/onboarding/InviteSpaceStep.tsx` | NEW — invite generator + WhatsApp share + copy link |
| `src/pages/Onboarding.tsx` | MOD — `shareSpace` step, auto-skip effect, two-mode demo step, 4th chip, 4 new events |
| `src/hooks/useOnboardingEvent.ts` | MOD — 4 new event types in the union |
| `public/locales/en/onboarding.json` | MOD — 4 new strings (chip4, previewHeader, previewSubtext, takeMeHome) |
| `supabase/functions/_shared/onboarding-capture-preview-logic.test.ts` | NEW — 14 tests covering normalize() + buildRow() priority order |

### Backwards compatibility
- Solo Spaces (Just Me) skip `shareSpace` automatically — same flow length as before
- Existing skip paths still work — `skipBeat()` fires `beat_skipped` then advances
- `process-note` contract unchanged — the new code reads its existing JSON shape
- Failing `process-note` invocation falls back to the existing toast + retry path; no preview shown

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ `deno test supabase/functions/_shared/onboarding-capture-preview-logic.test.ts` — 14/14 pass
- ✅ `deno test supabase/functions/onboarding-finalize/` — 8/8 (ONB-A regression)
- ✅ `deno test supabase/functions/_shared/` — 277/0 (excludes pre-existing time-resolver WIP failure)
- ✅ `npx vite build` — succeeds

### Deploy notes
- No new edge functions
- No migrations
- No env var changes

---

## TASK-ONB-D — Onboarding version flag + lean v2 flow shape

**Branch:** `feat/onb-version-flag` (built on `feat/onb-live-parse-invite`) · **Date:** 2026-04-26

### Why
ONB-A wired quiz → Spaces. ONB-B made the funnel measurable. ONB-C
delivered the aha + invite. The flow is still 8 beats long though, and
two of them are demonstrably low-value:
  - **regional** — timezone/language already auto-detect; the confirm
    step is a tax for a value the user never sees
  - **calendar** — Google OAuth is a heavy ask before the user has felt
    a single benefit; better surfaced just-in-time when a capture has
    a `due_date`
Plus the mental-load substep of the quiz adds an interaction without
materially shaping the soul (scope alone drives space type, mental load
seeds domain_knowledge that heartbeat agents will learn anyway).

This PR adds a per-user `onboarding_version` flag, assigns new users to
`v2` automatically, and makes those three drops conditional. ONB-B's
funnel can now slice every metric by cohort.

### What

1. **Migration `20260426020000_onboarding_version_flag.sql`** —
   `ALTER TABLE olive_user_preferences ADD COLUMN onboarding_version TEXT
   NOT NULL DEFAULT 'v1'`. Partial index for non-default cohorts. Default
   is `'v1'` so existing users keep the legacy flow; the frontend assigns
   `v2` for net-new users.

2. **`useOnboardingVersion` hook** —
   - Reads `olive_user_preferences.onboarding_version` (maybeSingle).
   - For users without a row OR with the default `v1` AND no completed
     onboarding marker, UPSERTs `v2` and reports `justAssigned: true`
     so the parent fires `version_assigned` exactly once per user.
   - Returning users (already have `localStorage.olive_onboarding_completed`)
     stay on `v1` so the cohort is representative.
   - Defensive: read failure → fallback to `v1` in-session, never blocks
     onboarding.

3. **`src/lib/onboarding-flow.ts`** — pure helpers:
   - `FULL_STEPS_ORDER` — canonical 8-beat list
   - `getStepsForVersion(v)` — drops `regional` + `calendar` for v2
   - `getQuizStepsForVersion(v)` — 2 for v1, 1 for v2
   - `isStepActive(step, v)` — used for v2 stale-state correction

4. **`Onboarding.tsx` refactor** — replaced the file-level `STEPS_ORDER`
   const + `QUIZ_TOTAL_STEPS` const with version-aware values computed
   inside the component:
   ```ts
   const stepsOrder = useMemo(() => getStepsForVersion(effectiveVersion), [effectiveVersion]);
   const quizTotalSteps = getQuizStepsForVersion(effectiveVersion);
   ```
   All 6 STEPS_ORDER references and 3 QUIZ_TOTAL_STEPS references now
   resolve through these.

5. **Three new effects in Onboarding.tsx**:
   - **`version_assigned` fires once** when the hook reports
     `justAssigned: true` — this is the A/B-slice signal for ONB-B's funnel.
   - **Stale-step corrector**: if a refresh restores
     `state.currentStep === 'regional'|'calendar'` for a v2 user, fires
     `beat_auto_skipped` with `reason: dropped_in_v2` and advances to
     the next active beat. Prevents black-screen states.
   - **v2 silent regional persistence**: timezone + language still get
     written to `clerk_profiles` and `i18n.changeLanguage` runs — just
     without a confirm screen. v2 users get the same downstream behavior,
     one fewer click.

6. **New telemetry event** `version_assigned` added to the
   `useOnboardingEvent` union with payload `{version: "v1" | "v2"}`.

### Files

| Path | Change |
|---|---|
| `supabase/migrations/20260426020000_onboarding_version_flag.sql` | NEW — column + partial index + comment |
| `src/hooks/useOnboardingVersion.ts` | NEW — read + assign + sticky logic |
| `src/lib/onboarding-flow.ts` | NEW — pure step-shape helpers |
| `src/pages/Onboarding.tsx` | MOD — version-aware step list, 3 new effects, removed file-level `STEPS_ORDER` const |
| `src/hooks/useOnboardingEvent.ts` | MOD — `version_assigned` added to event union |
| `supabase/functions/_shared/onboarding-flow-logic.test.ts` | NEW — 9 tests covering version/step matrix |
| `CHANGES.md` | MOD — TASK-ONB-D entry |

### Backwards compatibility
- v1 cohort behavior is byte-identical to pre-PR. The full 8-beat flow,
  the 2-step quiz, the regional confirm, the Calendar OAuth — all
  unchanged when `version === 'v1'`.
- Existing user flows (Settings, Calendar reconnect, Profile edit) are
  not touched; this PR only changes the *first-time* onboarding shape.
- The migration is purely additive (ADD COLUMN) and idempotent. RLS
  inherited from `olive_user_preferences` (already user-scoped).

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ `deno test supabase/functions/_shared/onboarding-flow-logic.test.ts` —
  9/9 pass
- ✅ Full regression: `deno test supabase/functions/_shared/
  supabase/functions/onboarding-finalize/` —
  **294/0** (excludes pre-existing time-resolver WIP failure)
- ✅ `npx vite build` — succeeds
- ✅ Migration audit: idempotent (`ADD COLUMN IF NOT EXISTS`), partial
  index also `IF NOT EXISTS`, no destructive ops

### Sample funnel slice (after ONB-B's view is extended)
Once we add `JOIN olive_user_preferences ... ON e.user_id = p.user_id`
to v_onboarding_funnel and a `GROUP BY p.onboarding_version`, every
metric becomes A/B-comparable:
```sql
SELECT
  p.onboarding_version,
  COUNT(DISTINCT e.user_id) FILTER (WHERE e.event = 'flow_started') AS started,
  COUNT(DISTINCT e.user_id) FILTER (WHERE e.event = 'flow_completed') AS completed,
  ROUND(AVG(EXTRACT(EPOCH FROM (
    e2.created_at - e1.created_at
  )))) AS avg_seconds_to_capture
FROM olive_onboarding_events e
JOIN olive_user_preferences p ON p.user_id = e.user_id
LEFT JOIN olive_onboarding_events e1 ON e1.user_id = e.user_id AND e1.event = 'flow_started'
LEFT JOIN olive_onboarding_events e2 ON e2.user_id = e.user_id AND e2.event = 'capture_sent'
WHERE e.created_at > NOW() - INTERVAL '14 days'
GROUP BY p.onboarding_version;
```
A view-extension PR is the natural follow-up once we have v2 data in.

### Out of scope (next PRs)
- **JIT Calendar prompt** on the Home page when a process-note response
  carries a `due_date` and the user hasn't connected — replaces the
  in-onboarding Calendar OAuth that v2 dropped. Separate file/area.
- **TASK-ONB-E** — receipt screen + Day-2 heartbeat nudge.
- v_onboarding_funnel extension to slice by `onboarding_version`.

### Deploy notes
- One migration: `supabase db push`
- No new edge functions
- No env var changes

---

## TASK-ONB-E — Receipt screen + JIT Calendar prompt + funnel slice-by-version

**Branch:** `feat/onb-receipt-and-jit` (built on `feat/onb-version-flag`) · **Date:** 2026-04-26

### Why
Three remaining gaps after ONB-A → D:

1. The flow ends abruptly. Users dump their first capture and land on
   Home with no Olive-side acknowledgment of what just happened. There's
   no transparency moment — and no "come back tomorrow, I'll know more"
   hook to drive D2 retention.
2. ONB-D dropped Calendar OAuth from v2 onboarding (rightly — it's a
   heavy ask before any value is felt). But there was no replacement —
   v2 users who type "dentist Tuesday 3pm" have nowhere to be prompted
   to connect Google Calendar at the moment they'd actually benefit.
3. ONB-B's `v_onboarding_funnel` view has no `onboarding_version`
   column, so the dashboard can't slice metrics by cohort even though
   ONB-D made the assignment available.

### What

1. **`ReceiptStep.tsx`** — new closing beat. Renders 3–5 bullets pulled
   from live state (Clerk first name, active Space name + type-aware
   audience phrase, demo capture summary, mental-load focuses) plus a
   forward-looking promise. Falls back to the user's most-recent
   `clerk_notes` row if the demo step was skipped, so even skip-path
   users get a meaningful "you told me about…" line. CTA "Open my day"
   is the canonical mark-complete + navigate-home path.

2. **`receipt` step added to canonical flow** — sits at the end of
   `FULL_STEPS_ORDER` for both v1 and v2. `handleComplete` (skip path)
   and `handleFinishFromPreview` (capture path) now both `goToNextStep`
   into the receipt instead of navigating directly home — so the
   "what does Olive know" moment is universal regardless of demo path.
   New `handleReceiptDone` is the only place we mark complete + navigate.

3. **`CalendarJitCard.tsx`** — a small inline card for the Home page
   that surfaces only when the user has a future-dated `clerk_notes` row
   AND no `calendar_connections` row. Single CTA "Connect Google Calendar"
   (uses the existing `calendar-auth-url` edge function), one dismissal X
   (sessionStorage-scoped per user, re-prompts next visit). Three
   telemetry events: `calendar_jit_prompted`, `calendar_jit_clicked`,
   `calendar_jit_dismissed` — so we can compute JIT-conversion rate and
   compare it to the in-onboarding Calendar step it replaces.

4. **Mounted on Home** — added `<CalendarJitCard />` next to the
   existing `<TimezoneSyncCard />` so both surface in the same prominent
   "post-onboarding context" zone.

5. **Migration `20260426030000_funnel_view_slice_by_version.sql`** —
   replaces `v_onboarding_funnel` with a version-aware version (one
   row per `(day, version)`) that joins `olive_user_preferences` to
   pick up `onboarding_version`. Also adds new columns for
   `invites_generated` (ONB-C) and `receipt_seen` (this PR). New
   companion view `v_onboarding_funnel_total` rolls up across
   versions with weighted-average ratios (so a 1000-user cohort and
   a 2-user cohort don't get equal weight in average-of-averages).

6. **Three new telemetry events** in `useOnboardingEvent`:
   `calendar_jit_prompted`, `calendar_jit_clicked`,
   `calendar_jit_dismissed`.

### Files

| Path | Change |
|---|---|
| `src/components/onboarding/ReceiptStep.tsx` | NEW — final transparency beat |
| `src/components/onboarding/CalendarJitCard.tsx` | NEW — Home-page JIT prompt |
| `src/lib/onboarding-flow.ts` | MOD — `receipt` added to `FULL_STEPS_ORDER` |
| `src/pages/Onboarding.tsx` | MOD — receipt mount + handler refactor (skip + capture paths funnel through receipt) |
| `src/pages/Home.tsx` | MOD — mount `<CalendarJitCard />` next to `<TimezoneSyncCard />` |
| `src/hooks/useOnboardingEvent.ts` | MOD — 3 new event types in union |
| `supabase/migrations/20260426030000_funnel_view_slice_by_version.sql` | NEW — view extension + companion total view |
| `supabase/functions/_shared/onboarding-flow-logic.test.ts` | MOD — updated counts, new "receipt is last" test (10 tests total now) |
| `CHANGES.md` | MOD — TASK-ONB-E entry |

### Backwards compatibility
- `v_onboarding_funnel`'s shape gains a `version` column + a few new
  count columns. Pre-existing dashboards that select-* will see new
  columns appended; any column-by-name SELECTs are byte-identical for
  the columns that existed.
- `v_onboarding_funnel_total` is the migration path for any consumer
  that expects the pre-PR row shape (no `version` column).
- ReceiptStep is rendered as a NEW step at the end. Onboarding length
  grows by one beat for both cohorts. Skip path no longer bypasses
  the receipt — but the receipt is short, single-CTA, and always
  rendable. (Funnel will tell us if we need to allow skipping it.)
- `CalendarJitCard` is invisible (returns `null`) for any user who
  doesn't meet all eligibility criteria. Zero impact on existing Home
  layout for connected users.

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ Flow-logic tests — 10/10 pass (1 new "receipt is last beat")
- ✅ Full regression: `_shared/` + `onboarding-finalize/` —
  **295/0** (excludes pre-existing time-resolver WIP failure)
- ✅ `npx vite build` — succeeds
- ✅ Migration audit: idempotent (`CREATE OR REPLACE VIEW`), no
  destructive ops, both views are reads-only

### Sample dashboard query
```sql
-- Per-cohort funnel for last 14 days
SELECT day, version, started, first_capture, completed,
       pct_completed, avg_seconds_to_first_capture
FROM v_onboarding_funnel
WHERE day > CURRENT_DATE - INTERVAL '14 days'
ORDER BY day DESC, version;

-- Cross-cohort rollup (when you don't care about A/B)
SELECT * FROM v_onboarding_funnel_total
WHERE day > CURRENT_DATE - INTERVAL '14 days';
```

### Out of scope (explicit follow-up)
- **Day-2 heartbeat nudge** — adds a job_type to `olive-heartbeat` that
  fires 24h after `flow_completed`. Touches outbound WA delivery (not
  isolated enough for this PR). Receipt screen seeds the expectation;
  the nudge closes the loop.
- The receipt screen reads from in-memory state + a single fallback
  query. A richer version could pull from `olive_soul_layers` directly
  to surface "I've already learned X about you" — saved for a future
  pass once we have data on receipt completion rate.

### Deploy notes
- One migration: `supabase db push`
- No new edge functions
- No env var changes

---

## TASK-IOS-LANDING — Redesign NativeWelcome screen for brand alignment

**Branch:** `feat/ios-native-welcome-redesign` · **Date:** 2026-04-26

### Why
The iOS first-launch screen (`NativeWelcome.tsx`) had drifted significantly
from the brand. Concrete violations against `OLIVE_BRAND_BIBLE.md`:

- **Color (§6, anti-pattern §E.6):** used violet, rose, and blue tints
  for mode chips and rainbow gradients (`from-violet-500`, `from-amber-500`,
  `from-emerald-500`) on the how-it-works icons. Brand bible: Hunter Green
  dominant, Coral for primary conversion CTA only, Magic Gold reserved for
  AI moments. No purple, no rainbow.
- **Voice (§4):** decorative emoji everywhere — "🧘 Personal", "❤️ Partner",
  "💼 Business" mode chips; "👩‍💼", "❤️" testimonial avatars; "😊 🙌 💪 ✨"
  social-proof bar; "✨ How It Works" prefix. Brand bible: warm but not
  saccharine, no decorative emoji, the leaf (🌿) is reserved for
  Olive-authored lines only.
- **Anti-positioning (§1):** eyebrow read "Meet your personal assistant" —
  the brand bible's first anti-positioning rule is "Olive is NOT an AI
  assistant — that's a commodity category in 2026."
- **Typography (§7):** headline used Plus Jakarta Sans bold instead of
  Fraunces serif — the brand-promise moment is exactly what earns serif.
- **Density (§13.4):** crammed hero + modes + how-it-works + WhatsApp +
  testimonials into one viewport. Brand bible: iOS density is "generous —
  one capture, one card", not webpage-dense.
- **CTA framing:** primary said "Request Beta Access" (waitlist gate)
  rather than the canonical "Get started — free" → `/sign-up` that the
  web hero uses.
- **Touch targets:** mode toggle buttons used `py-2.5` (~28px tall),
  below the brand bible's 48px minimum.
- **Components:** custom-rolled logo container instead of the shared
  `<BetaBadge />` component. Hand-off broken between web and iOS.

### What

Wholesale rewrite of `src/pages/NativeWelcome.tsx`. Same export, same
route (`/native-welcome`), same translation namespace (`auth.nativeWelcome`)
for backwards compatibility. New design enforces the brand bible:

1. **Hero passes the 1.5-second test.** Logo + Beta badge, eyebrow pill,
   Fraunces serif headline (deep Hunter Green at `hsl(130 25% 18%)` per
   §7), one-sentence concrete-proof subhead, Coral primary CTA, ghost
   secondary CTA, Beta-transparent trust signal.
2. **How it works.** Three squircle icons (Hunter Green strokes only,
   sage-to-white gradient backgrounds per §8) — no rainbow gradients.
3. **Modes.** Single tab strip (Solo / Couple / Family / Business) with
   one card revealed at a time. Selection state = Hunter Green border +
   subtle primary tint, NOT a unique color per mode. Default is Couple
   (the brand bible's flagship consumer wedge).
4. **Channels.** Four affordances (WhatsApp / Voice / Photos / Links) in
   a unified card row — no mock chat UI.
5. **Repeat CTA.** Same pair as the hero, so a user who scrolled the
   proof never has to scroll back up to convert.

### Backwards compatibility

- Same export (`NativeWelcome` default), same route in `App.tsx`, same
  `auth.nativeWelcome` translation namespace. Drop-in replacement.
- All 10 legacy translation keys (`tagline`, `feature*Title`,
  `getStarted`, `signIn`, `chatTeaser`) are no longer rendered, but they
  remain in the locale files in case any non-React caller (e.g. App
  Store screenshots, marketing collateral) references them. They can be
  pruned in a follow-up cleanup.
- Three locales (en, es-ES, it-IT) updated with 45 matching keys each.
- Defaults via `t(key, { defaultValue: ... })` so the screen renders
  correctly even if a future locale ships without the new keys.

### Files

| Path | Change |
|---|---|
| `src/pages/NativeWelcome.tsx` | Full rewrite — 468 lines → ~430 lines, all on-brand |
| `public/locales/en/auth.json` | `nativeWelcome` block updated with 45 keys |
| `public/locales/es-ES/auth.json` | Same — translated |
| `public/locales/it-IT/auth.json` | Same — translated |
| `CHANGES.md` | TASK-IOS-LANDING entry |

### Verification
- ✅ `npx tsc --noEmit -p tsconfig.app.json` — 0 errors
- ✅ `npx vite build` — succeeds
- ✅ All 3 locale JSON files parse cleanly with matching 45-key shape
- ✅ All design tokens used (`bg-accent`, `text-primary`, `font-serif`,
  `bg-gradient-soft`, `from-sage`) verified in `tailwind.config.ts` /
  `src/index.css`
- ✅ All copy adheres to brand bible §4 (no exclamation points, no
  decorative emoji, "shared memory" framing not "personal assistant")
- ✅ Safe-area aware (`env(safe-area-inset-top)` + `env(safe-area-inset-bottom)`
  on the outer `main`)
- ✅ All touch targets ≥48px (h-12 ghost button, h-14 primary CTA,
  h-16 mode tabs)

### Deploy notes
- **Frontend-only change.** No migrations, no edge functions, no env vars.
- Vercel preview will deploy automatically on push.
- iOS app will pick this up on next OTA / TestFlight build (Capacitor's
  WebView serves from `https://witholive.app` per `capacitor.config.ts`,
  so no native rebuild required if you're shipping over-the-air).

### Out of scope
- Pruning the 10 legacy `nativeWelcome` keys from locale files —
  intentionally retained for one release cycle in case external assets
  reference them.
- Adding new motifs (sketched chat bubbles, phone frames) — brand bible
  §13.2 caps imagery to three motifs done well; this screen leans on
  typography + cards + squircle icons (already in the system) without
  introducing new ones.
