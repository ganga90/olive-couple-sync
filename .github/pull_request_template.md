## Summary

<!-- 1-2 sentences. What changed and why. -->

## Database changes

<!-- Pick exactly one: -->

- [ ] **No schema changes** — this PR does not add/modify/remove tables, columns, indexes, RLS policies, functions, triggers, or extensions.

- [ ] **Schema changes** — list migration file(s):
  - [ ] `supabase/migrations/<TS>_<name>.sql`
  - **Applied to production via MCP `apply_migration`?** [ ] yes — name argument used: `<name>`
  - **`supabase migration list` shows local and remote in sync?** [ ] yes
  - **New tables (if any) have `ENABLE ROW LEVEL SECURITY` + scoped policies?** [ ] yes / [ ] N/A
  - **`SECURITY DEFINER` functions (if any) have explicit `SET search_path`?** [ ] yes / [ ] N/A
  - **`-- DOWN:` block included in each migration file for reversibility?** [ ] yes

  See [MIGRATIONS.md](../MIGRATIONS.md) for the full doctrine.

## Test plan

<!-- Bulleted checklist. Be specific. -->

- [ ] `deno test supabase/functions/_shared/ --allow-net --allow-read --allow-env` passes
- [ ] Edge functions modified: tested via `supabase functions invoke <name>` or live trigger
- [ ] Frontend changes: smoke-tested in `dev` preview deploy
- [ ] No spike in `error_count` in `olive_llm_calls` after merge
- [ ] Manual smoke test: <describe what was tested>

## Acceptance criteria

<!-- For TASK-ID PRs, paste the criteria from OLIVE_Engineering_Plan.md or IMPLEMENTATION_PLAN.md -->

- [ ] <criterion 1>
- [ ] <criterion 2>

## CHANGES.md entry

After merge, ensure `CHANGES.md` has a line like:

```
| YYYY-MM-DD | TASK-ID | files_touched | Description |
```

🌿
