# Schema migrations — Olive

## The doctrine (read this first)

**Every schema change is a file in `supabase/migrations/<YYYYMMDDHHMMSS>_descriptive_name.sql`, applied to production via Supabase MCP `apply_migration`, committed to the repo in the same PR as the application code that depends on it.**

Three rules, no exceptions:

1. **No Supabase dashboard SQL editor for schema changes.** Read-only inspection (SELECT) is fine. Schema changes (CREATE / ALTER / DROP / GRANT) go through the doctrine.
2. **No `apply_migration` MCP call without a corresponding repo file.** The SQL must exist in `supabase/migrations/` *before* being applied so PR review catches issues.
3. **The `name` argument to `apply_migration` must match the filename's descriptive_name segment.** Drift here breaks future grep-ability and audit trails.

---

## Why this discipline (the post-Lovable context)

Olive's early development happened on the Lovable platform, which applied schema changes directly to production via the migration API without committing the SQL back to the repo. Combined with ad-hoc dashboard SQL editor changes during incident response, this produced a divergent state by April 2026:

- Local repo had **306 migration files**.
- Remote ledger had **227 rows**.
- Only **2 timestamps** matched between the two.
- `supabase db push` was effectively broken.
- New engineers couldn't reconstruct schema locally.

On 2026-04-27, the migration history was reset under [Path C reconciliation](#path-c-reset-2026-04-27): all historical migration files were archived to git tag `migrations-archive-2026-04-27` and replaced with a single baseline file representing schema-as-of-reset. The remote ledger was truncated to one row pointing at that baseline.

**From this point forward**, the doctrine above is the only path. The CI workflow `.github/workflows/migration-lint.yml` enforces the most catastrophic violations.

---

## Workflow for adding a migration

### 1. Author the file

```bash
# From repo root
TS=$(date -u +%Y%m%d%H%M%S)
NAME=phase2_add_group_message_buffer  # snake_case, descriptive
touch "supabase/migrations/${TS}_${NAME}.sql"
```

Filename format (enforced by CI): `^[0-9]{14}_[a-z][a-z0-9_]+\.sql$`

### 2. Write the SQL

Required idempotency and safety patterns:

- New tables: include `ENABLE ROW LEVEL SECURITY` + at least one policy scoped to `user_id`, `couple_id`, `space_id`, or `group_id`.
- `SECURITY DEFINER` functions: explicit `SET search_path = public, pg_temp`.
- `DROP` statements: always `DROP ... IF EXISTS`.
- `CREATE TABLE`: prefer `IF NOT EXISTS` for replayability.
- Reversible: include a `-- DOWN:` comment block describing how to revert.

### 3. Apply to production via MCP

```
apply_migration(
  name='phase2_add_group_message_buffer',
  query='<paste contents of the file>'
)
```

The `name` MUST match the filename's descriptive_name (without timestamp). The MCP tool inserts a row into `supabase_migrations.schema_migrations`.

### 4. Verify

After applying, confirm with execute_sql:

```sql
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version >= '20260427' ORDER BY version DESC LIMIT 5;
```

The new migration should appear.

### 5. Commit in the same PR as dependent code

The PR description must declare the migration in the [PR template](.github/pull_request_template.md) checkboxes. CI lint will check filename format, RLS, search_path, DROP idempotency.

---

## Schema inspection (no changes)

Allowed:
- `execute_sql` MCP tool with `SELECT` queries
- Supabase dashboard SQL editor with `SELECT` only
- `\d`-style introspection queries via `pg_catalog` / `information_schema`

Forbidden as the *first* path:
- Pasting SQL into the dashboard editor that creates/alters/drops anything
- Running schema-modifying statements via `execute_sql` (use `apply_migration` instead so the ledger gets a row)

---

## Rollback procedure

Each migration must include a `-- DOWN:` comment block. To roll back a single recent migration:

1. Read the `-- DOWN:` block from the most recent migration file.
2. Apply the inverse SQL via `apply_migration` with name `revert_<original_name>`.
3. Mark original as reverted: `UPDATE supabase_migrations.schema_migrations SET ... WHERE version = '<TS>';` — actually, prefer using the Supabase CLI: `supabase migration repair --status reverted <version>`.
4. Commit a new file `<NEW_TS>_revert_<original_name>.sql` capturing the revert.

For a multi-migration rollback or the kind of catastrophic divergence that happened pre-2026-04-27, see the [emergency procedures](#emergency-history-reset) section.

---

## Local development setup

```bash
# Install Supabase CLI if needed
brew install supabase/tap/supabase

# Link to project (one-time)
supabase link --project-ref wtfspzvcetxmcfftwonq

# Verify migrations align
supabase migration list
# Should show local and remote agreeing on the baseline + any subsequent migrations

# Reset local DB (rebuilds from migration files)
supabase db reset --local

# Test new migration locally before applying to remote
supabase db reset --local
# Confirm your new SQL applies cleanly on top of baseline
```

---

## Troubleshooting

### `supabase db push` fails with "migration not in remote"

This means the local repo has a migration the remote ledger doesn't. **Don't run `db push --force`.** Instead:
1. Confirm the migration was actually applied to remote (check schema state).
2. If applied: `supabase migration repair --status applied <version>` to align ledger.
3. If not applied: apply it via `apply_migration` MCP, then verify.

### `supabase db push` fails with "remote has migrations not in local"

Someone applied a migration without committing the file. Find them, get the SQL, commit it under the matching timestamp, then `migration repair --status applied <version>`.

### `migration list` shows mismatched checksums

Means the local file's content drifted from what was applied to remote. Resolve by:
1. Inspect what's actually in remote (check schema).
2. If local file is correct and remote diverged: re-apply to remote.
3. If remote is correct and local file diverged: update local file to match.
4. **Never** edit `schema_migrations` rows directly — use `migration repair`.

### `apply_migration` returns "name already exists"

Two migrations with the same descriptive_name. Rename one (and its file) to disambiguate.

---

## CI enforcement

`.github/workflows/migration-lint.yml` runs on every PR touching `supabase/migrations/**`. Checks (all errors block the PR unless noted):

| Rule | Severity |
|---|---|
| Filename matches `^[0-9]{14}_[a-z][a-z0-9_]+\.sql$` | Error |
| `SECURITY DEFINER` functions must `SET search_path` | Error |
| `DROP` statements must use `IF EXISTS` | Error |
| New `CREATE TABLE` should `ENABLE ROW LEVEL SECURITY` | Warning (humans judge — system tables can opt out) |

The PR template forces declaration of any schema changes — humans catch the cases CI can't.

---

## Path C reset — 2026-04-27

Historical record of the one-time reset that produced the current baseline.

### What was done
1. Snapshotted ledger and schema to `/tmp/migration-reset-2026-04-27/` for rollback.
2. Constructed `supabase/migrations/20260427000000_baseline_post_lovable_reconciliation.sql` via Postgres introspection (`pg_get_functiondef`, `pg_get_indexdef`, `pg_get_triggerdef`, `pg_get_constraintdef`, RLS policy reconstruction).
3. Tagged pre-reset HEAD as `migrations-archive-2026-04-27` (preserves all 306 historical files).
4. Removed all 306 historical files from `supabase/migrations/`.
5. Truncated `supabase_migrations.schema_migrations` (dropped 227 rows).
6. Inserted one ledger row pointing at the new baseline.
7. Verified zero schema diff between baseline file and live remote.

### Recovering archived migrations

To inspect a historical migration file from the pre-reset era:

```bash
# List archived migrations
git ls-tree --name-only migrations-archive-2026-04-27 supabase/migrations/

# View one
git show migrations-archive-2026-04-27:supabase/migrations/20260413021340_olive_soul_system.sql
```

The archive tag is permanent.

---

## Emergency history reset

If the migration ledger ever diverges catastrophically again (only justified by external tooling that bypasses the doctrine), the procedure is documented in this file's git history under [Path C reset — 2026-04-27](#path-c-reset-2026-04-27). Do not undertake without:
1. Writing a new section under "Emergency history reset" with the full plan.
2. PR review and explicit go-ahead from the user.
3. Pre-reset snapshots saved per the Path C protocol.
