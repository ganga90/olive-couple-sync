# Olive — Supabase Production Deployment Recap

**Date:** April 12, 2026  
**Project:** `wtfspzvcetxmcfftwonq`  
**Scope:** Full backend deployment across 8 sprints — database migrations + edge functions

---

## What Was Deployed

### Database Migrations (10 total, applied sequentially)

| # | Migration | Sprint | Key Tables / Features |
|---|-----------|--------|-----------------------|
| 1 | `olive_soul_system` | 0 | Soul layers (`olive_soul_layers`) — personality, communication style, boundaries |
| 2 | `olive_spaces_system` | 2 | `olive_spaces`, `olive_space_members`, `olive_space_invites` + backfill from `clerk_couples` + sync triggers |
| 3 | `add_space_id_columns` | 2 | Added `space_id` to `clerk_notes`, `lists`, `transactions`, `budgets`, `olive_memory_files`, `olive_patterns` + dual-write triggers |
| 4 | `collaboration_primitives` | 3 | `note_threads`, `note_reactions`, `note_mentions`, `space_activity` + activity triggers |
| 5 | `trust_reflection_system` | 4 | `olive_trust_actions`, `olive_trust_notifications`, `olive_engagement_events` + `compute_engagement_score` RPC |
| 6 | `agentic_delegation_system` | 5 | `olive_agent_executions`, `olive_delegations`, `olive_briefings` + delegation activity trigger |
| 7 | `consolidation_evolution_safety` | 6 | `olive_consolidation_runs`, `olive_memory_relevance`, `olive_soul_evolution_log`, `olive_soul_rollbacks` + memory decay/boost RPCs |
| 8 | `b2b_features` | 7 | `olive_industry_templates`, `olive_space_templates`, `olive_clients`, `olive_client_activity`, `olive_expense_splits`, `olive_expense_split_shares`, `olive_decisions` + 4 seeded industry templates |
| 9 | `recurring_workflow_templates` | 7 | `olive_workflow_templates`, `olive_workflow_instances`, `olive_workflow_runs` + 3 seeded workflows |
| 10 | `sprint8_polish_monetize` | 8 | `olive_pricing_plans`, `olive_subscriptions`, `olive_usage_meters`, `olive_cross_space_insights`, `olive_conflicts`, `olive_polls`, `olive_poll_votes` + `increment_usage`/`check_quota` RPCs + 4 seeded pricing plans |

### Edge Functions (7 total, all ACTIVE)

| Function | Actions | Purpose |
|----------|---------|---------|
| `olive-templates` | list, get, apply, get_applied, remove | Industry template management (real estate, agency, startup, freelancer) |
| `olive-client-pipeline` | create, update, get, list, add_activity, pipeline_stats, follow_ups, archive | CRM-style client pipeline with stage tracking and follow-up alerts |
| `olive-decisions` | create, update, get, list, search, stats | Decision log with context, options, outcomes, and search |
| `olive-billing` | get_plans, get_subscription, create_checkout, get_usage, check_quota, increment_usage, cancel, portal | Monetization: plans, subscriptions, usage metering, quota enforcement |
| `olive-polls` | create, vote, results, list, close, delete | Team polls with single/multi-choice, anonymous voting, results |
| `olive-conflicts` | detect, list, resolve, dismiss, cross_space | Schedule/budget/assignment conflict detection + cross-space intelligence |
| `olive-workflows` | list_templates, activate, deactivate, update_config, get_instances, run, tick, history | Recurring workflow engine (weekly review, monthly budget, client follow-up) with Gemini AI summarization |

---

## Architecture Highlights

### Spaces System (replacing couples)
- `olive_spaces` supports types: `couple`, `family`, `team`, `business`
- Full backward compatibility with `clerk_couples` via sync triggers (`trg_sync_couple_to_space`, `trg_sync_couple_member_to_space`)
- Dual-write triggers on core tables ensure `couple_id` and `space_id` stay in sync
- RPC functions: `create_space`, `create_space_invite`, `accept_space_invite`, `get_user_spaces`

### Trust & Engagement
- Event-driven engagement scoring via `olive_engagement_events`
- `compute_engagement_score` RPC aggregates 7-day activity into a 0-100 score
- Trust actions and notifications for permission escalation workflows

### Recurring Workflows
- Template-based: define steps as JSON arrays (query, compute, AI summarize, notify)
- Schedule engine supports daily/weekly/monthly/weekday patterns
- Gemini AI integration (flash-lite tier) for automated summaries and client follow-up drafts
- Tick system designed for heartbeat-based cron execution

### Monetization
- 4 pricing tiers: Free, Personal ($9.99), Team ($24.99), Business ($49.99)
- Usage metering with `increment_usage` / `check_quota` RPCs
- Quota enforcement per plan (notes, AI queries, spaces, members, storage, workflows)

### RLS (Row Level Security)
- All new tables have RLS enabled
- Policies enforce space membership checks via `olive_space_members`
- Service role bypass for edge functions using `SUPABASE_SERVICE_ROLE_KEY`

---

## Issues Encountered & Resolved

### 1. Immutable Function in Partial Index
**Migration:** `trust_reflection_system`  
**Error:** `functions in index predicate must be marked IMMUTABLE` — partial index used `now()` which is not immutable.  
**Fix:** Replaced the partial index `WHERE created_at > (now() - INTERVAL '7 days')` with a standard composite index on `(user_id, event_type, created_at)`.

### 2. Missing Column Reference
**Migration:** `sprint8_polish_monetize`  
**Error:** `column "title" does not exist` — trigram index referenced `clerk_notes.title` which doesn't exist.  
**Fix:** Removed the trigram index entirely.

### 3. Column Name Mismatch in Trigger
**Migration:** `agentic_delegation_system`  
**Error:** Trigger inserted `user_id` into `space_activity` but the column is `actor_id`.  
**Fix:** Updated trigger to use `actor_id`.

### 4. Foreign Key to Uncertain Table
**Migration:** `b2b_features`  
**Issue:** `olive_expense_splits.transaction_id` FK to `transactions(id)` — table structure not guaranteed.  
**Fix:** Removed the FK constraint, kept the column as a plain UUID reference.

---

## Seeded Data

### Industry Templates (4)
- **Real Estate Agency** — client pipeline, property tracking, commission splits
- **Creative Agency** — project pipeline, client management, team workflows
- **Tech Startup** — sprint planning, investor pipeline, burn rate tracking
- **Freelancer/Consultant** — client pipeline, invoicing, time tracking

### Workflow Templates (3)
- **Weekly Review** — queries tasks + delegations, AI-generates summary
- **Monthly Budget Review** — gathers transactions + budgets, computes comparison, detects anomalies
- **Client Follow-up** — checks overdue clients, AI-drafts follow-up messages

### Pricing Plans (4)
- **Free** — 50 notes, 20 AI queries, 1 space, 2 members
- **Personal** — 500 notes, 200 AI queries, 3 spaces, 5 members
- **Team** — 2000 notes, 1000 AI queries, 10 spaces, 20 members, workflows
- **Business** — 10000 notes, 5000 AI queries, 50 spaces, 100 members, priority support

---

## Idempotency Patterns Used

All migrations were written to be safely re-runnable:

```sql
-- Tables
CREATE TABLE IF NOT EXISTS ...

-- Indexes
CREATE INDEX IF NOT EXISTS ...

-- Policies (no IF NOT EXISTS in PostgreSQL)
DO $$ BEGIN
  CREATE POLICY "policy_name" ON table_name ...;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Columns
ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...
```

---

## Production Status

All systems are **live and operational** on Supabase project `wtfspzvcetxmcfftwonq`:

- 10/10 migrations applied
- 7/7 edge functions deployed and ACTIVE
- All RLS policies in place
- All seed data populated
- Backward compatibility with existing `clerk_couples` maintained
