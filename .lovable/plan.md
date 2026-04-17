

## Root Cause

The previous edits introduced a new unified `assembleFullContext` (line 424) without removing the legacy Soul-aware `assembleFullContext` (lines 1395-1477). This created a duplicate symbol, which cascaded into Deno type-checking every related file and surfacing latent (pre-existing) issues across many `olive-*` functions.

Errors fall into 4 categories:

1. **Critical (blocking compile)** — duplicate function in `orchestrator.ts`
2. **Critical (regression I introduced)** — bad `parseNaturalDate` call shape in `ask-olive-stream/index.ts` (assumed `{ iso, hasTime }`, real shape is `{ date, time, readable }`; param is a string, not an options object)
3. **Critical (regression I introduced)** — `EMPTY_CTX` literal in `ask-olive-stream/index.ts` line 135 missing the 3 fields I added to `UnifiedContext` (`partnerContext`, `taskAnalytics`, `skills`)
4. **Pre-existing latent bugs surfacing now** — `catch (err)` blocks treating `err` as `any` (TS18046) across `olive-billing`, `olive-client-pipeline`, `olive-collaboration`, `olive-conflicts`, etc., plus `unknown[]` widening in `olive-consolidate`, plus `.then().catch()` misuse for an `await rpc()`

## Fix Plan

### 1. `supabase/functions/_shared/orchestrator.ts`
- **Delete the duplicate legacy `assembleFullContext`** at lines 1395-1477. Keep the SOUL types re-export at line 1393. The unified pipeline version at line 424 is the only callsite (verified in `ask-olive-stream/index.ts:145`).

### 2. `supabase/functions/ask-olive-stream/index.ts`
- **Line 135** — replace incomplete `EMPTY_CTX` literal with the canonical `EMPTY_CTX` constant exported from `orchestrator.ts` (or include the 3 missing fields).
- **Lines 434-458** — fix `parseNaturalDate` call:
  - Change signature: `parseNaturalDate(dateExpr, userTimezone)` (string, not object)
  - Replace `parsed.hasTime` → `!!parsed.time`
  - Replace `parsed.iso` → derive ISO from `parsed.date` + optional `parsed.time` (use `${parsed.date}T${parsed.time || '00:00'}:00` or just use `parsed.date` for due_date)
- **Line 596** — fix `.then(...).catch(...)` chain on `await`-able rpc: drop the `.then().catch()` and wrap in try/catch or use `.then(..., () => {})` pattern.

### 3. `supabase/functions/olive-consolidate/index.ts`
- **Line 115** — type the Set explicitly: `const uniqueUsers = [...new Set<string>((users || []).map((u: any) => String(u.user_id)))];` so `.filter((id: string) => …)` matches.

### 4. Edge functions with `err.message` on unknown
For each of: `olive-billing/index.ts`, `olive-client-pipeline/index.ts`, `olive-collaboration/index.ts`, `olive-conflicts/index.ts` (and any other surfaced by build):
- Replace `catch (err) { … err.message … }` with `catch (err) { … err instanceof Error ? err.message : String(err) … }` to make the cast explicit and safe.

### 5. Verification
- Run `supabase--deploy_edge_functions` on `whatsapp-webhook`, `ask-olive-stream`, `_shared` consumers (all share orchestrator), and `olive-billing`, `olive-client-pipeline`, `olive-collaboration`, `olive-conflicts`, `olive-consolidate`.
- Confirm no remaining type errors via deploy success.

### Out of Scope (not regressions)
The build error list also references many `_shared/*` and other files — those are flagged because Deno re-checks the whole graph when a single shared file fails to compile. Once orchestrator.ts compiles, the graph errors should clear except the 4 categories above.

### Files to Edit
- `supabase/functions/_shared/orchestrator.ts` (delete dead code)
- `supabase/functions/ask-olive-stream/index.ts` (3 fixes)
- `supabase/functions/olive-consolidate/index.ts` (typing)
- `supabase/functions/olive-billing/index.ts` (err typing)
- `supabase/functions/olive-client-pipeline/index.ts` (err typing)
- `supabase/functions/olive-collaboration/index.ts` (err typing)
- `supabase/functions/olive-conflicts/index.ts` (err typing)

