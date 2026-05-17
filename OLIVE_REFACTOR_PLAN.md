# Olive Refactor Plan — Backend → World-Class Structure

**Status:** Active programme — drafted 2026-05-17  
**Authority:** This document. Updates land via PR alongside the work they describe.  
**Companion docs:** [`OLIVE_Engineering_Plan.md`](OLIVE_Engineering_Plan.md) (feature roadmap), [`CLAUDE.md`](CLAUDE.md) (non-negotiable rules), [`CHANGES.md`](CHANGES.md) (commit log).

---

## Why this exists

Olive ships fast and that's the right tradeoff for early product-market fit. But the cost is concentrating in a few places we can name:

- `whatsapp-webhook/index.ts` is **10,400+ lines** in one file. Every intent handler, helper, and formatting concern lives inline.
- `process-note/index.ts` is **3,100 lines** with the same shape.
- Zero unit-testable units in the webhook — logic is interleaved with `supabase.from(...)` calls and `reply()` side-effects.
- The `clerk_notes.source` NOT NULL bug shipped to prod for 3 days without anyone noticing. No automated check that frontend insert sites populate columns the DB requires.
- AI behavior (business cards, SAVE_ARTIFACT robustness) lands as prompt-string edits inside the monolith — prompts aren't versioned, A/B-tested, or evaluated.
- Category drift (`contact` vs `contacts`) papered over at the application layer leaks into analytics and recommendations.

The pattern: **the monolith couples concerns that should be separable**, which makes every problem above harder to fix. Until that's untangled, every initiative pays a tax.

---

## Strategic shape

Three initiatives, sequenced so each one makes the next cheaper:

```
┌─────────────────────────────────────────────────────────────┐
│  Initiative 1 — Module Decomposition + Test Foundation       │
│  (unblocks everything else; ~3 weeks)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │
       ┌──────────────┴──────────────┐
       ▼                              ▼
┌────────────────────┐       ┌──────────────────────────┐
│  Initiative 2 —    │       │  Initiative 3 —          │
│  Category +        │       │  Multi-Space Architecture │
│  semantic data     │       │  (Personal / Work /       │
│  hygiene           │       │  Family / Business)       │
│  (~1 week)         │       │  (~4 weeks)               │
└────────────────────┘       └──────────────────────────┘
```

Initiative 1 is the foundation. The others assume it's done so they can ship features without re-creating the monolith problem. Cross-cutting observability + ops work runs in parallel.

---

## Initiative 1 — Module Decomposition + Test Foundation

**Goal:** Reduce `whatsapp-webhook/index.ts` from 10,400 lines to **under 1,000 lines of pure routing**, with every business decision living in a pure, unit-tested module in `_shared/` or a co-located `handlers/` directory.

### Target structure

```
supabase/functions/
├── whatsapp-webhook/
│   ├── index.ts                    # ≤ 1,000 lines. Request parsing, session
│   │                               #   load, intent dispatch, response send.
│   │                               #   No business logic.
│   ├── handlers/                   # One file per intent. Each handler is a
│   │   ├── save-artifact.ts        #   pure function: (ctx) → Promise<Reply>.
│   │   ├── save-artifact.test.ts   #   No reply() side-effects inside the
│   │   ├── confirmation.ts         #   handler — return a typed Reply object.
│   │   ├── chat.ts
│   │   ├── contextual-ask.ts
│   │   ├── web-search.ts
│   │   ├── create-note.ts
│   │   ├── task-action.ts
│   │   ├── expense.ts
│   │   ├── partner-message.ts
│   │   ├── create-list.ts
│   │   ├── list-recap.ts
│   │   └── search.ts
│   ├── media-routing.ts            # The pre-classifier (RECEIPT/CONTACT/...)
│   ├── media-routing.test.ts
│   └── reply-builder.ts            # Typed Reply construction
│
└── _shared/
    ├── intent-classifier.ts        # already exists; tighten
    ├── orchestrator.ts             # already exists
    ├── ai/
    │   ├── classify-artifact.ts    # Pure: (content, request) → {title, category, tags}
    │   └── ...
    └── prompts/                    # already exists; expand
        ├── intents/                # one file per prompt-version pair
        └── eval/
            └── fixtures.json       # Golden test cases per prompt
```

### Task ledger

| # | Task | Files | Acceptance |
|---|------|-------|------------|
| 1.1 | Define `Reply` and `HandlerContext` types so handlers can return data instead of calling `reply()` directly | `_shared/types.ts` | New types compile; existing handlers still call `reply()` (no behavior change). Types tests prove the contract. |
| 1.2 | Extract `SAVE_ARTIFACT` handler + `classify-artifact.ts` pure helper | `handlers/save-artifact.ts`, `_shared/ai/classify-artifact.ts`, co-located `.test.ts` | 8+ unit tests cover: AI success, AI throw, JSON parse fail, isBadTitle fallback, retry-on-insert-failure, list-mention resolution, embedding non-blocking, idempotent session clear. Webhook diff is ≤ 20 lines. |
| 1.3 | Extract `CONFIRMATION` (awaiting_confirmation dispatch) | `handlers/confirmation.ts` | Tests cover each `PendingOffer` variant + deny path + offer expiry. |
| 1.4 | Extract `CHAT` | `handlers/chat.ts` | Tests cover briefing / daily_focus / weekly_summary / motivation / general / assistant chat types; mock Gemini. |
| 1.5 | Extract `CONTEXTUAL_ASK` + `WEB_SEARCH` | `handlers/contextual-ask.ts`, `handlers/web-search.ts` | Tests cover pending_offer construction when response contains "save this", artifact freezing behavior. |
| 1.6 | Extract `CREATE` (brain-dump path) | `handlers/create-note.ts` | Tests cover multi-note splitting, single-note path, encryption fields, list inheritance, sub-items mode, topical-follow-up attach. |
| 1.7 | Extract `TASK_ACTION` + `EXPENSE` + `PARTNER_MESSAGE` | One file each + tests | Each handler ≤ 300 lines; tests cover happy path + 2 edge cases. |
| 1.8 | Extract `CREATE_LIST` + `LIST_RECAP` + `SEARCH` + `MERGE` | One file each + tests | Same as 1.7. |
| 1.9 | Extract `media-routing.ts` (the pre-classifier) | `handlers/media-routing.ts` | Tests cover RECEIPT / CONTACT / TASK / TEXT / OTHER label parsing, pre-analysis failure non-blocking. |
| 1.10 | Apply the same decomposition to `process-note/index.ts` | `process-note/handlers/` mirror structure | Webhook reduction + process-note reduction = single foundation. |
| 1.11 | Stand up an integration test harness that runs against Supabase Local + a mocked Gemini | `tests/integration/` | 10 fixture conversations replayed end-to-end, snapshot assertions on resulting `clerk_notes` rows. |
| 1.12 | CI gate: PR cannot merge if `whatsapp-webhook/index.ts` exceeds 1,200 lines | `.github/workflows/size-budget.yml` | Soft fail at 1,000, hard fail at 1,200. Prevents regression. |

### Why this works

- Each task is independently shippable. Each PR removes 200–800 lines from the monolith without changing behavior.
- The `source` NOT NULL bug we just fixed is exactly the kind of thing a co-located unit test would have caught immediately — the test would have asserted that `addNote` sets `source` on every insert.
- After this, adding a feature is **modifying one file** instead of finding the right place in 10,400 lines.

### Deliverable per task

PR with ≤ 300 lines of net new code (the rest is moves), co-located test file, no webhook behavior change, eval-harness pass.

---

## Initiative 2 — Category & Semantic Data Hygiene

**Goal:** The DB stores canonical values. Application code doesn't paper over inconsistency.

| # | Task | Acceptance |
|---|------|-----------|
| 2.1 | Extend `normalize_category()` Postgres function: `contact → contacts`, `business_card → contacts`, `networking → contacts`, `meeting → work`, `appointment → personal` unless already health | Existing rows untouched (BEFORE INSERT/UPDATE only); new rows normalize. Migration body ≤ 30 lines. |
| 2.2 | One-shot backfill: `UPDATE clerk_notes SET category = normalize_category(category)` (idempotent because the function is) | Distinct-category count drops; pre/post counts logged in PROGRESS.md. |
| 2.3 | CI check that fails if any new `category` literal in source code isn't a member of the canonical set | Drift caught at PR time, not in production. |
| 2.4 | Move `canonicalListNames` out of `process-note/index.ts` into `_shared/category-registry.ts` so frontend and backend share one source of truth | Frontend list creation uses canonical names; `categorySynonyms` and `contentKeywords` maps move with it. |
| 2.5 | Add `olive_category_audit` materialized view: one row per `(category, list_name)` pair with usage count + last-seen date. Refreshed nightly | Catches new categories the AI invented that we should bless or rename. |

**Why this matters:** Right now you have invisible drift — two different lists in the same category, two different categories for the same intent. With this hygiene, the AI's "creative" categories surface as a daily list you can decide on instead of compounding silently.

---

## Initiative 3 — Multi-Space Architecture

**Goal:** A user has *multiple* spaces, picks one at capture time (or Olive infers it), and shared memory respects the boundary. This is the **biggest product unlock** — same backend, different surfaces, no more "where does this go?" friction.

**Why now:** The Spaces primitive already exists (`olive_spaces`, `olive_space_members`, `space_type` enum). It's wired through but underused — every couple-type space mirrors a couple, and that's it. Initiative 1's decomposition makes this safe to land.

### Architecture

```
User
 │
 ├── Personal space (always exists, type='personal')
 │     └── Notes, lists, expenses scoped to user only
 │
 ├── Couple space ── Almu & G (type='couple')        ← existing
 │
 ├── Work space ── "Olive Eng" (type='work')          ← new
 │     ├── Members: founders + key contractors
 │     └── Different soul/voice settings
 │
 ├── Family space ── "Venturi family" (type='family') ← new
 │     ├── Up to 9 members
 │     └── Different default routing rules
 │
 └── Real Estate client space ── "Smith family" (type='real_estate_client') ← already typed
       └── B2B vertical wedge
```

### Task ledger

| # | Task | Files | Acceptance |
|---|------|-------|------------|
| 3.1 | Add `personal` to `space_type` enum; auto-create a personal space per user on Clerk sync | Migration + `clerk-sync/index.ts` | New users get a Personal space + membership. Backfill for existing users is idempotent. Every note now has a `space_id` (no more NULL-scope rows). |
| 3.2 | Frontend: replace "Almu & G" dropdown with `<SpacePicker>` that lists every space the user belongs to + a "Switch space" affordance | `src/components/SpacePicker.tsx`, extend `src/providers/SpaceProvider.tsx` | Picker shows icon + name + member count for each space. Switching it re-scopes `useSupabaseNotes`. |
| 3.3 | Capture-time space selection: brain-dump input shows the active space as a chip; tapping reveals other spaces | `src/components/NoteInput.tsx`, `SimpleNoteInput.tsx` | Default = last-used space per user (stored in `clerk_profiles.last_space_id`). User can override per capture. |
| 3.4 | AI infers space from content when there's a clear signal | New `_shared/space-router.ts` pure module + tests | Inference is opt-in (user can dismiss). 70% precision on a labeled fixture set before shipping. |
| 3.5 | Per-space soul: extend `olive_souls` with a `space_id` foreign key. Soul layers compose: identity → user → space → conversation | Migration + `_shared/soul.ts` | A user's "G" persona in the couple space differs from their professional persona in the work space. Privacy moat #4 (memory scoped to member, space). |
| 3.6 | Per-space heartbeat agents: extend `olive_user_preferences` to be `olive_member_preferences` keyed on `(user_id, space_id)` | Migration + `olive-heartbeat/index.ts` | Bill reminders fire in personal space; weekly couple sync fires in couple space; weekly team sync fires in work space. |
| 3.7 | WhatsApp routing: bind a WA group_id to a space at invite time so passive captures from that group land in the right space | `_shared/space-scope.ts`, `whatsapp-group-webhook` | Bound group → captures auto-routed. Unbound group → user prompted on first activity. Aligns with the in-progress Groups MVP in `OLIVE_System_Prompt.md` §10. |
| 3.8 | Pricing surface: keep free tier at 1 personal + 1 couple; gate additional spaces behind the $0.99/month paid tier | `src/lib/billing.ts`, marketing page | Aligned with the launch monetization plan. |

### Why this is the engineering unlock

- The Real Estate vertical (B2B Q3 launch per the engineering plan) is **just another space type** if this lands cleanly. Same backend, same primitives, different UX surface.
- The "business vs personal" friction users feel today dissolves because they pick at capture time, or Olive infers, instead of forcing it through category.
- The Groups MVP (in development) plugs into the same `space_id` substrate — no architectural special-casing.

---

## Cross-cutting — Observability + ops (parallel to all three)

These are small but high-leverage. Run alongside the initiatives.

| # | Task | Acceptance |
|---|------|-----------|
| O.1 | Slack alert on `clerk_notes` insert errors > 0 in a 5-min window | The next time `source` NOT NULL ships without the frontend, we see it in Slack before the user does. |
| O.2 | Weekly LLM cost + latency report (Pro/Standard/Lite split + provider failover rate) emailed to founders | Model-router decisions become legible. We see whether `Flash-Lite` is doing enough work. |
| O.3 | Prompt eval harness: each prompt in `_shared/prompts/` has a `.fixtures.json` of golden cases that run on every PR | A regression in tone shows up in CI, not in user replies. |
| O.4 | Replace ad-hoc `console.log` calls with a structured logger that includes `user_id`, `intent`, `prompt_version`, `latency_ms` | Production debugging stops being grep through Supabase logs. |

---

## Suggested rollout cadence

| Week | Focus |
|---|---|
| 1–2 | Initiative 1.1 → 1.5 — extract the four most-touched intent handlers (SAVE_ARTIFACT, CONFIRMATION, CHAT, CONTEXTUAL_ASK + WEB_SEARCH). Each one PR. Webhook drops from 10,400 → ~7,500 lines. |
| 3–4 | Initiative 1.6 → 1.9 — the rest of the handlers + media routing + process-note decomposition. Webhook ≤ 1,000 lines. CI line-budget gate live. |
| 5 | Initiative 2 in parallel with O.1 / O.4. Category hygiene shipped. |
| 6–9 | Initiative 3 — Personal space backfill (week 6), SpacePicker UI (week 7), space-aware AI inference (week 8), per-space soul + heartbeat (week 9). |
| 10 | Initiative 3.7 — group-to-space binding lands as the foundation for the Groups MVP feature work. |

---

## Success metrics

Three measurable end-states:

1. **Code health:** `whatsapp-webhook/index.ts` ≤ 1,000 lines. `process-note/index.ts` ≤ 800 lines. Every handler under 400 lines. Test count goes from ~1,300 to **2,500+**.
2. **User experience:** Zero "save failure" reports in a 30-day window. Business cards always land in Contacts. Users in multiple spaces never have to ask "where will this go?"
3. **Engineering leverage:** New features (Groups MVP, real-estate vertical) ship in days, not weeks, because primitives compose. A new vertical = a new `space_type` + a few prompts, not a new monolith.

---

## Status tracker

Updated as each task lands. Format: `[date] task-id — title — PR#`.

- *(empty — first PR lands Initiative 1.1)*

---

## Open questions

- **Eval harness scope:** the `prompt-evolution` directory already exists. Initiative 1's prompt fixtures should plug into that rather than standing up a parallel system.
- **Branch protection on `main`:** should we add a required reviewer once the initiatives kick off? Today PRs can self-merge.
- **Telemetry budget:** the new structured logger (O.4) will increase Supabase log volume. Worth modeling cost before shipping.
