# Olive 10x Plan — Deep Review & Improvement Programme

**Date:** 2026-05-17  
**Author:** Claude (deep audit pass)  
**Scope:** Full codebase — frontend (web + iOS), edge functions, DB, CI/CD, i18n  
**Posture:** Do not break anything. Land changes incrementally, behind tests, with rollback paths.

---

## 0. Executive summary

The Olive codebase is in good architectural shape (clean primitives, RLS-everywhere, real migration discipline, real eval harness), but five concrete issues hold it back from being 10x better:

1. **One database index is missing** — `olive_memory_chunks.embedding` has no vector index. Every memory search is a full sequential scan over 768-dim vectors. This is the single highest-leverage fix in the entire codebase.
2. **`whatsapp-webhook/index.ts` is 10,502 lines** — one file owns parsing, sessions, AI routing, cluster writing, skill matching, localization, media. Cannot be safely changed. Every WhatsApp incident touches this file.
3. **TypeScript is effectively off** — `strict: false`, `noImplicitAny: false`, `strictNullChecks: false`, 277 `any`, 71 `as any`. No frontend tests at all (0 files). The whole UI is shipped on trust.
4. **i18n is partial** — 600+ lines of help content, 61 toast messages, 26 placeholders, 36 a11y attributes are hardcoded English. Italian and Spanish users see English mid-flow.
5. **No CI gate for frontend** — no lint, no typecheck, no build check on PR. Anything compiles → preview deploys → ships.

Everything below is concrete. File paths and line numbers, not vibes.

---

## 1. Top 12 P0 findings (verified)

| # | Finding | Evidence | Impact |
|---|---|---|---|
| **P0-1** | **No vector index on `olive_memory_chunks.embedding`** | `20260427000000_baseline...sql:3443-3445` — only btree on metadata; `clerk_notes.embedding` got `ivfflat` (line 3451) but the chunks table did not | Memory search is O(n) over 768-dim vectors. As chunks grow, recall and latency degrade silently. |
| **P0-2** | **BM25 / FTS half of hybrid search not implemented** | No `tsvector` column or GIN index anywhere in `supabase/migrations/` | "70/30 hybrid" reduces to vector-only + ILIKE; keyword recall is poor and unranked. |
| **P0-3** | **`whatsapp-webhook/index.ts` is 10,502 lines** | Single file holding 8+ sub-systems | Unsafe to modify, untested, single biggest source of WhatsApp regressions. |
| **P0-4** | **TypeScript strict mode disabled** | `tsconfig.app.json` and `tsconfig.json`: `strict: false`, `noImplicitAny: false`, `strictNullChecks: false` | 277 `any`, 71 `as any` in `src/`. Type errors land in prod. |
| **P0-5** | **Zero frontend tests** | No `vitest`, `jest`, `playwright` config; no `*.test.tsx` files | UI behavior unverified across every release. |
| **P0-6** | **No frontend CI gate** | `.github/workflows/` has 3 workflows; none runs `eslint`, `tsc`, or `vite build` on PR | Bad code reaches Vercel preview. |
| **P0-7** | **`process-note/index.ts` is 3,131 lines** | 8 sub-systems mixed (URLs, calendar, media, audio, receipts, knowledge extraction) | Every note flows through this; any regression hits everyone. |
| **P0-8** | **10 inline LLM prompts violating CLAUDE.md** | `save-link:154`, `olive-soul-evolve:159`, `olive-workflows:500`, `generate-olive-tip:127,251`, `olive-memory-maintenance:309`, `olive-knowledge-extract:279`, `olive-skills:182`, `olive-prompt-evolve:190`, `process-receipt:122` | Prompts can't be versioned, A/B-tested, or audited. |
| **P0-9** | **4 untracked Gemini calls** | `ask-olive-individual:1802`, `process-receipt` (inline), `olive-workflows` (inline), `analyze-notes:120` (raw fetch) | Cost + latency invisible in `olive_llm_calls`. Breaks observability. |
| **P0-10** | **`oliveHelp.ts` (623 lines) entirely English** | `src/constants/oliveHelp.ts` — help/FAQ content stored as TS constants, not in `public/locales/` | IT and ES users see English help. Silent positioning failure. |
| **P0-11** | **DB triggers replacing app logic** | `20260512024215_clerk_notes_auto_calendar_trigger.sql` + orphan backfills (`20260512024253`, `20260517045446`) | Hidden behavior, hard to test, race-prone. Two recent data fixes already needed. |
| **P0-12** | **Camera plugin installed, never wired; push notifications missing** | `@capacitor/camera` in `package.json`, zero imports in `src/`. No `@capacitor/push-notifications` at all. | Dead weight in iOS bundle; can't notify users of partner activity. |

---

## 2. The 10x plan — 4 phases, 8 weeks

Each phase is gate-tested. **Do not start phase N+1 until phase N's exit criteria pass.**

### Phase 1 — Stop the bleeding (week 1)

Goal: every new commit is safer than the last one. Establish gates. Fix the one DB index that costs nothing and pays back forever.

**Tasks:**

| ID | Title | Files touched | Acceptance |
|---|---|---|---|
| **1A** | Add ivfflat index to `olive_memory_chunks.embedding` | new migration `supabase/migrations/<ts>_chunks_vector_index.sql` | Index visible in `pg_indexes`; memory search latency drops measurably |
| **1B** | Frontend CI gate on PR | new `.github/workflows/frontend-ci.yml` | Runs `npm ci && npm run lint && tsc --noEmit && npm run build` on PRs touching `src/`, `package.json`, `vite.config.ts`. Fails the PR on any error. |
| **1C** | Enable TypeScript strict (incremental) | `tsconfig.app.json` — flip `strict: true` + `noImplicitAny: true` + `strictNullChecks: true` in one PR; allow per-file `// @ts-nocheck` opt-out for files with > 5 errors as a holding pen | `tsc --noEmit` passes; track holding-pen file count in `PROGRESS.md` and burn down weekly |
| **1D** | Vitest + first 5 frontend tests | `vitest.config.ts`, `src/test-setup.ts`, add `vitest` to devDeps; write tests for `useSupabaseNotes`, `useExpenses`, `i18n init`, `LanguageProvider`, `App routing` | All 5 tests green; CI runs them |
| **1E** | Redact PII in logs | grep for `console.log.*phone`, `console.log.*email` across `supabase/functions/`; replace phone with last-4 mask, email with hash | No raw PII in logs (verify via runtime logs of one cron tick) |
| **1F** | CSP + security headers | `vercel.json` — add `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` | Headers visible in response (curl -I); no console CSP errors in dev |

**Exit criteria phase 1:**
- All 6 tasks merged
- CI red on a deliberate test commit (`any` cast + missing toast t() in a fresh PR)
- Vector index visible in `pg_indexes` on `olive_memory_chunks`

---

### Phase 2 — Break up the monoliths (weeks 2–4)

Goal: refactor the three biggest edge functions into testable modules, **without changing behavior**. Land each refactor behind a snapshot test.

**Strategy:** for each monolith — (1) write characterization tests that pin current behavior, (2) extract modules one at a time, (3) re-run snapshots, (4) commit per module.

**Task 2A — `whatsapp-webhook/index.ts` (10,502 → ~800 lines)**

Extract in this order (each is its own PR):

| Step | Module | Lines extracted | New location |
|---|---|---|---|
| 2A.1 | Localization & response templates | 180–835 | `_shared/whatsapp-localization.ts` |
| 2A.2 | Gateway session management | 861–917 | `_shared/whatsapp-session.ts` |
| 2A.3 | Outbound-context retrieval | 919–1071 | `_shared/whatsapp-outbound-context.ts` |
| 2A.4 | Cluster note writer | 1098–1353 | `_shared/cluster-note-writer.ts` |
| 2A.5 | AI classification + intent router | 1652–1847 | already partly in `_shared/intent-classifier.ts` — collapse the inline duplication |
| 2A.6 | Skill matching | 1863–1953 | `_shared/skill-matching.ts` |
| 2A.7 | Meta payload parsing | 2043–2150 | `_shared/meta-message-parser.ts` |
| 2A.8 | Media handling | 1994–2037 | `_shared/media-handling.ts` |

After step 2A.8, `whatsapp-webhook/index.ts` should be the **router only** — receive request, look up session, classify, dispatch.

**Task 2B — `process-note/index.ts` (3,131 → ~400 lines)**

| Step | Module | Lines | New location |
|---|---|---|---|
| 2B.1 | Link extraction | 27–85 | `_shared/link-extractor.ts` |
| 2B.2 | Calendar auto-sync | 87–220 | `_shared/note-calendar-auto.ts` |
| 2B.3 | Input style detection | 222–275 | `_shared/note-style-detector.ts` |
| 2B.4 | Media summarization | 276–707 | `_shared/media-summarizer.ts` |
| 2B.5 | Audio transcription | 708–785 | `_shared/audio-transcriber.ts` |
| 2B.6 | Receipt detection | 792–886 | merge into existing `_shared/expense-detector.ts` or new `_shared/receipt-detector.ts` |
| 2B.7 | Multimodal analysis | 887–1306 | `_shared/media-analyzer.ts` |
| 2B.8 | Memory & knowledge extraction | 1307–1540 | `_shared/memory-extractor.ts` |

**Task 2C — De-duplicate `ask-olive-individual` and `ask-olive-stream`**

The two share intent classification, pending-offer mgmt, web-session tracking, action execution. Goal: collapse to a `_shared/ask-olive-core.ts` with two thin entry points (request/response vs streaming).

**Task 2D — Centralize CORS headers** — `_shared/cors-headers.ts` exporting one constant; replace inline `const corsHeaders = {...}` in 72 functions via a single search-and-replace PR.

**Task 2E — Move all inline prompts to `_shared/prompts/` registry**

For each of the 10 violations listed in P0-8: create `_shared/prompts/<intent>.ts` with `export const PROMPT_<NAME>_V1 = '...'`; import in the function; pass the version string to `llm-tracker.ts` so we can A/B compare versions.

**Task 2F — Wrap the 4 untracked Gemini calls**

Each must go through `resilient-genai.ts` + emit a row to `olive_llm_calls` via `llm-tracker.ts`. Specific lines:
- `ask-olive-individual/index.ts:1802`
- `process-receipt/index.ts` (single Gemini block)
- `olive-workflows/index.ts` (follow-up message generation)
- `analyze-notes/index.ts:120` (raw fetch — kill it, use the SDK wrapper)

**Exit criteria phase 2:**
- All 4 monoliths < 1,000 lines
- Each extracted module has a co-located `.test.ts` (target ≥ 60% line coverage)
- Zero inline prompts; zero untracked Gemini calls (grep proves it)
- `_shared/cors-headers.ts` imported by every edge function

---

### Phase 3 — Multi-locale parity & UI rigor (weeks 4–5, runs in parallel with phase 2 tail)

Goal: a Spanish or Italian user can complete every flow without hitting English.

**Task 3A — Move `oliveHelp.ts` to i18n**

- Create `public/locales/<locale>/help.json` (3 files: en, es-ES, it-IT)
- Move all article titles, summaries, and bodies to keys: `help.articles.<slug>.title`, `help.articles.<slug>.body`
- Refactor `oliveHelp.ts` to a typed manifest (slug + i18n key) only; bodies fetched via `t()`
- Translate ES + IT via Gemini Pro batch translation (track in `CHANGES.md` per article)

**Task 3B — Wrap toast/placeholder/aria-label violations**

Target list (from audit):
- `PartnerInfo.tsx` — 8 toasts at lines 30, 78, 81, 91, 95, 114, 175, 188
- `AcceptInvite.tsx` — 7 toasts
- `InviteFlow.tsx` — 6 toasts
- `ExpenseSplitCard.tsx` — 5 toasts + 2 placeholders
- `PollCard.tsx` — 4 toasts
- `NoteDetails.tsx` — 4 placeholders + 3 SelectItems (lines 387, 402, 405–407, 673, 699)
- `Expenses.tsx` — 2 placeholders + currency SelectItems (lines 242, 249–251, 726)
- `Profile.tsx` — 8 title/alt attrs
- `AnalyticsDashboard.tsx` — 7 title attrs
- `NotificationsCenter.tsx` — 5 title attrs

Add new keys to namespaces; never invent new namespaces unless coherent (currency labels → `common.currency.usd/eur/gbp`; priority → `notes.priority.low/medium/high`).

**Task 3C — Fix `agentDetail` key parity** — copy from `en/profile.json` to `es-ES/profile.json` and `it-IT/profile.json`.

**Task 3D — Add lint rule for hardcoded strings**

ESLint custom rule `i18next/no-literal-string` (or `eslint-plugin-i18next`) configured for `src/**/*.tsx` with allow-list for icons, brand names, dev-only strings. Run in CI. New violations fail the PR.

**Task 3E — Add localized AI responses to all WhatsApp templates**

Audit `_shared/prompts/whatsapp-prompts.ts` — every system prompt should include `"Respond in {{user_language}}"`. Already partly done; complete the audit.

**Exit criteria phase 3:**
- All flows tested in IT and ES via Playwright snapshot tests (3 critical paths: sign-up, capture note, view list)
- Lint rule active in CI
- Help center available in all 3 languages
- `agentDetail` parity restored

---

### Phase 4 — Mobile / iOS native feel (weeks 5–7)

Goal: iOS users get a native-feeling app, not a wrapped website.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| **4A** | Lazy-load heavy routes | `src/App.tsx` — `React.lazy()` for `Admin`, `Knowledge`, `AgentDetail`, `Profile`, `Legal*`, `NoteDetails` | Initial JS bundle drops ≥ 30%; first-paint TTI improves |
| **4B** | Manual vendor chunk splitting | `vite.config.ts` — split `react`, `radix`, `framer-motion`, `recharts`, `embla`, `clerk` into named chunks | Vendor chunk < 300 KB gzipped |
| **4C** | Fix raw `hover:` classes | grep `hover:` not preceded by `md:` across `src/components/` and `src/pages/` — convert to `md:hover:` on tap-targets. ~40 instances. | No "sticky hover" on tap (verify on real iPhone) |
| **4D** | Touch target audit | Tab bar icons `MobileTabBar.tsx:106–107` — increase to `h-11 w-11`; same for icon-only buttons in `NoteRecap`, `NoteMediaSection`, `PartnerInfo` | All interactive elements ≥ 44×44 |
| **4E** | Wire haptics on core flows | `NoteInput.tsx` (success on save), `TaskItem.tsx` (light on toggle), `AskOliveChatGlobal.tsx` (light on send) — call from `useHaptics` | Manual QA on iPhone confirms vibration |
| **4F** | Dark mode | wire `ThemeProvider` from `next-themes` in `src/App.tsx`; respect system preference via `defaultTheme="system"`; add toggle in `src/pages/Profile.tsx`; verify `index.css` dark vars (already defined lines 136–198) | System dark mode visibly switches the app |
| **4G** | Pull-to-refresh on Home + Lists | new `src/components/PullToRefresh.tsx` (Capacitor-aware); wire to `Home.tsx`, `Lists.tsx`, `CalendarPage.tsx` data fetches | Pull-down gesture re-fetches |
| **4H** | Image w/h attrs | add `width` + `height` (or `aspect-ratio` CSS) to 12 `<img>` tags identified in audit | Lighthouse CLS < 0.05 |
| **4I** | Push notifications scaffold | install `@capacitor/push-notifications`, register APNs, create `notifications` table, edge function `send-push`; first use case: partner-added-note | Test push lands on real iPhone |
| **4J** | Camera plugin: ship or remove | decide — wire it to `NoteInput.tsx` for photo capture, OR remove from `package.json` + `Info.plist` | No dead dependency |
| **4K** | Scroll-into-view on bottom-sheet inputs | `AskOliveChatGlobal.tsx`, `QuickEditBottomSheet.tsx` — `inputRef.scrollIntoView({block:'center'})` on focus | Keyboard never covers the field |

**Exit criteria phase 4:**
- Lighthouse mobile ≥ 85 on home page
- Manual iOS QA on iPhone 14 Pro + iPhone SE: every page, dark mode toggle, push notification, pull-to-refresh
- Bundle analyzer shows < 300 KB gzipped vendor chunk

---

### Phase 5 — Database performance + reliability (week 6, parallel)

| ID | Task | New migration | Acceptance |
|---|---|---|---|
| **5A** | BM25 / FTS column + GIN index | add `tsvector` generated column on `olive_memory_chunks` (over `summary || ' ' || original_text`), GIN index; same on `clerk_notes` | Vector + FTS hybrid query plan uses both indices |
| **5B** | Hybrid search SQL function | `search_memory_hybrid(user_id, query, embedding)` returns rank-fused results (70% vector, 30% BM25) | Function exists; called from `_shared/memory-retrieval.ts` |
| **5C** | Index `olive_outbound_queue(scheduled_for, status)` | new migration | Heartbeat cron query plan uses index |
| **5D** | Index `expenses(user_id, created_at)` and `(couple_id, category)` | new migration | Monthly expense queries < 50 ms |
| **5E** | Index `olive_memory_contradictions(user_id, created_at)` | new migration | Pagination queries fast |
| **5F** | Trigger governance | add `supabase/migrations/TRIGGERS.md` doctrine: every new trigger needs (1) PR template justification, (2) co-located test, (3) idempotency proof. Audit existing two triggers; add tests. | Doctrine merged; both existing triggers have tests |
| **5G** | Cron failure alerting | edge function `cron-monitor` checks `cron.job_run_details` for failures every 15 min; sends to a `cron_alerts` channel or to `olive_llm_calls` errors table | A simulated cron failure produces a notification |
| **5H** | Move literal anon JWT out of cron SQL | refactor cron jobs to call edge function with header from secrets table | No bearer tokens hardcoded in `pg_cron.command` |

---

### Phase 6 — Observability & continuous quality (weeks 7–8)

| ID | Task | Acceptance |
|---|---|---|
| **6A** | Sentry (or Highlight, or self-hosted) for frontend + edge functions | Crashes show stack traces with sourcemaps |
| **6B** | Slot-level token logging dashboard | per CLAUDE.md / Engineering Plan Phase 1 already exists — verify rows in `olive_llm_calls` capture `slot_tokens_*` |
| **6C** | Weekly analytics query as scheduled Slack/email | the SQL in the skill's section 21, sent every Monday |
| **6D** | Error budget per intent | "P95 latency < 800 ms for SEARCH, < 1.5 s for CHAT" — surface in admin dashboard |
| **6E** | Bundle-size regression check | `size-limit` in CI; fail if bundle grows > 5% on a PR without exemption |

---

## 3. The single-day quick wins (do these tomorrow morning)

These are < 2 hours each and reduce risk immediately:

1. **Add ivfflat index to `olive_memory_chunks.embedding`** (task 1A) — ~5 min of SQL, biggest payoff per minute in the whole repo.
2. **Flip `tsconfig.app.json` to `strict: true`** with per-file `// @ts-nocheck` opt-out (task 1C) — sets the floor, prevents new debt.
3. **Add the frontend CI workflow** (task 1B) — copy-paste from any modern Vite repo.
4. **Add the missing `agentDetail` key to ES + IT** (task 3C) — 30 seconds.
5. **Centralize CORS headers** (task 2D) — single replace across all edge functions, saves 72 files of duplication.
6. **Redact phone numbers in logs** (task 1E) — privacy + compliance, ~30 min.

---

## 4. What we are explicitly NOT doing

These are tempting but out of scope for the 10x programme. Listed so they don't sneak in:

- Switching frameworks (no Next.js migration)
- Adding new backend servers (no Node services — Supabase Edge only)
- Adding more locales beyond en/es-ES/it-IT until existing ones are 100% covered
- Major schema renames (`clerk_*` → `olive_*` etc.) — cosmetic
- Rewriting orchestrator.ts — it's 1,500 lines but cohesive, and the engineering plan already addresses it in Phases 1–2
- Multi-tenant B2B until consumer is rock-solid

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| Vector index build on production locks reads | `CREATE INDEX CONCURRENTLY`; build off-hours; have a `DROP INDEX CONCURRENTLY` rollback ready |
| `strict: true` reveals 500+ errors | Per-file `// @ts-nocheck` holding pen; burn down weekly with named owners |
| Refactor of `whatsapp-webhook` breaks production WhatsApp | Characterization tests first; deploy to preview number for 48 h before prod; keep monolith file under a feature flag for first 2 weeks |
| Moving prompts to `_shared/prompts/` breaks A/B history | Version every prompt with `V1` suffix; never edit existing constants — add `V2` instead |
| Dark mode wiring breaks Clerk UI theming | Test Clerk sign-in/up flows in light + dark before merging |
| Lazy-loaded routes flash blank screen | Add `<Suspense fallback={<RouteSkeleton/>}>` per route, not at App root |

---

## 6. Tracking

This plan lives at `OLIVE_10X_PLAN.md` in the repo root.

- Each task gets a `TASK-10X-<id>` prefix in commit messages
- `CHANGES.md` row per merged task: `| date | TASK-10X-1A | files | description |`
- Weekly review: count completed tasks, current bundle size, current `any` count, current `% i18n coverage`, vector-search P95 latency
- Phase exits gated by the criteria listed above — no slipping

---

## 7. What "10x better" looks like at the end

| Dimension | Today | After |
|---|---|---|
| Vector search P95 | Unknown / sequential scan | < 100 ms on 100k chunks |
| Memory search recall@10 | Vector-only | Hybrid (vector + BM25) |
| Largest edge function | 10,502 lines | < 1,000 lines |
| Frontend tests | 0 | ≥ 80 covering critical paths |
| TypeScript strict | Off | On (≤ 20 files in holding pen) |
| `any` in src/ | 277 | < 50 |
| i18n hardcoded strings | ~150 violations | 0 (enforced by lint) |
| Help content localized | en only | en + es-ES + it-IT |
| Inline LLM prompts | 10 | 0 (all in `_shared/prompts/`) |
| Untracked Gemini calls | 4 | 0 |
| CI gates on PR | 3 (eval, migration-lint, calendar-smoke) | 6 (+ frontend CI, size-limit, lint-i18n) |
| iOS Lighthouse mobile | unknown | ≥ 85 |
| Push notifications | none | live |
| Dark mode | unwired | system-aware toggle |
| Vendor bundle gzipped | unknown / monolithic | < 300 KB, manual chunks |
| Cron failure visibility | silent | alerted within 15 min |

---

## 8. Open questions for GV

1. Is the `oliveHelp.ts` content stable enough to commit to translation now, or is it still being reshaped?
2. Push notifications — is the team OK with APNs cost / Apple Developer Program prerequisite, or should the first version be WhatsApp-only nudges via the existing gateway?
3. Dark mode — do we want a user toggle, or system-respect-only?
4. For `whatsapp-webhook` refactor — is there a staging WhatsApp number we can route to during phase 2A?
5. Should the BM25 / hybrid search work be its own engineering bet, or rolled into the existing memory rewrite already on the engineering plan?

---

*"She remembers, so you don't have to." — Make the promise true at scale by making the system worthy of the promise.*
