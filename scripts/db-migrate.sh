#!/usr/bin/env bash
# Legacy Sorted migration runner. This remains separate from Central's future
# canonical company_id migration authority until issue #26 is reconciled.
set -euo pipefail

DATABASE_URL="${MIGRATION_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "MIGRATION_DATABASE_URL (or DATABASE_URL for existing setups) is required" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MIGRATIONS_DIR="${REPO_ROOT}/db/migrations"
# shellcheck source=./lib/migration-safety.sh
source "${SCRIPT_DIR}/lib/migration-safety.sh"

psql_cmd() {
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" "$@"
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    echo "psql is required (or Docker with postgres:16 as client)" >&2
    return 1
  fi
  docker run --rm -i --network host -v "${REPO_ROOT}:${REPO_ROOT}" -w "${REPO_ROOT}" postgres:16 \
    psql "$DATABASE_URL" "$@"
}

# Validate inputs BEFORE the first database modification.
files_text="$(sorted_migration_files "$MIGRATIONS_DIR")"
mapfile -t MIGRATION_FILES <<< "$files_text"
# Check the actual connected database, not a possibly unrelated POSTGRES_DB
# environment value. This prevents accidental migrations of system databases.
connected_db="$(psql_cmd -X -q -tA -v ON_ERROR_STOP=1 -c 'SELECT current_database()')"
sorted_validate_db_identity "$connected_db" "migration-runner"

psql_cmd -X -v ON_ERROR_STOP=1 -c "
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )"
state="$(psql_cmd -X -q -tA -v ON_ERROR_STOP=1 -f "${SCRIPT_DIR}/sql/migration-state.sql")"
sorted_assert_tracking_state "$state"

for file in "${MIGRATION_FILES[@]}"; do
  filename="${file##*/}"
  applied="$(psql_cmd -X -q -tA -v ON_ERROR_STOP=1 \
    -v "migration_filename=${filename}" -f "${SCRIPT_DIR}/sql/is-migration-applied.sql")"
  case "$applied" in
    1) echo "skipping (already applied): $filename"; continue ;;
    0) ;;
    *) echo "invalid applied count for $filename: $applied" >&2; exit 1 ;;
  esac
  echo "applying migration atomically: $filename"
  # -1 wraps all files in one database transaction. Advisory lock + a second
  # pending check prevent simultaneous deploys from replaying a migration.
  # Bookkeeping is committed ONLY with the migration's SQL.
  psql_cmd -X -1 -v ON_ERROR_STOP=1 -v "migration_filename=${filename}" \
    -f "${SCRIPT_DIR}/sql/migration-lock.sql" \
    -f "${SCRIPT_DIR}/sql/assert-migration-pending.sql" \
    -f "$file" \
    -f "${SCRIPT_DIR}/sql/record-migration.sql"
done
echo "migrations complete"
