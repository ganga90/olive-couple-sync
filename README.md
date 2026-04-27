# Olive — Couple Sync

Olive is an AI-powered personal assistant that captures unstructured thoughts
(text, voice, photos, links) from web, iOS, and WhatsApp and auto-organizes
them into tasks, lists, calendar events, reminders, and expenses. She learns
user preferences over time and proactively surfaces what matters.

See `OLIVE_SYSTEM_PROMPT.md` for the full product + architecture reference and
`CHANGES.md` for the rolling engineering log.

## How can I edit this code?

**Use your preferred IDE (recommended)**

Clone the repo and push to GitHub. The `dev` branch deploys a preview via
Vercel; `main` deploys production.

```sh
# 1. Clone
git clone <YOUR_GIT_URL>
cd <YOUR_PROJECT_NAME>

# 2. Install
npm i

# 3. Start dev server
npm run dev
```

**Edit a file directly in GitHub** — pencil icon → commit.

**GitHub Codespaces** — Code → Codespaces → New codespace.

## Branching + deploys

- `dev` — preview branch. Every push triggers a Vercel preview deploy for
  manual QA. Edge-function changes require `supabase functions deploy ...`
  from the working tree.
- `main` — production. Promotions from `dev` happen via PR + review.

Do not push directly to `main`. Open a PR from `dev`.

## Tech stack

- Vite + React 18 + TypeScript 5
- Tailwind CSS v3 + shadcn/ui (Radix)
- TanStack Query + React Context (auth / couple / notes)
- Supabase (Postgres + Edge Functions on Deno)
- Google Gemini (Flash-Lite / Flash / Pro) via `_shared/model-router.ts`
- Clerk (auth), synced to Supabase via `clerk-sync` edge function
- Capacitor (iOS build target)

## Deploying

- **Frontend:** Vercel (auto-deploy on push to `dev` → preview; `main` → production).
- **Edge functions:** `supabase functions deploy <name>` per function.
- **DB migrations:** `supabase db push` (migrations under `supabase/migrations/`).
- **Custom domain:** Configure on Vercel (Project → Settings → Domains).

## Tests

Edge-function unit tests are co-located with each function as `*.test.ts`
(Deno). Run the full `_shared/` suite:

```sh
deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env
```

## MCP server

`mcp-server/` is a standalone Node package that exposes Olive's note,
list, reminder, and couple-sync capabilities via the [Model Context
Protocol](https://modelcontextprotocol.io/), so external AI assistants
(Claude Desktop, etc.) can read and write Olive data.

Build and configuration are documented in
[`mcp-server/README.md`](mcp-server/README.md).
