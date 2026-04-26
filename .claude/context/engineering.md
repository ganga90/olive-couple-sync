# Engineering — Task Status & Recent Deployments

> **Last updated:** 2026-04-26 — initial brain seed
> Update at end of every session: task status, blockers, recent deployments.

---

## Active focus

**Quality of the 1:1 WhatsApp experience.** Daily habit formation through smarter note processing and chat with real memory.

WhatsApp Groups is **parked** — do not propose group features.

Priority order:
1. Note processing accuracy
2. Chat with contextual knowledge, memory, soul, embeddings
3. Zero regressions
4. Daily usage habit formation
5. WhatsApp Groups — standby

---

## Phase 1–4 task status

> Source: `OLIVE_Engineering_Plan.md` (repo root). Mark ✅ Done only after all acceptance criteria are verified in the actual codebase.

### Phase 1 — Foundation (Weeks 1–2)
| Task | Status | Notes |
|---|---|---|
| TASK-1A — ContextContract interface in orchestrator.ts | _verify_ | Check `supabase/functions/_shared/orchestrator.ts` |
| TASK-1B — Slot-level token logging in olive_llm_analytics | _verify_ | Check `llm-tracker.ts` |
| TASK-1C — Contradiction resolution (AUTO_RECENCY default) | _verify_ | Check `olive_memory_contradictions` writes |
| TASK-1D — WhatsApp thread instrumentation | _verify_ | Check `olive_gateway_sessions` |
| TASK-1E — DB-only intent confidence floors | _verify_ | Check `intent-classifier.ts` thresholds |

### Phase 2 — Intelligence (Weeks 3–5)
| Task | Status | Notes |
|---|---|---|
| TASK-2A — Compiled memory artifacts (profile, patterns, relationships) | _verify_ | Check `olive_memory_files` writes |
| TASK-2B — Wire artifacts into orchestrator (target: 68% token reduction) | _verify_ | Compare avg tokens_used before/after |
| TASK-2C — WhatsApp thread compaction | _verify_ | Check `compact_summary` field on `olive_gateway_sessions` |
| TASK-2D — Per-intent prompt modules in `_shared/prompts/` | _verify_ | Inspect prompt registry layout |
| TASK-2E — Knowledge graph query routing | _verify_ | Check `olive_knowledge_entities` query path |

### Phase 3 — Reliability (Weeks 6–9)
| Task | Status | Notes |
|---|---|---|
| TASK-3A — Agent state + learning loop | _not started_ | |
| TASK-3B — Cross-agent signal bus | _not started_ | |
| TASK-3C — Anthropic fallback provider | _verify_ | Check `resilient-genai.ts` for Sonnet/Haiku branch |

### Phase 4 — Experience (Weeks 10–14)
| Task | Status | Notes |
|---|---|---|
| TASK-4A — MyDay 3-panel intelligence showroom (<800ms load) | _not started_ | |
| TASK-4B — Transparent Memory page | _not started_ | |
| TASK-4C — Wiki lint pass in nightly maintenance | _not started_ | |

> **Action item for next Claude session:** read the actual codebase, mark each task above ✅ / 🟡 in-progress / ⛔ blocked / ⬜ not started based on what you find. Do not guess.

---

## Recent deployments — last 10 merged PRs

> Refresh from `gh pr list --repo ganga90/olive-couple-sync --state merged --limit 20` at session start.

| PR | Title | Merged |
|---|---|---|
| [#13](https://github.com/ganga90/olive-couple-sync/pull/13) | Promote dev → main: embeddings alignment + 642-note backfill | 2026-04-26 |
| [#12](https://github.com/ganga90/olive-couple-sync/pull/12) | fix(embeddings): align clerk_notes.embedding to vector(768) + backfill all users | 2026-04-26 |
| [#11](https://github.com/ganga90/olive-couple-sync/pull/11) | Promote dev → main: three-case CONTEXTUAL_ASK prompt | 2026-04-26 |
| [#10](https://github.com/ganga90/olive-couple-sync/pull/10) | fix(whatsapp): distinguish title-match-no-body from no-data in CONTEXTUAL_ASK | 2026-04-26 |
| [#9](https://github.com/ganga90/olive-couple-sync/pull/9) | Promote dev → main: targeted list fetch | 2026-04-26 |
| [#8](https://github.com/ganga90/olive-couple-sync/pull/8) | fix(whatsapp): targeted list fetch — heavy users with old list items | 2026-04-26 |
| [#7](https://github.com/ganga90/olive-couple-sync/pull/7) | Promote dev → main: WhatsApp chat-quality fixes | 2026-04-26 |
| [#5](https://github.com/ganga90/olive-couple-sync/pull/5) | fix(whatsapp): improve chat quality for content questions about saved data | 2026-04-26 |
| [#4](https://github.com/ganga90/olive-couple-sync/pull/4) | fix(process-note): image primary, caption augments | 2026-04-22 |
| [#3](https://github.com/ganga90/olive-couple-sync/pull/3) | Promote iOS + UX + Option B (eval harness + CI gate) to production | 2026-04-21 |

**Pattern signal:** the last week has been almost exclusively WhatsApp 1:1 quality fixes — embeddings alignment, CONTEXTUAL_ASK accuracy, list fetch correctness. This is exactly the priority order in §1.

---

## Known blockers / open work

- _TBD — note any blocker as it appears, with date and what unblocks it_

---

## In-progress changes (uncommitted on dev as of 2026-04-26)

- `deno.lock` — modified
- New untracked work (MCP server scaffolding):
  - `mcp-server/`
  - `src/components/auth/`
  - `src/hooks/useMCP.ts`
  - `src/lib/mcp/`
  - `src/lib/tokenCache.ts`
  - `src/pages/OAuthCallback.tsx`
  - `src/pages/SSOCallback.tsx`

> If the next session is going to touch these, ask the founder what the intent is before assuming.

---

## Engineering rules (quick reference — full list in olive skill §6)

- No regressions — run tests before AND after
- No hardcoded UI strings — `t('namespace.key')` always
- No UTC-naive date logic — use `timezone-calendar.ts`
- No client-side admin checks — server-side only
- No inline prompts — `_shared/prompts/` with version
- No new LLM calls without tracking — `resilient-genai.ts` + `llm-tracker.ts`
- No new tables without RLS
- No new columns without migration
- Group privacy is sacred — personal memory never leaks into group context
