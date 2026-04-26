---
name: olive
description: Load this skill whenever working on the Olive codebase (witholive.app). Provides full product context, positioning, architecture, engineering conventions, non-negotiable rules, and implementation guidance for the Olive AI shared-memory app built by GV Digital Labs. Trigger on any task involving Olive features, positioning/copy, Supabase edge functions, WhatsApp 1:1 or Group integration, Gemini AI calls, memory system, heartbeat agents, Clerk auth, or any file in the olive-couple-sync repo.
---

# Olive — Claude Code Skill
**Version:** 2.0 — April 2026
**Scope:** Canonical context for any Claude Code session working on the Olive codebase.
**Authority:** OLIVE_SYSTEM_PROMPT.md · OLIVE_Engineering_Plan.md · OLIVE_Differentiation_Playbook.md · github.com/ganga90/olive-couple-sync · witholive.app

---

## 0. Session Startup — Do This First

Before writing a single line of code, complete this checklist:

1. Read `OLIVE_SYSTEM_PROMPT.md` in full. It is the single source of truth for architecture.
2. Read `CHANGES.md` to understand what has already been done.
3. Read `PROGRESS.md` if it exists (prior session checkpoint).
4. Identify the current active task from `OLIVE_Engineering_Plan.md`. State it: *"I am beginning Task [ID]: [title]."*
5. Run `supabase db diff` to check for unsynced schema changes.
6. Run existing Deno tests before touching anything: `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env`

---

## 1. Product Vision, Architecture & Strategic Positioning

### The Vision (one paragraph — know this cold)
Olive becomes the AI you invite into your conversations — both 1:1 brain dumps and small group spaces of up to 9 humans — and she remembers everything that matters across them. Same product, same backend, multiple surfaces: consumer (couples, families, friend groups) and Olive for Real Estate as the first B2B vertical. Five compounding moats that hyperscalers structurally cannot replicate: brain dump capture, collaboration with privacy boundaries, personal assistant via capture-offer-confirm-execute, memory scoped to (member, space), knowledge base that self-validates through collective sense-making.

### The Three Architectural Primitives
**Everything in the codebase decomposes into these three.** New verticals don't add new primitives — they add new surfaces on the same backend. When a feature request arrives, ask which primitive it belongs to before designing anything.

**1. Space** — the universal container.
- 1 to 9 members
- Has a `type` (personal, couple, family, friends, real_estate_client, etc.) and a `role` per member
- Optional WhatsApp group binding (`wa_group_id`)
- All memory, notes, and compiled artifacts are scoped to `(member_id, space_id)` — never global

**2. Capture** — the atomic input unit.
- Has provenance (who sent it, from which channel, at what time)
- Has two independent classifications: `addressed_to_olive` (boolean) and `capturable` (boolean) — these are separate decisions
- Has a `topic_thread` (allows related captures to cluster)
- A Capture that is `capturable = true` gets processed into notes, expenses, reminders, etc. regardless of whether it was `addressed_to_olive`

**3. Compiled Artifact** — synthesized derived data.
- Scoped to `(member_id, space_id)` — never shared across spaces without explicit permission
- Event-driven recompilation, **not** nightly batch — a Capture event triggers recompilation of the relevant artifact
- Types: `compiled_profile`, `compiled_patterns`, `compiled_relationships`, `compiled_decisions` (group), `compiled_client_brief` (real estate)
- Token-budgeted: each artifact has a max token ceiling enforced at compile time

### The Five Moats (hyperscalers structurally cannot replicate these)
These are the reasons Apple Intelligence, ChatGPT Memory, and Google Gemini cannot simply copy Olive. Every engineering decision should preserve and deepen at least one moat.

| Moat | What it means in code |
|---|---|
| **Brain dump capture** | Passive ingestion from natural conversation — no structured input required. The `capturable` flag is set by AI, not the user. |
| **Collaboration with privacy boundaries** | Memory is scoped to `(member_id, space_id)`. A user's personal artifacts never leak into a group Space. RLS enforces this at the DB layer — it is not application logic. |
| **Capture → Offer → Confirm → Execute** | Olive doesn't silently act. She surfaces what she captured, proposes an action, waits for confirmation, then executes. This loop is Olive's core interaction contract — never collapse it into silent automation. |
| **Memory scoped to (member, space)** | The same person has different compiled artifacts in their personal space vs. their family space vs. their client space. Context is relational, not monolithic. |
| **Self-validating knowledge base** | Group conversations generate overlapping captures. Olive detects when two members' captures agree (reinforcement) or conflict (contradiction) and adjusts confidence accordingly. The knowledge base validates itself through collective sense-making. |

### What Olive Is (the category frame)
Olive is **shared memory for the people you care about.**

This is the category Olive defines and owns. Do not call Olive an "AI assistant" — that is a commodity category in 2026. Do not call it a "notes app," "chatbot," or "productivity tool." Those frames slot Olive into categories where she loses.

**Tagline:** "She remembers, so you don't have to." — do not change this.
**Elevator pitch:** "Olive is shared memory for the people you care about. She lives in WhatsApp and remembers everything that matters — across your 1:1s and your group chats."
**Company:** GV Digital Labs, Miami.
**Status:** Live beta at witholive.app — free during beta, $4.99/month after.

### The Team's Single Sentence (know this by heart)
> "We are building the shared memory layer for the most important conversations in people's lives — in the place those conversations already happen, for the people who already have them, captured without effort and surfaced when it matters."

Every product decision should make this sentence more true, not less.

### The Core Loop
**Drop it → Olive organizes → Find it instantly.**

**Input channels:** WhatsApp 1:1, WhatsApp Group chats (up to 9 people), web app (witholive.app), iOS app (Capacitor), voice notes.

**What Olive auto-creates:** tasks, lists, reminders, calendar events, expenses, saved links, shared group decisions.

### The Real Enemy
Olive doesn't compete against apps. The enemy is the **cognitive tax of being the one who remembers** — the invisible labor of being the household manager, default parent, relationship coordinator, or "most conscientious person in the group." Name this enemy in product copy and feature decisions. Features that reduce that tax are right. Features that add to it are wrong.

Examples of the enemy in real life:
- The 11pm question: "wait, did you book the restaurant?"
- Scrolling back through 600 group chat messages to find the agreed brunch time
- The repeated client conversation because the agent forgot they hate phone calls
- Nobody knowing whose turn it is to pick up from soccer
- The forgotten birthday that lived in Notes nobody opened

### The Five Differentiation Pillars
These are the proof points that ladder up to the positioning. Used on homepage, pitch decks, ad carousels, sales conversations — in this order (the order handles objections sequentially):

1. **Lives in WhatsApp** — no new app to learn. 3 billion people already use WhatsApp daily. Olive meets you where you already are.
2. **Captures without friction** — text it, voice-note it, photograph it. Olive figures out what matters. No tagging, no folders, no organizing.
3. **Works for everyone who matters** — solo brain dumps in 1:1. Shared spaces for couples, families, friend groups, and small teams (up to 9 people).
4. **Remembers across time, not just sessions** — the longer you use Olive, the more she knows. She doesn't forget when you close the app. She compounds.
5. **Acts on what she remembers** — captures become reminders, calendar events, lists, follow-ups. She offers, you confirm, she handles it.

### What Olive Is NOT (anti-positioning — enforce these in copy and feature work)
| Olive is NOT | Why this matters |
|---|---|
| A chatbot | ChatGPT/Claude/Gemini are tools you go *to* with questions. Olive is the opposite: she comes to you, listens, then answers when asked. |
| Productivity software | Notion/Asana/Trello require you to organize first. Olive captures *before* you think to organize. |
| A CRM | Salesforce/HubSpot make you type. Olive listens and remembers. |
| A notes app | Apple Notes/Mem are containers waiting to be filled. Olive captures from conversations you'd be having anyway. |
| Single-player AI | ChatGPT Memory / Apple Intelligence make *one person* smarter. Olive makes a *group* smarter together, with privacy boundaries. |

---

## 2. Brand Voice

### Voice Principles
- **Warm but not saccharine.** Smart friend, not customer service agent. No "I'm here to help you 24/7!"
- **Confident, not arrogant.** "She remembers." Not "She might remember if you set it up right."
- **Direct, not cute.** "Got it" beats "Got it! 🎉✨" every time.
- **Personal, not corporate.** Olive is a character with personality, not "the Olive Assistant platform."
- **Quietly clever.** Subtle wit beats wacky humor. Olive doesn't tell jokes; she notices things you didn't ask for.

### Voice is NOT
- Tech jargon ("AI-powered," "leveraging machine learning")
- Productivity bro ("10x your output," "supercharge your workflow")
- Performatively friendly (unnecessary exclamation points, emoji spam)
- Clinical ("platform," "solution," "leading provider of")

### The 🌿 Motif
The leaf emoji is Olive's signature mark — the visible trace of her presence. Use it consistently as the response prefix. Do not dilute it with other emojis. Never add ✨🎉💝🛒 to Olive's responses.

### Sample Exchanges — Correct vs Incorrect

**Brain dump:**
```
✅ User: "Buy milk on the way home"
   Olive: "🌿 Got it. Saved to your shopping list."

❌ Olive: "Got it! ✨ I've added 'buy milk' to your shopping list.
          Would you also like me to remind you when you're near a grocery store? 🛒"
```

**Photo capture:**
```
✅ User: [photo of wine label] "this was great"
   Olive: "🌿 Saved Caymus Cab '21 to your wines worth remembering."

❌ Olive: "Wow, that wine looks fantastic! 🍷 I've recognized it as Caymus Cabernet
          Sauvignon 2021 and saved it to your collection. Want me to find a similar
          bottle on Vivino? 🤔"
```

**Recall question:**
```
✅ User: "@Olive when's our anniversary again"
   Olive: "🌿 May 14. Three weeks from Saturday."

❌ Olive: "Great question! 🎉 Your wedding anniversary is on May 14th, which means
          you're celebrating 4 years of marriage! That's coming up in just 3 weeks.
          Want me to help you plan something special? 💝"
```

**The discipline: say less.** Every word that doesn't earn its place undermines the voice.

---

## 3. Audience-Specific Cuts

Same positioning across all segments. Proof points and emotional triggers adapt; the brand doesn't.

| Audience | Hook | Key proof points |
|---|---|---|
| **Couples** (consumer flagship) | "For the partner who's tired of being the calendar." | Daily digest, partner-mentioned-X surfaces, shared lists without nagging |
| **Families** (Q2 expansion) | "From soccer practice to grandma's recipe — Olive remembers everything your family is too busy to." | Family group chat integration, "what's happening this week," photo-captured recipes |
| **Trip-Planning Friends** (Q1 PMF wedge) | "Plan trips without scrolling back through 600 messages." | Group decision synthesis, contradiction resolution, trip-day summary |
| **Real Estate Agents** (Q3 B2B) | "Your clients told you what they wanted. Olive remembered." | Auto-extracted client preference summary, follow-up nudges, matched listings |
| **Wedding Planning** (Q4+) | "Wedding planning is a marathon. Don't run it from your head." | Decisions log across 18 months, budget tracker, vendor follow-ups |
| **Small Business Owners** (Q4+) | "Your business runs on conversations. Now they're remembered." | Per-client space, cross-team handoff with full context, no meeting notes needed |

---

## 4. Technology Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript 5 |
| Build | Vite 5 (deployed via Vercel) |
| Styling | Tailwind CSS v3 |
| UI Components | shadcn/ui (Radix primitives) |
| State | TanStack Query (server state), React Context (auth/couple/notes) |
| Routing | React Router v6 with locale-prefixed routes (`/es-es/home`, `/it-it/home`) |
| i18n | i18next + react-i18next — 3 locales: en, es-ES, it-IT |
| Native | Capacitor (iOS build target) |

### Backend
| Layer | Technology |
|---|---|
| Database | Supabase (PostgreSQL + RLS everywhere) |
| Auth | Clerk → synced to Supabase via `clerk-sync` edge function |
| Edge Functions | Supabase Edge Functions (Deno runtime) |
| AI Models | Google Gemini (Flash-Lite / Flash / Pro) via `_shared/model-router.ts` |
| Search | Hybrid: 70% vector similarity + 30% BM25 full-text |
| Encryption | AES-256-GCM field-level, per-user key derivation |
| Scheduling | pg_cron + pg_net → `olive-heartbeat` every 15 minutes |
| WhatsApp (1:1) | Meta Cloud API (inbound webhook + outbound gateway) |
| WhatsApp (Groups) | Meta Cloud API — Group messaging via Business Platform *(in development)* |
| Calendar | Google Calendar OAuth2 |
| Voice | Deepgram (live transcription) |
| Health | Oura Ring integration |

### Hard Constraints
- **No backend servers.** All server-side logic runs as Supabase Edge Functions.
- **No framework switching.** React only — no Next.js, Vue, Angular, Svelte.
- **No hardcoded UI text.** Every user-facing string uses `t('namespace.key')`.
- **Base font 16px minimum** (prevents iOS auto-zoom).

---

## 5. Repository Structure

**Repo:** `github.com/ganga90/olive-couple-sync`

**Branching strategy:**
- `dev` → Vercel preview deploy (every push auto-deploys for manual QA)
- `main` → production. Never push directly. PRs only from `dev`.

```
src/
├── components/           # Reusable UI (ui/, landing/, layout/, chat/, voice/, lists/, settings/, notifications/)
├── hooks/                # All custom React hooks (data fetching + business logic)
├── pages/                # Route-level page components
├── providers/            # React Context providers (Auth, Couple, Notes, Language)
├── types/                # TypeScript type definitions
├── constants/            # Static configuration
├── lib/                  # Utilities (i18n, AI service, context manager)
├── integrations/         # Supabase client, voice integration
└── utils/                # Helper functions

supabase/
├── functions/
│   ├── _shared/          # Shared utilities — import from here, never duplicate
│   │   ├── orchestrator.ts         # Context assembly pipeline
│   │   ├── intent-classifier.ts    # AI intent detection
│   │   ├── model-router.ts         # Dynamic Gemini tier selection
│   │   ├── resilient-genai.ts      # Retry + circuit breaker for Gemini
│   │   ├── llm-tracker.ts          # Cost/latency analytics per call
│   │   ├── encryption.ts           # AES-256-GCM
│   │   ├── timezone-calendar.ts    # Timezone-safe date helpers — ALWAYS use these
│   │   ├── natural-date-parser.ts  # NLP date extraction
│   │   ├── task-search.ts          # Semantic + keyword task matching
│   │   ├── expense-detector.ts     # Expense text parsing
│   │   ├── reminder-dedup.ts       # Deduplication before any outbound message
│   │   └── prompts/                # Versioned prompt registry — all prompts live here
│   └── [function-name]/index.ts    # Individual edge functions
├── migrations/           # Sequential timestamped SQL migrations
└── config.toml

public/
└── locales/              # i18n translation files
    ├── en/
    ├── es-ES/
    └── it-IT/
```

**Key pages:** Home, Lists, Calendar, Reminders, Expenses, Profile, Knowledge, MyDay, Admin.

---

## 6. Non-Negotiable Engineering Rules

Violating any of these is a critical failure. There are no exceptions.

| Rule | Detail |
|---|---|
| **No regressions** | Run existing tests before AND after every change. Commit only after all acceptance criteria pass. |
| **No hardcoded strings** | All UI text through `t('namespace.key')`. Zero exceptions. |
| **No UTC-naive date logic** | Use `timezone-calendar.ts` helpers always. Never `new Date().toISOString()` for user-facing date comparisons. |
| **No client-side admin checks** | Server-side only. Admin status never comes from `localStorage`. |
| **No secrets in logs** | Use `test -n "$VAR"` to check env vars. Never `echo`. |
| **No inline prompts** | All prompts in `_shared/prompts/` with version string. Never inline in function code. |
| **No new LLM calls without tracking** | Every Gemini call must use `resilient-genai.ts` wrapper AND log to `olive_llm_analytics` via `llm-tracker.ts`. |
| **No new tables without RLS** | Every new table needs Row-Level Security scoped to `user_id`, `couple_id`, or `group_id`. |
| **No new DB columns without migration** | All schema changes go in `supabase/migrations/<timestamp>_<description>.sql`. Include reversible DOWN comments. |
| **Group privacy is sacred** | Individual 1:1 memory files NEVER leak into group context. Group notes are scoped to `group_id` only. |

---

## 7. Key Shared Utilities — How to Use Them

### model-router.ts — Always use this for tier selection
```typescript
// Never hardcode model strings. Always route through this.
const decision = routeIntent(intent, confidence);
// Returns: { tier: "db_only" | "flash-lite" | "flash" | "pro", reason: string }
```

Tier selection guide:
- `db_only` — complete, delete, set_due, archive (high confidence)
- `flash-lite` — expense parsing, simple extraction, entity recognition, group attribution
- `flash` — general chat, search formatting, group synthesis
- `pro` — complex reasoning, weekly summaries, planning, receipt scanning, group decision synthesis

### resilient-genai.ts — Always wrap Gemini calls
Provides exponential backoff (2s → 30s), circuit breaker (opens after 5 failures, 1-min cooldown), and Anthropic Claude fallback (Sonnet for Pro/Flash, Haiku for Flash-Lite) after 2 retries.

### timezone-calendar.ts — Always use for date logic
```typescript
// Get UTC window for "today" in user's timezone
getRelativeDayWindowUtc(reference, timeZone, dayOffset)

// Format a time for display in user's timezone
formatTimeForZone(isoString, timeZone)
```

### reminder-dedup.ts — Run before every outbound message
Prevents duplicate notifications even if multiple triggers fire for the same task. Applies to both 1:1 and group outbound messages.

### orchestrator.ts — Context assembly for LLM calls
Assembles context slots in priority order. The formal `ContextContract` interface defines slots: `SLOT_IDENTITY` (200 tokens), `SLOT_USER` (650 tokens), `SLOT_INTENT_MODULE` (200 tokens), `SLOT_DYNAMIC` (800 tokens), `SLOT_HISTORY` (600 tokens), `SLOT_QUERY` (400 tokens). Total budget: 2,850 tokens. Group context is injected into `SLOT_DYNAMIC` with speaker attribution.

---

## 8. Intent Classification

### WhatsApp Shortcut Prefixes
| Prefix | Intent | Example |
|---|---|---|
| `?` | SEARCH | `?groceries` |
| `!` | CREATE (urgent) | `!call doctor NOW` |
| `+` | CREATE | `+buy milk` |
| `/` | CHAT | `/plan my weekend` |
| `$` | EXPENSE | `$25 lunch` |
| `@` | TASK_ACTION (assign) | `@partner pick up kids` |

### AI-Classified Intents
`CREATE`, `SEARCH`, `CHAT`, `CONTEXTUAL_ASK`, `WEB_SEARCH`, `TASK_ACTION`, `EXPENSE`, `PARTNER_MESSAGE`, `CREATE_LIST`, `LIST_RECAP`, `SAVE_ARTIFACT`, `MERGE`

**Group-specific intents (in development):** `GROUP_DECISION`, `GROUP_RECAP`, `GROUP_ASSIGN`, `GROUP_POLL`

**Key classification rules:**
- Noun phrases or messages with media → CREATE (brain-dump)
- Messages ending in `?` or matching a list name → SEARCH / CONTEXTUAL_ASK
- New users: 0.95+ confidence bias toward CREATE
- Long messages (>120 chars) or assistive signals ("draft", "plan") → CHAT override
- Partner relays ("remind [Partner] to...") → PARTNER_MESSAGE
- Group messages with "@Olive" mention → parse for GROUP_* intent first

---

## 9. WhatsApp Integration

### 1:1 Pipeline (existing — whatsapp-webhook)
Meta Cloud API → webhook → phone lookup → intent classify → handler:
- CREATE → `process-note` (AI categorize + split) → `clerk_notes`
- EXPENSE → parse amount/category → `expenses`
- SEARCH → query `clerk_notes` + `calendar_events` → formatted reply
- CHAT → full context via orchestrator → Gemini → reply
- TASK_ACTION → find task → update (complete/delete/reschedule)
- PARTNER_MESSAGE → relay via WhatsApp gateway

### Outbound (whatsapp-gateway + send-reminders)
- Check 24h Meta messaging window
- Inside window → free-form text; outside → pre-approved templates only
- Always: enforce quiet hours, run `reminder-dedup.ts`, never skip

### Voice Notes
Transcribed by Gemini multimodal. Treated as CREATE intent.

### Multi-task splitting
"buy milk, call dentist, book flights" → 3 separate `clerk_notes` entries.

---

## 10. WhatsApp Group API Integration *(in development — currently parked)*

This is a strategic product priority. Olive in group chats is the primary wedge for: families, trip-planning friends, real estate agent + client groups, wedding planning, and small business teams (up to 9 members per group).

> **NOTE — April 2026:** Groups work is on standby. Current focus is quality of 1:1 experience. Do not propose group features unless explicitly asked.

### How Group Mode Works (product behavior)
- User adds Olive's WhatsApp number to a group chat
- Olive listens passively — only responds when mentioned (`@Olive`) or when a direct command prefix is used
- Olive attributes every captured item to the sender (`clerk_profiles` lookup by phone number)
- Group notes are stored in a shared group space (scoped to `group_id`) separate from each member's personal memory
- Individual 1:1 memory files are NEVER surfaced in group context (RLS enforced)

### Supported Group Interactions
```
@Olive what did we decide about the hotel?     → GROUP_RECAP (searches group notes)
@Olive save this                               → CREATE (captures preceding message)
@Olive remind everyone tomorrow at 9am         → GROUP_ASSIGN (sends to all members)
/recap                                         → GROUP_RECAP (last 24h decisions summary)
```

### Group-Specific Technical Requirements

**New edge function:** `whatsapp-group-webhook` (separate from 1:1 webhook)
- Receives group message events from Meta Cloud API
- Identifies `wa_group_id` from payload, maps to `olive_group_sessions`
- Determines if Olive is mentioned; if not, queues message for passive capture
- Routes to intent handler with group context assembled

**Passive capture mode:**
- Messages NOT mentioning @Olive are buffered in `olive_group_message_buffer`
- Every 15 minutes (or when @Olive is mentioned), buffer is processed by Gemini Flash-Lite
- Decisions, preferences, commitments, dates, and expenses are extracted and saved as group notes
- Noise (greetings, reactions, off-topic chat) is discarded

**Group context in orchestrator:**
- `SLOT_DYNAMIC` includes last 5 group decisions + active member list
- Speaker attribution format: `"[Maria]: 'I prefer the beach house option'"`
- Token cap for group context: 400 tokens within `SLOT_DYNAMIC` budget

**Privacy enforcement:**
- `RLS on olive_group_notes`: members can only read notes from groups they belong to (`group_id` + `user_id` in `olive_group_members`)
- Member A's personal `olive_memory_files` are never joined with group queries
- Leaving a group revokes read access to that group's notes immediately

### New Database Tables for Groups

```sql
-- WhatsApp group session (one per WA group)
CREATE TABLE olive_group_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_group_id text UNIQUE NOT NULL,
  group_name text,
  created_by uuid REFERENCES clerk_profiles(id),
  created_at timestamptz DEFAULT now(),
  message_count integer NOT NULL DEFAULT 0,
  compact_summary text,
  last_compacted_at timestamptz,
  is_active boolean DEFAULT true
);

CREATE TABLE olive_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES olive_group_sessions(id) NOT NULL,
  user_id uuid REFERENCES clerk_profiles(id) NOT NULL,
  phone_number text NOT NULL,
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(group_id, user_id)
);

CREATE TABLE olive_group_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES olive_group_sessions(id) NOT NULL,
  captured_by uuid REFERENCES clerk_profiles(id),
  content text NOT NULL,
  category text,
  source_message_id text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE olive_group_message_buffer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES olive_group_sessions(id) NOT NULL,
  sender_phone text,
  content text NOT NULL,
  wa_message_id text,
  received_at timestamptz DEFAULT now(),
  processed boolean DEFAULT false
);
```

All four tables require RLS scoped to group membership (`group_id` via `olive_group_members`).

### New Environment Variables for Groups
| Variable | Purpose |
|---|---|
| `META_WHATSAPP_GROUP_WEBHOOK_TOKEN` | Separate verification token for group webhook |

### Group Feature Rollout Order
1. Passive capture + `@Olive` mention response (MVP)
2. `/recap` and `GROUP_RECAP` intent
3. `GROUP_ASSIGN` (send reminder to all members)
4. Group-level heartbeat agent (Weekly Group Sync)
5. Group shared spaces visible in web app

---

## 11. Database — Key Tables Reference

### Core Data
| Table | Purpose |
|---|---|
| `clerk_profiles` | User profiles (name, phone, timezone, language, avatar) |
| `clerk_couples` | Couple/household entities |
| `clerk_couple_members` | Members with roles |
| `clerk_notes` | All tasks/notes — the core data model (1:1 context) |
| `clerk_lists` | User-created lists |
| `calendar_events` | Synced/created calendar events |
| `expenses` | Tracked expenses with categories |

### Group Data (new — parked)
| Table | Purpose |
|---|---|
| `olive_group_sessions` | One per WhatsApp group |
| `olive_group_members` | Members per group (max 9) |
| `olive_group_notes` | Group-scoped captured decisions/notes |
| `olive_group_message_buffer` | Passively received messages pending processing |

### Olive Intelligence
| Table | Purpose |
|---|---|
| `olive_memory_files` | Persistent memory (profile, daily logs, compiled artifacts) |
| `olive_memory_chunks` | Vector-embedded memory segments |
| `olive_patterns` | Detected behavioral patterns |
| `olive_user_preferences` | Proactive feature settings |
| `olive_skills` / `olive_user_skills` | Skill definitions + user installs |
| `olive_knowledge_entities` | Knowledge graph nodes |
| `olive_knowledge_relationships` | Knowledge graph edges |
| `olive_memory_contradictions` | Contradiction detection + resolution |

### Infrastructure
| Table | Purpose |
|---|---|
| `olive_heartbeat_jobs` | Scheduled background job queue |
| `olive_llm_analytics` | LLM usage (cost, latency, model, slot tokens, provider) |
| `olive_router_log` | Intent routing decisions |
| `olive_gateway_sessions` | WhatsApp 1:1 session state + compaction |
| `olive_outbound_queue` | Queued outbound WhatsApp messages |

**Migration rule:** All writes include `shared_space_id` (couple context) or `group_id` (group context) where applicable.

---

## 12. Memory System

Olive maintains per-user persistent memory (1:1 context — never shared into groups):

- **`PROFILE.md`** — Long-term facts (preferences, partner name, dietary restrictions, timezone)
- **Daily Logs** — Timestamped interaction summaries, compiled nightly
- **Compiled Artifacts** — Pre-built context artifacts stored in `olive_memory_files`:
  - `compiled_profile` (~400 tokens) — structured user narrative
  - `compiled_patterns` (~150 tokens) — top behavioral patterns
  - `compiled_relationships` (~100 tokens) — knowledge graph entities
- **Memory Chunks** — Granular segments with vector embeddings
- **Knowledge Graph** — Entities + relationships from notes

**Context assembly priority:** profile > recent tasks > patterns > old memories
**Contradiction resolution:** AUTO_RECENCY (newer chunk wins) is the default strategy.

---

## 13. Proactive Intelligence (Heartbeat)

`pg_cron` triggers `olive-heartbeat` every 15 minutes. It:
- Checks each user's timezone and quiet hours (22:00–07:00 default)
- Executes due jobs from `olive_heartbeat_jobs` queue
- Runs background agents per `olive_user_preferences`
- **(New)** Processes `olive_group_message_buffer` for passive group capture

**Background Agents:**
| Agent | Function |
|---|---|
| Stale Task Strategist | Detects old uncompleted tasks, suggests action |
| Smart Bill Reminder | Tracks recurring expenses, reminds before due |
| Energy Task Suggester | Matches tasks to Oura energy levels |
| Sleep Optimization Coach | Oura Ring sleep insights |
| Birthday Gift Agent | Tracks birthdays, suggests gifts |
| Weekly Couple Sync | Generates couple productivity summary |
| Weekly Group Sync *(new — parked)* | Generates shared weekly summary for active groups |
| Email Triage Agent | Prioritizes and summarizes inbox |

**Reliability:** Exponential backoff 2s→30s, circuit breaker after 5 failures, rate limiting configurable per user.

---

## 14. Responsive Design Rules

| Viewport | Navigation | Dialogs |
|---|---|---|
| Mobile (<768px) | Fixed bottom tab bar | Bottom sheets / drawers |
| Desktop (≥768px) | Fixed left sidebar + context rail | Centered modals |

**iOS Native feel:**
- Safe area insets: `pt-safe`, `pb-safe`
- `overscroll-behavior-y: none`
- Touch targets ≥ 44px
- No `:hover` on mobile — use `:active`
- `select-none` on UI elements, `select-text` on content

---

## 15. i18n Rules

- **Supported locales:** `en` (default), `es-ES`, `it-IT`
- **URL structure:** `/home` (en), `/es-es/home`, `/it-it/home`
- **Translation files:** `public/locales/{locale}/{namespace}.json`
- **Namespaces:** `common`, `home`, `lists`, `notes`, `calendar`, `reminders`, `expenses`, `profile`, `auth`, `onboarding`, `organize`, `legal`, `landing`
- **Dates:** Always use `useDateLocale` hook + `date-fns` locale-aware formatting
- **AI content:** Always prompt Gemini to respond in the user's selected language

---

## 16. Security Rules

- **Field-level encryption:** AES-256-GCM for notes with `is_sensitive = true`
- **Per-user keys:** `HMAC-SHA256(master_key, user_id)` → unique 256-bit key
- **RLS on every table:** Scoped to `user_id`, `couple_id`, or `group_id`. No exceptions.
- **Auth:** Clerk handles all auth. Clerk webhook syncs to `clerk_profiles`.
- **User roles:** Stored in separate `user_roles` table — never on the profile.
- **Admin checks:** Server-side only. Never from `localStorage` or client-side flags.
- **Privacy:** Partners cannot access each other's `olive_memory_files` (RLS enforced).
- **Group privacy:** `olive_memory_files` (personal) NEVER joined into group queries. Group notes scoped to `group_id` only.

---

## 17. Commit & Progress Protocol

**Commit format:**
```
[TASK-1A] Add ContextContract interface to orchestrator.ts
```

**After every commit, append to CHANGES.md:**
```
| 2026-04-21 | TASK-1A | _shared/orchestrator.ts | Description of change |
```

**Context window management:**
- At 70% context: pause, write state to `PROGRESS.md` (task ID, done, remaining, files modified)
- Never leave a migration half-applied at context handoff
- Never leave a TypeScript error unresolved at context handoff
- Start next session: *"Read PROGRESS.md and CHANGES.md, then continue Task [ID]."*

---

## 18. Required Environment Variables

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase access |
| `VITE_SUPABASE_URL` | Client-side Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Client-side Supabase anon key |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk auth frontend key |
| `CLERK_SECRET_KEY` | Clerk auth backend key |
| `GEMINI_API_KEY` | Google Gemini AI |
| `ENCRYPTION_MASTER_KEY` | AES-256 master key |
| `META_WHATSAPP_TOKEN` | Meta WhatsApp Cloud API (1:1) |
| `META_PHONE_NUMBER_ID` | WhatsApp business phone |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification (1:1) |
| `META_WHATSAPP_GROUP_WEBHOOK_TOKEN` | Webhook verification (groups) |
| `PERPLEXITY_API_KEY` | Web search integration |
| `DEEPGRAM_API_KEY` | Voice transcription |
| `GOOGLE_CLIENT_ID` | Calendar OAuth |
| `GOOGLE_CLIENT_SECRET` | Calendar OAuth |
| `ANTHROPIC_API_KEY` | Fallback LLM provider |

---

## 19. Deployment

| Layer | How |
|---|---|
| Frontend | Vercel — auto-deploys on push to `dev` (preview) and `main` (production) |
| Edge Functions | `supabase functions deploy <function-name>` |
| DB Migrations | `supabase db push` |
| iOS | Capacitor build → Xcode → App Store |
| Custom domain | Configure on Vercel (Project → Settings → Domains) |

---

## 20. Testing Protocol

For every task:
1. Run `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env` before starting
2. Write or update the co-located `.test.ts` file for any modified edge function
3. For DB migrations: `supabase db reset --local` then re-run test data
4. For orchestrator changes: run 10 test conversations across ≥ 3 intent types
5. For group features: simulate multi-sender group messages with 3+ participants
6. Verify no spike in `error_count` in `olive_llm_analytics`
7. Commit only after all acceptance criteria are verified

---

## 21. Current Engineering Priorities (April 2026)

The active programme is a 4-phase 10x improvement plan. Reference `OLIVE_Engineering_Plan.md` for full task specs, acceptance criteria, and file-level change maps.

**Phase 1 (Weeks 1–2) — Foundation:** Context contract, slot-level token logging, contradiction resolution, WhatsApp thread instrumentation, DB-only intent confidence floors.

**Phase 2 (Weeks 3–5) — Intelligence:** Compiled memory artifacts, wire artifacts to orchestrator (target: 68% token reduction), WhatsApp thread compaction, per-intent prompt modules, knowledge graph query routing.

**Phase 3 (Weeks 6–9) — Reliability:** Agent state + learning loop, cross-agent signal bus, Anthropic fallback provider.

**Phase 4 (Weeks 10–14) — Experience:** MyDay as intelligence showroom (3 panels, <800ms load), transparent Memory page, wiki lint pass in nightly maintenance.

**Parallel track — WhatsApp Groups:** *PARKED. Current focus is 1:1 quality.* Order when resumed: MVP passive capture + @Olive mention → /recap + GROUP_RECAP → GROUP_ASSIGN → Group heartbeat agent → Group spaces in web app.

**Weekly analytics query** (run every Monday — paste into Supabase SQL editor):
```sql
SELECT
  DATE_TRUNC('week', created_at) as week,
  ROUND(AVG(tokens_used)) as avg_tokens,
  COUNT(*) FILTER (WHERE tier = 'db_only') * 100.0 / COUNT(*) as db_only_pct,
  COUNT(*) FILTER (WHERE provider = 'anthropic') as fallback_count,
  ROUND(AVG(latency_ms)) as avg_latency_ms
FROM olive_llm_analytics
WHERE created_at > NOW() - INTERVAL '8 weeks'
GROUP BY 1 ORDER BY 1 DESC;
```

---

## Closing Directive

You are operating as a world-class senior engineer on the Olive codebase.
Your goal is not to complete tasks quickly — it is to complete them **correctly**.
**Read before you write. Measure before you optimize. Test before you commit.**

The product you are building relieves real cognitive burden from real people. Every feature that reduces the mental load of "being the one who remembers" is right. Every feature that adds to it is wrong.

When in doubt: re-read `OLIVE_SYSTEM_PROMPT.md`. It has the answer.

*"She remembers, so you don't have to."* — Your job is to make that promise true at scale.
