# Product — Feature Status & Priority

> **Last updated:** 2026-04-26 — initial brain seed
> Update whenever a product decision is made or a feature ships.

---

## Current priority order (do not reorder without founder approval)

1. **Note processing accuracy** — the first dump must feel right
2. **Chat with contextual knowledge, memory, soul, embeddings** — the second interaction must prove she remembers
3. **Zero regressions** — trust compounds; one broken interaction breaks the streak
4. **Daily usage habit formation** — gentle nudges, daily digest, the 11pm question
5. **WhatsApp Groups** — parked, do not propose

---

## Feature status

### Capture
| Feature | Status | Notes |
|---|---|---|
| WhatsApp 1:1 text capture | ✅ shipped | core path, stable |
| WhatsApp 1:1 voice notes | ✅ shipped | Deepgram + Gemini multimodal |
| WhatsApp 1:1 image capture | ✅ shipped | image primary, caption augments (PR #4) |
| Multi-task splitting | ✅ shipped | "buy milk, call dentist" → 2 notes |
| Web app capture | ✅ shipped | witholive.app |
| iOS app capture | ✅ shipped | App Store, PR #3 |
| WhatsApp Groups capture | ⛔ parked | DB schema designed, not built |

### Recall
| Feature | Status | Notes |
|---|---|---|
| Search by keyword (`?groceries`) | ✅ shipped | hybrid 70% vector + 30% BM25 |
| CONTEXTUAL_ASK (chat with saved data) | 🟡 improving | three-case prompt landed PR #10, embeddings aligned PR #12 |
| Lists (recall by list name) | ✅ shipped | targeted fetch for heavy users PR #8 |
| Calendar recall | ✅ shipped | |
| Memory recall in chat | 🟡 improving | compiled artifacts wiring (Phase 2) |

### Act
| Feature | Status | Notes |
|---|---|---|
| Reminders (send-reminders + dedup) | ✅ shipped | reminder-dedup.ts enforced |
| Calendar event creation | ✅ shipped | Google OAuth |
| Expense tracking (`$25 lunch`) | ✅ shipped | expense-detector.ts |
| Partner relay (`remind partner to...`) | ✅ shipped | PARTNER_MESSAGE intent |
| Task actions (complete/delete/reschedule) | ✅ shipped | TASK_ACTION intent |

### Background intelligence (heartbeat)
| Agent | Status |
|---|---|
| Stale Task Strategist | ✅ shipped |
| Smart Bill Reminder | ✅ shipped |
| Energy Task Suggester (Oura) | ✅ shipped |
| Sleep Optimization Coach (Oura) | ✅ shipped |
| Birthday Gift Agent | ✅ shipped |
| Weekly Couple Sync | ✅ shipped |
| Email Triage Agent | _verify_ |
| Weekly Group Sync | ⛔ parked |

### MyDay & Memory transparency
| Feature | Status |
|---|---|
| MyDay 3-panel intelligence showroom (<800ms) | ⬜ Phase 4 |
| Transparent Memory page | ⬜ Phase 4 |
| Wiki lint pass | ⬜ Phase 4 |

---

## Recent product decisions

> Append new decisions with date. Keep one-line *why* per decision.

- **2026-04-26** — Park WhatsApp Groups indefinitely. *Why: 1:1 daily-habit hasn't crystallized; adding a surface dilutes focus.*
- **2026-04-26** — Embeddings standardized at vector(768), backfilled. *Why: alignment unlocks reliable semantic recall in CONTEXTUAL_ASK.*
- **2026-04-22** — In image+caption captures, image is primary, caption augments. *Why: caption alone misses what the photo actually shows.*

---

## User feedback themes

> Founder: replace these with what you're actually hearing. Themes drive priority shifts.

- _TBD — drop user quotes here as they come in_
- _TBD — pattern: which feature do users mention first when they say "I love this"_
- _TBD — pattern: where do users get stuck or ask the same question twice_

---

## Anti-features (do not build, even if asked)

- ❌ Chatbot UI in the web app — Olive is a presence, not a destination
- ❌ Manual tagging or folder creation — that is the cognitive tax we exist to remove
- ❌ Gamification (streaks, badges, points)
- ❌ Public sharing of notes/lists outside the Space
- ❌ "AI-powered" anywhere in copy
- ❌ Confetti, celebration toasts, exclamation-heavy responses

---

## Pricing (post-beta)

- **Free during beta** — current state
- **$4.99/month** — post-beta consumer
- **B2B (Real Estate Q3, Wedding Q4, Small Business Q4+)** — pricing TBD per vertical
