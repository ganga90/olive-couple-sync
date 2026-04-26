# Olive Brain System — Claude Code Onboarding

## What this is and why it exists

This repo has a `.claude/` folder — a living memory system for Olive. It exists because Olive is a solo-founder project and every session without context wastes 10–15 minutes of re-explanation, risks contradicting earlier decisions, and loses the thread of what's actually being built.

The brain system gives you full context from message one. It is the single source of truth for where Olive is, what matters, and what to do next. You are expected to read it, use it, and update it at the end of every session. That update is what makes it useful for the next session.

**The `.claude/` folder is part of the codebase. Treat changes to it with the same discipline as code changes — commit them, push them, don't leave them local.**

---

## What's in it

| File | What it contains |
|---|---|
| `skills/olive/SKILL.md` | Full product context, architecture, engineering rules, stack, non-negotiables — read this first, every session |
| `skills/olive-brand/SKILL.md` | Brand voice, copy rules, forbidden words — load for any user-facing work. Full bible at `OLIVE_BRAND_BIBLE.md` |
| `context/overview.md` | Current state: users, metrics, team, biggest challenge |
| `context/engineering.md` | Phase 1–4 task status, what's in progress, what's blocked, recent deployments |
| `context/product.md` | Feature status, user feedback, current priority order |
| `context/growth.md` | Acquisition channels, funnel, pricing |
| `context/brand.md` | Brand implementation status |
| `context/session-log.md` | Append-only log of every session — what was worked on, decisions made, where things were left |
| `CHANGELOG.md` | Append-only audit trail of every change to every brain file |
| `raw/` | Founder's unedited notes — read for context, **never modify** |

---

## Session Startup — do this before writing any code

```bash
# 1. Confirm you are in the right directory — this is the ONLY valid working copy
cd /Users/gventuri/Documents/olive-native/practical-lichterman
pwd  # must output the above path — if not, stop and navigate here first

# 2. Make sure you are on dev and up to date
git checkout dev
git pull origin dev

# 3. See what's been shipped recently
gh pr list --repo ganga90/olive-couple-sync --state merged --limit 20 --json number,title,mergedAt | cat
```

Then read:
1. `.claude/skills/olive/SKILL.md` — in full, every time
2. `.claude/context/overview.md` — current state
3. `.claude/context/engineering.md` — task status and blockers
4. `.claude/context/product.md` — priority order

Then:
5. Evaluate Phase 1 task completion against acceptance criteria in `OLIVE_Engineering_Plan.md`. Update the status table in `engineering.md` based on what you find in the actual codebase — mark tasks ✅ Done only when all acceptance criteria are verified.
6. Update `context/engineering.md` Recent Deployments table from the `gh pr list` output above.
7. State out loud: *"I've read the context. Current focus is [X]. I am beginning [task]."*

---

## Session End — do this before closing

**Step 1 — Update context files**

Update any context file that changed during this session. At minimum:
- `context/engineering.md` — task status, any new blockers
- `context/session-log.md` — append a new entry (format below)
- `context/product.md` — if any product decisions were made
- `CHANGELOG.md` — one line per file changed (format below)

**`session-log.md` entry format:**
```
## YYYY-MM-DD — Claude Code
**Worked on:** brief description
**Decisions made:** any product, engineering, or strategic decisions
**Changed files:** list of modified files
**Left off at:** what's next / what's blocked
```

**`CHANGELOG.md` entry format** (append to bottom, never edit existing lines):
```
[YYYY-MM-DD HH:MM] | Claude Code | [file] | [what changed]
```

**Step 2 — Commit and push**

```bash
cd /Users/gventuri/Documents/olive-native/practical-lichterman

# Stage all brain system updates
git add .claude/

# Stage any code changes from this session
git add [files you changed]

# Commit — use the task ID format for code, docs: prefix for brain updates
git commit -m "docs: update brain context for session YYYY-MM-DD"
# or combine with code commit:
git commit -m "[TASK-1A] Add ContextContract — update brain context"

# Push to dev (never push directly to main)
git push origin dev
```

**Step 3 — Verify**
```bash
git log --oneline -5  # confirm commit landed
git status            # confirm working tree is clean
```

---

## Branching rules

- All work happens on `dev`
- `dev` auto-deploys to Vercel preview on every push — use this for manual QA
- `main` is production — **never push directly to main, PRs only from dev**
- GitHub: `https://github.com/ganga90/olive-couple-sync`

---

## The one thing that matters right now

Beta users like Olive but aren't using her every day. The priority is **quality** — smarter note processing, chat with real memory and contextual knowledge, zero regressions. Not new features. Not WhatsApp Groups (parked — do not suggest group features). Quality and daily habit formation.

Priority order:
1. Note processing accuracy
2. Chat with contextual knowledge, memory, soul, embeddings
3. Zero regressions
4. Daily usage habit formation
5. WhatsApp Groups — standby, do not touch

---

## If you're ever unsure what to work on

Read `.claude/context/engineering.md`. The current active task is there. If it's unclear, ask Gianluca before starting work — don't guess.

---

## Keeping this file current

This file lives at `.claude/CLAUDE_CODE_ONBOARDING.md`. If anything in the project changes that would affect how a new session should start — new priorities, new constraints, new tools — update this file and commit it. It is the entry point for every future session on this codebase.
