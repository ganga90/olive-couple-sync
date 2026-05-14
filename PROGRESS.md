# PROGRESS.md — Bucket 3: Source Attribution + Error-Rate Monitoring

**Branch:** `fix/source-attribution-and-monitoring`
**Started:** 2026-05-14 (Bucket 1 [#127](https://github.com/ganga90/olive-couple-sync/pull/127) merged to main earlier the same day; Bucket 2 [#129](https://github.com/ganga90/olive-couple-sync/pull/129) merged at 04:30 UTC). Bucket 3 builds on both: it relies on Bucket 2's `provider` column for the monitoring routine query.

For Bucket 2's progress record see git history before this commit (PR #128 + #129 merged).

---

## Step 0 reading + grep results

Files read (in full):
- `CLAUDE.md` (repo brain — `OLIVE_SYSTEM_PROMPT.md` does not exist; CLAUDE.md fills that role).
- `CHANGES.md`, `PROGRESS.md` (prior content).
- Olive skill sections 6, 9, 16, 17 (loaded via Skill tool earlier this session).
- `supabase/functions/whatsapp-webhook/index.ts` (10,440 lines; read in chunks to map each insert-site context).
- `supabase/functions/olive-email-mcp/index.ts` (reference implementation; already sets `source='email'`).
- `supabase/functions/process-note/index.ts` (analyzer; zero direct inserts — confirms Step 1).
- `supabase/functions/save-link/index.ts`, `process-receipt/index.ts`, `process-brain-dump/index.ts`, `ask-olive/index.ts`, `ask-olive-stream/index.ts`, `ask-olive-individual/index.ts` — checked each for direct `clerk_notes` inserts.
- Latest migration touching `source` / `source_ref`: `20260427000000_baseline_post_lovable_reconciliation.sql` declares `source text NULL, source_ref text NULL` (columns already exist; no column migration needed).

### Step 0 grep — single-line version (as written in the prompt)

```
$ grep -rEn '\.from\(["'\'']clerk_notes["'\'']\)[^.]*\.insert' supabase/functions/ \
    | grep -v test | sort
supabase/functions/ask-olive-individual/index.ts:1204:            const { data: inserted } = await supabase.from('clerk_notes').insert(noteData).select('id, summary').single();
supabase/functions/olive-email-mcp/index.ts:403:    const { error: insertErr } = await supabase.from("clerk_notes").insert(noteData);
supabase/functions/olive-email-mcp/index.ts:555:    const { error: insertErr } = await supabase.from("clerk_notes").insert(noteData);
```

The single-line grep finds **3** sites — but only because most insert sites span two lines (`.from(...)` and `.insert(...)`). I switched to a multi-line awk scan for an authoritative inventory.

### Multi-line scan — 13 backend insert sites total

| # | File | Line | Context |
|---|---|---|---|
| 1 | whatsapp-webhook | 1165 | Cluster CREATE (inside `createNoteFromCluster()`) |
| 2 | whatsapp-webhook | 2888 | Media note (image/voice attached) |
| 3 | whatsapp-webhook | **4876** | **Attach-offer primary** (Step 1 missed this site) |
| 4 | whatsapp-webhook | 4906 | Attach-offer fallback |
| 5 | whatsapp-webhook | 6219 | TASK_ACTION (create from offer) |
| 6 | whatsapp-webhook | 9165 | PARTNER_MESSAGE relay |
| 7 | whatsapp-webhook | 9520 | SAVE_ARTIFACT |
| 8 | whatsapp-webhook | 9671 | CREATE_LIST initial items (bulk) |
| 9 | whatsapp-webhook | 10154 | Multi-note bulk |
| 10 | whatsapp-webhook | 10230 | Main single CREATE |
| 11 | olive-email-mcp | 403 | Email triage path (2-arg signature) |
| 12 | olive-email-mcp | 555 | Email triage path (3-arg signature) |
| 13 | ask-olive-individual | 1204 | PARTNER_MESSAGE relay (mirror of whatsapp-webhook site #6) |

### Frontend insert sites (out of scope per Step 10)

| File | Line | Notes |
|---|---|---|
| `src/components/AskOliveChatGlobal.tsx` | 686–687 | `.from('clerk_notes').insert({...})` — should be `source: 'web'` once migrated. |
| `src/hooks/useSupabaseNotes.ts` | 281–282 | `.from('clerk_notes').insert([insertData])` — should be `source: 'web'` or `'ios'` based on Capacitor flag. |

Documented here for the follow-up frontend migration PR.

---

## Step 1 contradictions surfaced + user direction

Three contradictions with Step 1 surfaced via AskUserQuestion before continuing:

1. **whatsapp-webhook has 10 sites, not 9** — Step 1 missed line 4876. User confirmed: treat as "#1.5 Attach-offer primary" — `source: inboundNoteSource`, `source_ref: wamid` (same as site 4906).
2. **olive-email-mcp has 2 sites, not 1** — Step 4.3 implies one; both lines 403 and 555 exist. User confirmed: migrate both, keep existing `source: 'email'` + `source_ref: email.id`.
3. **Frontend has 2 direct insert sites** — out of scope per Step 10 confirmed. Documented above.

---

## Files changed

| File | Change |
|---|---|
| `supabase/functions/_shared/note-insert.ts` | **New** — `insertNote()`, `insertNotesBatch()`, `NOTE_SOURCES` enum, `whatsappSourceFromMessageType()` helper. |
| `supabase/functions/_shared/note-insert.test.ts` | **New** — 9 unit tests covering happy path, missing-source rejection, batch validation, enum closure, and source derivation. |
| `supabase/functions/whatsapp-webhook/index.ts` | Add `messageType` to `MetaMessageData` + return; thread `wamid` + `inboundNoteSource` to `createNoteFromCluster()`; migrate all 10 insert sites to `insertNote()`/`insertNotesBatch()`. Site 6 (PARTNER_MESSAGE) corrected from `source='whatsapp'` to `source='partner-relay'`. Site 7 (SAVE_ARTIFACT) corrected from `source='olive-chat'` to `source=inboundNoteSource`. |
| `supabase/functions/olive-email-mcp/index.ts` | Migrate both insert sites to `insertNote()`. Values unchanged. |
| `supabase/functions/ask-olive-individual/index.ts` | Migrate the partner_message relay insert to `insertNote()` with `source='partner-relay'`. |
| `scripts/backfill-source-attribution.sql` | **New** — heuristic backfill script (3 update blocks + before/after snapshot queries). |

No migration added in this PR (NOT NULL deferred — see Step 6.4 decision below).

---

## Tests

- `deno test supabase/functions/_shared/` → **1257 passed / 0 failed** (1248 baseline + 9 new from `note-insert.test.ts`).
- `deno check supabase/functions/whatsapp-webhook/index.ts` → 18 errors, **same as the baseline before this PR** (verified by stashing the changes). My migrations introduced **zero new type errors** after coercing `summary: string | null` from the helper with `?? ''` at affected call sites.
- `deno check supabase/functions/olive-email-mcp/index.ts` → 0 errors.
- `deno check supabase/functions/ask-olive-individual/index.ts` → 2 errors, same as baseline.
- `deno check supabase/functions/_shared/note-insert.ts` → 0 errors.

The 18 pre-existing whatsapp-webhook errors are out of scope here (block-scoped variable use-before-decl + missing `today` identifiers + Supabase generic-type drift); they are tracked separately from this PR.

---

## Step 6.3 — backfill before/after

### BEFORE
| source | rows |
|---|---|
| (null) | 698 |
| email | 13 |
| olive-chat | 4 |
| whatsapp | 2 |
| **Total** | **717** |

### Block-by-block

| Block | Rule | Rows updated |
|---|---|---|
| 1 | `source='whatsapp' AND source_ref LIKE 'partner_relay:%'` → `partner-relay` | 2 |
| 2 | NULL + same user had whatsapp-* LLM call within ±60s → `whatsapp` | 7 |
| 3 | NULL + same user had any whatsapp-* LLM call same day → `whatsapp` | 37 |

### AFTER
| source | rows |
|---|---|
| (null) | 654 |
| whatsapp | 44 |
| email | 13 |
| olive-chat | 4 |
| partner-relay | 2 |
| **Total** | **717** |

### Attribution percentage

- BEFORE: 19 / 717 = **2.6% attributed**
- AFTER: 63 / 717 = **8.8% attributed**
- Δ = +44 rows newly attributed; **91.2% still NULL**

The spec's acceptance target was ≥50% attributed. We hit 8.8%. The dominant cause: most of the 654 still-NULL rows are likely web/iOS direct creates from users who have **never** used WhatsApp, so they have zero whatsapp-* LLM calls to correlate against. Stronger attribution would require either (a) inspecting note `original_text` patterns (heuristic, low precision) or (b) migrating the two frontend insert sites identified above so future inserts self-attribute as `web` / `ios`. Both are out of scope for this PR.

---

## Step 6.4 — NOT NULL migration decision: **deferred**

The spec rule: "If the remaining NULL count after backfill is ≤5% of total rows, apply the migration in 4.5. Otherwise, skip the migration in this PR."

- Remaining NULL: **91.2%** (654/717). Far above 5%.
- **Decision: do NOT apply `clerk_notes.source NOT NULL` in this PR.**

The `insertNote()` helper still enforces `source` for all new inserts (compile-time TypeScript + runtime guard), which is the more important regression guard. The column NOT NULL is the belt-and-suspenders layer that goes in a follow-up PR once the frontend sites are migrated and the historical rows are further attributed.

Follow-up PR scope (left as the future debt log):
1. Migrate the 2 frontend insert sites to set `source: 'web'` / `'ios'` at creation time.
2. Re-run the backfill (potentially with content-pattern heuristics) until residual NULL ≤5%.
3. Then apply the `NOT NULL` + `CHECK` constraint migration.

---

## Step 7 — error-rate monitoring routine dry-run

**Bucket 2 IS merged**, so I used the `COALESCE(provider, 'gemini') AS provider` version of the query (with `GROUP BY function_name, provider, model, day::date`).

Dry-run over last 14 days (`INTERVAL '14 days'` instead of 24h):

```sql
SELECT function_name, COALESCE(provider, 'gemini') AS provider, model,
       day::date AS day, SUM(call_count) AS calls, SUM(error_count) AS errors,
       ROUND(SUM(error_count) * 100.0 / NULLIF(SUM(call_count),0), 1) AS error_pct
FROM olive_llm_analytics
WHERE day > NOW() - INTERVAL '14 days'
GROUP BY function_name, provider, model, day::date
HAVING SUM(call_count) >= 5
   AND SUM(error_count) * 1.0 / NULLIF(SUM(call_count),0) > 0.10
ORDER BY error_pct DESC;
```

Result: **12 rows**, every day from 2026-05-03 through 2026-05-14 where `olive-compile-memory` exceeded 10% error rate. Multiple days hit 100%. Confirms the alert **would have caught the compile-memory regression on day 1** instead of the 11-day silent window we got.

| day | calls | errors | error_pct |
|---|---|---|---|
| 2026-05-13 | 8 | 8 | 100.0% |
| 2026-05-06 | 6 | 6 | 100.0% |
| 2026-05-14 | 7 | 6 | 85.7% |
| 2026-05-11 | 9 | 6 | 66.7% |
| 2026-05-09 | 9 | 6 | 66.7% |
| 2026-05-08 | 9 | 6 | 66.7% |
| 2026-05-12 | 8 | 4 | 50.0% |
| 2026-05-10 | 8 | 4 | 50.0% |
| 2026-05-05 | 8 | 4 | 50.0% |
| 2026-05-04 | 8 | 4 | 50.0% |
| 2026-05-07 | 12 | 2 | 16.7% |
| 2026-05-03 | 24 | 4 | 16.7% |

The routine itself is configured outside the repo (Claude Code Routines). Use the production query at the bottom of the prompt:

```sql
SELECT function_name, COALESCE(provider, 'gemini') AS provider, model,
       day::date AS day, SUM(call_count) AS calls, SUM(error_count) AS errors,
       ROUND(SUM(error_count) * 100.0 / NULLIF(SUM(call_count),0), 1) AS error_pct
FROM olive_llm_analytics
WHERE day > NOW() - INTERVAL '24 hours'
GROUP BY function_name, provider, model, day::date
HAVING SUM(call_count) >= 5
   AND SUM(error_count) * 1.0 / NULLIF(SUM(call_count),0) > 0.10
ORDER BY error_pct DESC;
```

Schedule: daily at 09:00 ET. Silent on empty result; email on any rows.

---

## Step 6 verification — live-traffic gap

After deploying `whatsapp-webhook`, `olive-email-mcp`, and `ask-olive-individual`, I checked `clerk_notes` for new captures in the 15-minute window post-deploy: **zero new notes**. Last note overall was 2026-05-14 03:12 UTC (~1.5h before deploy); last whatsapp-webhook LLM call was 2026-05-13 22:28 UTC (~6h before deploy). Live-traffic verification will happen organically when the next user sends a WhatsApp message; the code path is covered by unit tests (9/9 pass) and typecheck.

---

## Deviations from the prompt

1. **Step 0's single-line grep is insufficient** — it only finds 3 sites; the multi-line awk scan I used finds 13. Documented both.
2. **Step 1 fact correction surfaced** — line 4876 added to the migration list; both `olive-email-mcp` sites migrated. User confirmed direction via AskUserQuestion.
3. **NOT NULL migration deferred** — 91.2% still-NULL after backfill > 5% threshold. Step 6.4 explicitly permits this and asks for documentation; done.
4. **Step 6 live-traffic verification incomplete** — no organic WhatsApp message arrived in the 15-minute post-deploy window. Deploy is clean, code paths are tested. Will surface in the first natural capture.
5. **Step 7 routine configuration** — the routine itself lives outside the repo (Claude Code Routines). I documented the production query + the dry-run result here; the user can paste them into the Routines UI.
6. **Step 8 SKILL.md updates** — delivered as instructions to the user (skill file is in the plugin directory, not in repo VCS).

---

## Out of scope for this PR (per Step 10)

- Migration of the 2 frontend insert sites (`AskOliveChatGlobal.tsx`, `useSupabaseNotes.ts`). Will need a frontend `NoteSource` enum + per-call-site updates.
- Source-aware analytics queries.
- `olive_engagement_events` / `olive_engagement_metrics` schema changes.
- Additional alerts (latency p95, fallback-rate, daily cost).
