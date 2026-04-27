# Olive — repo brain

This file is loaded into every Claude Code session at startup. It is the single canonical source of truth for how to work in this repo. Read it before doing anything else.

For deeper product context, voice, the five differentiation pillars, the three architectural primitives, and full schema reference, also load the Olive skill (`anthropic-skills:olive`) — that's the long-form playbook. This file is the operational compass.

---

## What Olive is

Olive is **shared memory for the people you care about**. Lives in WhatsApp (1:1 + groups up to 9), web app at witholive.app, and iOS via Capacitor. Captures naturally from conversation, surfaces what matters when it matters. Built by GV Digital Labs, Miami. Live beta — free during beta, $0.99/month after.

**Tagline (do not change):** *"She remembers, so you don't have to."*

**Category frame:** Olive is **shared memory** — not a chatbot, not productivity software, not a notes app, not single-player AI. The enemy is the cognitive tax of being the one who remembers. Every feature should reduce that tax.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind, shadcn/ui, TanStack Query, React Router (locale-prefixed), i18next (en, es-ES, it-IT), Capacitor for iOS |
| Hosting | Vercel — auto-deploys from `dev` (preview) and `main` (prod) |
| Backend | Supabase Edge Functions (Deno runtime) — no other backend servers |
| Database | Supabase Postgres + RLS on every table |
| Auth | Clerk → synced to `clerk_profiles` via `clerk-sync` edge function |
| AI | Google Gemini (via `_shared/model-router.ts` + `resilient-genai.ts`); Anthropic Claude as fallback |
| Search | Hybrid: 70% vector (pgvector) + 30% BM25 |
| Scheduling | `pg_cron` + `pg_net` → 5 cron jobs hitting edge functions |
| WhatsApp | Meta Cloud API — 1:1 webhook live; groups in development |

**Repo:** [github.com/ganga90/olive-couple-sync](https://github.com/ganga90/olive-couple-sync) (working dir: `practical-lichterman/`).

---

## Branch model

- `dev` → Vercel preview deploy on every push
- `main` → production. **Never push directly.** PR from `dev` only.
- Feature branches → PR to `dev`.

Use `gh` CLI for everything GitHub. Open PRs against `dev` unless explicitly releasing.

---

## Non-negotiable engineering rules

Violating any of these is a critical failure. There are no exceptions.

1. **No regressions.** Run `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env` before AND after every change. Verify acceptance criteria pass.
2. **No hardcoded UI strings.** Everything user-facing goes through `t('namespace.key')`. Translation files in `public/locales/<locale>/<namespace>.json`. Three locales: en, es-ES, it-IT.
3. **No UTC-naive date logic.** Use helpers from `_shared/timezone-calendar.ts`. Never `new Date().toISOString()` for user-facing comparisons.
4. **No client-side admin checks.** Server-side only via `user_roles` table. Admin status never comes from `localStorage`.
5. **No secrets in logs.** Use `test -n "$VAR"` to check env vars. Never `echo` or print them.
6. **No inline LLM prompts.** All prompts in `supabase/functions/_shared/prompts/` with version string. Never inlined.
7. **No untracked Gemini calls.** Every call wraps `resilient-genai.ts` AND logs to `olive_llm_calls` via `llm-tracker.ts`.
8. **No new tables without RLS.** Every new table needs RLS scoped to `user_id`, `couple_id`, `space_id`, or `group_id`. No exceptions — RLS is what makes Olive's privacy moat.
9. **No new schema changes outside the migration doctrine.** See [MIGRATIONS.md](MIGRATIONS.md). One file per change, applied via MCP, committed in same PR as dependent code.
10. **Group privacy is sacred.** Personal `olive_memory_files` NEVER joined into group queries. Group notes scoped to `group_id` only.

---

## Schema changes — the rule

**Every schema change is a file in `supabase/migrations/<YYYYMMDDHHMMSS>_descriptive_name.sql`, applied to production via Supabase MCP `apply_migration`, committed to the repo in the same PR as the application code that depends on it.**

Three sub-rules, no exceptions:

1. **No dashboard SQL editor for schema changes.** Read-only inspection only.
2. **No `apply_migration` without a corresponding repo file.** The SQL must exist in `supabase/migrations/` first so PR review catches issues.
3. **The `name` argument to `apply_migration` must match the filename's descriptive_name segment.** Drift here breaks future grep-ability.

Full playbook: [MIGRATIONS.md](MIGRATIONS.md). Folder doctrine: [supabase/migrations/CLAUDE.md](supabase/migrations/CLAUDE.md).

---

## Testing protocol (every task)

1. Run `deno test supabase/functions/_shared/` before starting.
2. Write/update co-located `.test.ts` for any modified edge function.
3. For DB migrations: `supabase db reset --local` then re-test (see [MIGRATIONS.md](MIGRATIONS.md) for local setup).
4. For orchestrator changes: 10 test conversations across ≥3 intent types.
5. For group features: simulate 3+ participants.
6. Verify no spike in `error_count` in `olive_llm_calls`.
7. Commit only when all acceptance criteria are verified.

---

## Commit & progress protocol

**Commit format:** `[TASK-ID] Short description`

**After every commit, append to `CHANGES.md`:**
```
| 2026-04-27 | TASK-ID | files_touched | Description |
```

At 70% context, write `PROGRESS.md` with task ID, what's done, what's left, files modified.

---

## Critical reference docs

| Doc | Why |
|---|---|
| [MIGRATIONS.md](MIGRATIONS.md) | Schema migration doctrine + workflow |
| [OLIVE_BRAND_BIBLE.md](OLIVE_BRAND_BIBLE.md) | Voice, tone, copy |
| [SUPABASE_DEPLOYMENT_RECAP.md](SUPABASE_DEPLOYMENT_RECAP.md) | Backend architecture record |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Active engineering programme |
| [CHANGES.md](CHANGES.md) | Append-only log of every commit |

For full product context (the three primitives, five moats, brand voice in depth, intent classification, WhatsApp pipeline, memory system), load the **Olive skill** (`anthropic-skills:olive`).

---

## Closing directive

You are a world-class senior engineer on the Olive codebase. The goal is not speed — it is correctness. **Read before you write. Measure before you optimize. Test before you commit.**

The product relieves real cognitive burden from real people. Features that reduce the mental load of "being the one who remembers" are right. Features that add to it are wrong.

*"She remembers, so you don't have to."* — your job is to make that promise true at scale.
