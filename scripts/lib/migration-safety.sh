#!/usr/bin/env bash
# Shared fail-closed checks for Sorted's legacy PostgreSQL migration chain.
# Source from a bash migration runner. Never source or execute donor SQLite SQL.
# Central's future company_id authority must replace this legacy chain explicitly.
set -euo pipefail

sorted_migration_files() {
  local dir="$1"
  [[ -d "$dir" ]] || { echo "migration directory unavailable: $dir" >&2; return 1; }
  local found=0 file name
  shopt -s nullglob
  for file in "$dir"/*.sql; do
    name="${file##*/}"
    # Only dev seed is omitted. Never match arbitrary filenames containing
    # 'seed', since this silently omits real migrations.
    [[ "$name" == "002_seed_dev.sql" ]] && continue
    if [[ ! "$name" =~ ^[0-9]{3}_[a-zA-Z0-9_]+\.sql$ ]]; then
      echo "invalid migration filename: $name" >&2
      shopt -u nullglob
      return 1
    fi
    printf '%s\n' "$file"
    found=$((found + 1))
  done
  shopt -u nullglob
  if (( found == 0 )); then
    echo "no SQL migrations found in $dir; refusing deployment" >&2
    return 1
  fi
}

sorted_assert_tracking_state() {
  # Args: migration mode (fresh|tracked|untracked), allow explicit legacy seed.
  # A populated schema with zero migration history must never silently claim all
  # migrations were applied: this conceals real migration drift.
  case "$1" in
    fresh|tracked) return 0 ;;
    untracked)
      echo "existing database has no trustworthy migration tracking; manual reconciliation required" >&2
      return 1 ;;
    *)
      echo "unrecognised migration-tracking state: $1" >&2
      return 1 ;;
  esac
}

sorted_validate_db_identity() {
  local db="$1" user="$2"
  [[ -n "$db" && -n "$user" ]] || { echo "database and owner must be set" >&2; return 1; }
  case "$db" in
    postgres|template0|template1)
      echo "reserved PostgreSQL system database cannot be migrated: $db" >&2
      return 1 ;;
  esac
}
