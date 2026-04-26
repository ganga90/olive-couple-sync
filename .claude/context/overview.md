# Overview — Current State

> **Last updated:** 2026-04-26 — initial brain seed
> **Owner:** Gianluca Venturini (solo founder)
> Update at end of every session if anything material changed.

---

## Snapshot

| | |
|---|---|
| **Product** | Olive — shared memory for the people you care about |
| **Stage** | Live beta at witholive.app |
| **Team** | Solo founder (Gianluca Venturini, Miami) |
| **Company** | GV Digital Labs |
| **Repo** | github.com/ganga90/olive-couple-sync |
| **Working branch** | `dev` (auto-deploys to Vercel preview) |

---

## Metrics — fill in current numbers when known

> Founder: replace these with current values from Supabase / analytics. Leaving blank is fine; placeholder is better than wrong.

- **Active beta users:** _TBD_
- **WhatsApp 1:1 senders (last 7d):** _TBD_
- **Notes created (last 7d):** _TBD_
- **Daily active rate:** _TBD_ (this is the metric that matters most right now)
- **Retention (week-over-week):** _TBD_
- **Avg LLM cost per active user / day:** _TBD_
- **Median latency p50 / p95 (whatsapp-webhook):** _TBD_

Source of truth: Supabase analytics + `olive_llm_analytics` table. See weekly query in `skills/olive/SKILL.md` §21.

---

## The biggest challenge right now

> **Beta users like Olive but aren't using her every day.**

The product works. The capture-offer-confirm-execute loop is real. The memory system compiles artifacts correctly. People say nice things. But they don't open WhatsApp and dump to Olive on a Tuesday morning — yet.

The wedge is **daily habit formation through quality**: smarter note processing (so the first dump feels effortless and the result is right), chat with real memory and contextual knowledge (so the second interaction proves she remembers), and zero regressions (so trust compounds instead of breaking).

This is why **WhatsApp Groups is parked**. Adding a surface before the core 1:1 habit is sticky would dilute focus.

---

## What's working

- Note capture pipeline: WhatsApp → process-note → clerk_notes is reliable
- Embeddings are now aligned to vector(768) and backfilled across all users (PR #12, merged 2026-04-26)
- CONTEXTUAL_ASK distinguishes title-match-no-body from no-data (PR #10)
- Targeted list fetch for heavy users with old list items (PR #8)
- iOS build is shipped to App Store (PR #3, April 21)
- Eval harness + CI gate is live (PR #3)

## What's painful

- _TBD — founder, drop notes here as they come up_

---

## Team & external collaborators

- **Engineering:** Gianluca (founder, all code)
- **Brand & Design:** Gianluca + occasional contractor
- **Beta users:** ~handful of friends/family + early invitees in Miami / EU
- **No employees**

---

## Current single-sentence focus

> Make the 1:1 experience so good that beta users open WhatsApp and dump to Olive *without thinking about it*.
