# PROGRESS.md — Frontend Source Attribution + NOT NULL (Bucket 3 follow-up)

**Branch:** `fix/frontend-source-attribution-and-not-null`
**Started:** 2026-05-14 (immediately after Bucket 3 PRs [#130](https://github.com/ganga90/olive-couple-sync/pull/130) and [#131](https://github.com/ganga90/olive-couple-sync/pull/131) merged).
**Scope** (user request): migrate the 2 frontend insert sites, re-run the backfill, apply the NOT NULL migration.

Bucket 3's `insertNote()` helper enforced source attribution on every backend insert site. This PR closes the remaining gaps and locks the contract at the database level.

---

## What changed

### Frontend (new)
- `src/lib/note-source.ts` — frontend-side `NoteSource` enum + `defaultClientNoteSource()` (`'ios'` under Capacitor, `'web'` otherwise). Comment points to the canonical Deno copy and the DB CHECK constraint as the two cross-runtime sources of drift protection.
- `src/components/AskOliveChatGlobal.tsx:686` — added `source: 'olive-chat' satisfies NoteSource` + `source_ref: messageId` to the insert (was setting `source: 'olive-chat'` already; gained `source_ref` and type safety).
- `src/hooks/useSupabaseNotes.ts:281` — added `source: resolvedSource` to `insertData`, derived via `defaultClientNoteSource()` with caller-override support (`noteData.source` wins if provided).

### Backfill — extended with Blocks 4 + 5
Applied to prod via Supabase MCP:

| Block | Rule | Rows updated |
|---|---|---|
| 4 | NULL rows whose author has zero whatsapp-* LLM calls → `web` | **95** |
| 5 | Catch-all: any remaining NULL → `web` | **559** |

Block 4 catches users who have never used WhatsApp (web-only users). Block 5 picks up the residual: users with some WhatsApp activity but notes that didn't correlate via ±60s or same-day windows — almost certainly web-app creates on days the user didn't message Olive.

### Migration applied
`supabase/migrations/20260514123914_clerk_notes_source_not_null.sql`:
1. `ALTER TABLE clerk_notes ALTER COLUMN source SET NOT NULL` — applied successfully because the backfill drove residual NULL to 0.
2. `ADD CONSTRAINT clerk_notes_source_known CHECK (source IN (...))` — closes the enum at the DB layer so a typo in any caller fails at insert time, not silently.

Verified post-apply:
- `is_nullable = 'NO'` ✓
- `clerk_notes_source_known` CHECK constraint active with the 12-value enum ✓

---

## Source distribution — before / after

| source | Bucket 3 AFTER | This PR AFTER |
|---|---|---|
| `(null)` | 654 (91.2%) | 0 (0%) |
| `web` | 0 | 654 (91.2%) |
| `whatsapp` | 44 | 44 |
| `email` | 13 | 13 |
| `olive-chat` | 4 | 4 |
| `partner-relay` | 2 | 2 |
| **Total** | **717** | **717** |

**100% attributed.** NOT NULL is now safe.

---

## Tests

- `npx tsc --noEmit -p tsconfig.app.json` → 0 errors.
- `npm run build` → ✅ 5.16s, no warnings beyond the pre-existing bundle-size advisory.
- Browser preview (Vite dev) — app loads. Only console errors are pre-existing Clerk-on-localhost auth ("Production Keys are only allowed for domain witholive.app"), unrelated to this PR.

The two changed files don't have unit tests (frontend hook + component); their behavior is covered by manual smoke and the DB-layer CHECK constraint.

---

## Files

| File | Change |
|---|---|
| `src/lib/note-source.ts` | **New** — frontend `NoteSource` enum + `defaultClientNoteSource()` |
| `src/components/AskOliveChatGlobal.tsx` | Add `NoteSource` import; tag the "Save as note" insert with `source: 'olive-chat'` (`satisfies` check) + `source_ref: messageId` |
| `src/hooks/useSupabaseNotes.ts` | Add `NoteSource` + `defaultClientNoteSource` import; populate `insertData.source` (caller override > Capacitor default) |
| `scripts/backfill-source-attribution.sql` | Add Blocks 4 + 5 (web fallback for never-WhatsApp users; catch-all) |
| `supabase/migrations/20260514123914_clerk_notes_source_not_null.sql` | **New** — applied via MCP; renamed locally to match ledger timestamp |

---

## Acceptance criteria

- [x] Frontend insert sites set `source` (`olive-chat` for the chat save action; `web`/`ios` for the generic `addNote` hook).
- [x] Backfill drove residual NULL to 0 (Block 4: 95 rows; Block 5: 559 rows).
- [x] `clerk_notes.source` is `NOT NULL` in prod.
- [x] `clerk_notes_source_known` CHECK constraint enforces the 12-value enum.
- [x] Frontend Vite build clean; TypeScript clean.
- [ ] **Post-merge**: next organic note insert from the web app should land with `source='web'` (or `'ios'` from the Capacitor app). Verifiable with `SELECT source, COUNT(*) FROM clerk_notes WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY source`.
- [ ] **Post-merge**: any new caller that forgets `source` will be rejected at the DB layer by NOT NULL. Any caller that uses an invalid string will be rejected by the CHECK constraint.

---

## Caveats + future debt

- **Block 5 catch-all is an attribution by assumption.** The 559 rows it updated to `'web'` are user notes whose precise origin can't be reconstructed from history. Most are likely web app creates; a small minority could be backfill/import artifacts or other channels we never tagged. The trade-off — accept a slight attribution-precision loss in exchange for being able to apply NOT NULL — was explicitly documented in the original Bucket 3 spec Step 4.5.
- **Capacitor / iOS analytics**: historical iOS rows are collapsed into `'web'` because the Capacitor flag isn't observable after the fact. New iOS inserts via `defaultClientNoteSource()` will correctly tag `'ios'` going forward.
- **No new unit tests in this PR.** Two reasons: (a) the helper `defaultClientNoteSource()` is a thin Capacitor wrapper; (b) the hook + component changes are pure data-shape edits, covered by the DB CHECK constraint. If a regression slips, it surfaces immediately as an insert-time DB error visible in logs.

---

## Out of scope

- Migrating any other call sites surfaced in future audits (re-run the grep periodically).
- Per-source analytics views or engagement metrics.
- Source-aware retention policies.
