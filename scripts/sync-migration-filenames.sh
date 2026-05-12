#!/usr/bin/env bash
# scripts/sync-migration-filenames.sh
# =====================================================================
# Detect (and optionally auto-fix) drift between local migration filenames
# and prod's supabase_migrations.schema_migrations ledger.
#
# WHY THIS EXISTS
# ---------------
# The repo's migration doctrine (MIGRATIONS.md) is:
#   1. Author a file in supabase/migrations/<YYYYMMDDHHMMSS>_name.sql
#   2. Apply it via Supabase MCP `apply_migration`
#   3. Commit the file
#
# The MCP records the apply time in `schema_migrations.version`, not the
# filename's authoring time. If those two timestamps differ, the local
# file and the ledger row are misaligned, and `supabase db push` thinks
# the local file is unapplied — and re-runs it, which fails (CREATE TABLE
# on existing tables, etc.).
#
# This script catches that drift and renames local files to match the
# ledger 1-to-1 by descriptive name.
#
# WHAT IT DOES
# ------------
#   $ scripts/sync-migration-filenames.sh           # detect-only
#   $ scripts/sync-migration-filenames.sh --fix     # detect + rename
#
# Detect mode: print a diff between local filenames and ledger entries,
# exit 1 if any drift exists.
#
# Fix mode: for each local file whose descriptive name matches a ledger
# entry with a different timestamp, `git mv` the file to the ledger's
# timestamp. Names that don't match anything in the ledger are flagged
# (probably the user forgot to apply via MCP).
#
# REQUIREMENTS
# ------------
#   - supabase CLI installed and linked to the project
#   - jq installed (brew install jq)
#   - psql installed (comes with PostgreSQL — brew install libpq)
#   - SUPABASE_DB_PASSWORD env var set (or use `supabase status` to fetch)
#     If unset, the script falls back to detect-only mode via the CLI's
#     output (less precise: can detect drift count but not auto-rename).

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ─── Parse args ──────────────────────────────────────────────────────
MODE=detect
for arg in "$@"; do
  case "$arg" in
    --fix) MODE=fix ;;
    --help|-h)
      sed -n '/^# scripts/,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "error: unknown argument: $arg" >&2
      echo "usage: $0 [--fix]" >&2
      exit 2
      ;;
  esac
done

# ─── Sanity checks ───────────────────────────────────────────────────
if ! command -v supabase >/dev/null 2>&1; then
  echo "error: supabase CLI not in PATH" >&2
  echo "install: brew install supabase" >&2
  exit 2
fi

# ─── Pull ledger via supabase migration list ─────────────────────────
echo "→ querying ledger via 'supabase migration list --linked'..."
LIST_OUTPUT=$(supabase migration list --linked 2>&1)

# Extract LOCAL-only versions (in column 1, blank in column 2) and
# REMOTE-only versions (blank column 1, populated column 2). The CLI
# prints rows like:
#    20260427000000 | 20260427000000 | 2026-04-27 00:00:00
#    20260510194217 |                | 2026-05-10 19:42:17
#                   | 20260511013911 | 2026-05-11 01:39:11
LOCAL_ONLY=$(echo "$LIST_OUTPUT" | awk -F'|' '
  /^[[:space:]]*[0-9]{14}/ {
    local=$1; remote=$2;
    gsub(/[[:space:]]/, "", local); gsub(/[[:space:]]/, "", remote);
    if (local != "" && remote == "") print local;
  }')

REMOTE_ONLY=$(echo "$LIST_OUTPUT" | awk -F'|' '
  /^[[:space:]]*\|[[:space:]]*[0-9]{14}/ {
    local=$1; remote=$2;
    gsub(/[[:space:]]/, "", local); gsub(/[[:space:]]/, "", remote);
    if (remote != "" && local == "") print remote;
  }')

# Count non-empty lines; treat blank string as zero.
LOCAL_COUNT=0
REMOTE_COUNT=0
[ -n "$LOCAL_ONLY" ] && LOCAL_COUNT=$(printf '%s\n' "$LOCAL_ONLY" | wc -l | tr -d ' ')
[ -n "$REMOTE_ONLY" ] && REMOTE_COUNT=$(printf '%s\n' "$REMOTE_ONLY" | wc -l | tr -d ' ')

if [ "$LOCAL_COUNT" -eq 0 ] && [ "$REMOTE_COUNT" -eq 0 ]; then
  echo "✓ Local files and remote ledger are in 1-to-1 alignment. No drift."
  exit 0
fi

echo ""
echo "⚠ Drift detected:"
echo "  local-only files (in repo, not in ledger):       $LOCAL_COUNT"
echo "  remote-only entries (in ledger, no local file): $REMOTE_COUNT"
echo ""

if [ "$LOCAL_COUNT" -gt "0" ]; then
  echo "Local-only file timestamps:"
  echo "$LOCAL_ONLY" | sed 's/^/  /'
  echo ""
fi
if [ "$REMOTE_COUNT" -gt "0" ]; then
  echo "Remote-only ledger timestamps:"
  echo "$REMOTE_ONLY" | sed 's/^/  /'
  echo ""
fi

# ─── For auto-fix, we need names. Try to get them via psql. ──────────
if [ "$MODE" = "detect" ]; then
  echo "To auto-rename, re-run with --fix:"
  echo "  $ $0 --fix"
  echo ""
  echo "Or manually:"
  echo "  1. Query names via MCP execute_sql:"
  echo "       SELECT version, name FROM supabase_migrations.schema_migrations"
  echo "       WHERE version >= '<earliest local-only ts>' ORDER BY version;"
  echo "  2. For each local file <X>_<name>.sql whose descriptive_name appears"
  echo "     in the result under a different version <Y>, run:"
  echo "       git mv supabase/migrations/<X>_<name>.sql supabase/migrations/<Y>_<name>.sql"
  echo "  3. Re-run this script with no args to confirm alignment."
  exit 1
fi

# ─── --fix mode: query ledger via psql for name mapping ──────────────
if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not in PATH (needed for --fix mode)" >&2
  echo "install: brew install libpq && brew link --force libpq" >&2
  exit 2
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "error: SUPABASE_DB_URL env var not set (needed for --fix mode)" >&2
  echo "" >&2
  echo "set it via:" >&2
  echo "  export SUPABASE_DB_URL=\$(supabase status --output=env | grep '^DB_URL=' | cut -d= -f2-)" >&2
  echo "" >&2
  echo "or get the connection string from the Supabase dashboard:" >&2
  echo "  Project Settings → Database → Connection string (Direct connection)" >&2
  exit 2
fi

echo "→ fetching version+name from ledger for unmatched entries..."
LEDGER_NAMES=$(psql "$SUPABASE_DB_URL" -tA -F'|' -c \
  "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;")

# Build a map: name → ledger_version
declare -A NAME_TO_LEDGER_VERSION
while IFS='|' read -r ver name; do
  [ -z "$ver" ] && continue
  NAME_TO_LEDGER_VERSION["$name"]="$ver"
done <<< "$LEDGER_NAMES"

# For each local-only file, look for a matching name in the ledger
RENAMES=0
UNRESOLVED=()
for local_ts in $LOCAL_ONLY; do
  # Find the local file with this timestamp
  file=$(ls "supabase/migrations/${local_ts}_"*.sql 2>/dev/null | head -1 || true)
  if [ -z "$file" ]; then
    echo "  warn: local-only ts $local_ts has no matching file?"
    continue
  fi
  base=$(basename "$file" .sql)
  name="${base#${local_ts}_}"

  ledger_ver="${NAME_TO_LEDGER_VERSION[$name]:-}"
  if [ -z "$ledger_ver" ]; then
    UNRESOLVED+=("$file (no ledger entry with name '$name')")
    continue
  fi

  if [ "$ledger_ver" = "$local_ts" ]; then
    # Timestamps match — nothing to do (shouldn't normally hit this branch
    # because local_ts is in LOCAL_ONLY by definition)
    continue
  fi

  new_file="supabase/migrations/${ledger_ver}_${name}.sql"
  echo "  rename: $file → $new_file"
  git mv "$file" "$new_file"
  RENAMES=$((RENAMES + 1))
done

echo ""
echo "Summary:"
echo "  files renamed: $RENAMES"
if [ ${#UNRESOLVED[@]} -gt 0 ]; then
  echo "  unresolved local-only files (probably forgot to apply via MCP):"
  for u in "${UNRESOLVED[@]}"; do echo "    $u"; done
fi

if [ "$RENAMES" -gt "0" ]; then
  echo ""
  echo "→ re-running detection to verify final alignment..."
  echo ""
  "$0"
fi
