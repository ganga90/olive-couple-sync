# supabase/migrations — folder doctrine

This file is loaded automatically when Claude Code reads anything in this folder. The full playbook is in [../../MIGRATIONS.md](../../MIGRATIONS.md).

## Four rules

1. **One file per schema change**, named `<YYYYMMDDHHMMSS>_<snake_case_name>.sql`.
2. **Apply via Supabase MCP `apply_migration`** — never via dashboard SQL editor, never via raw `execute_sql` for DDL.
3. **New tables MUST `ENABLE ROW LEVEL SECURITY`** with at least one policy scoped to `user_id` / `couple_id` / `space_id` / `group_id`.
4. **`SECURITY DEFINER` functions MUST `SET search_path = public, pg_temp`** — otherwise CVE.

## Scaffold a new migration

```bash
TS=$(date -u +%Y%m%d%H%M%S)
NAME=descriptive_snake_case_name
touch "supabase/migrations/${TS}_${NAME}.sql"
```

## After authoring

1. `apply_migration(name='${NAME}', query='<file contents>')` via MCP
2. Commit the file in the same PR as the dependent code
3. Mark the migration in the PR template's "Database changes" section

## When in doubt

Read [../../MIGRATIONS.md](../../MIGRATIONS.md). It covers rollback, troubleshooting, local dev, and the historical context behind why this discipline exists (post-Lovable reset on 2026-04-27).
