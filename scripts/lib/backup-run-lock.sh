#!/usr/bin/env bash
# Advisory process lock and durable in-progress status for scheduled backups.
# The kernel releases flock at exit, while ACTIVE remains after abnormal exit
# to make stale or interrupted runs visible to independent monitoring.
set -euo pipefail

sorted_backup_lock_start() {
  local status_dir="$1" set_id="$2" started_at="$3"
  mkdir -p -- "$status_dir"
  command -v flock >/dev/null 2>&1 || {
    echo "flock is required for safe backup scheduling" >&2
    return 1
  }
  exec {SORTED_BACKUP_LOCK_FD}>"$status_dir/.backup.lock"
  if ! flock -n "$SORTED_BACKUP_LOCK_FD"; then
    echo "another backup is already running; refusing a concurrent set" >&2
    return 1
  fi
  # A previous interruption remains unsafe until an operator reconciles it;
  # do not silently overwrite a stale ACTIVE marker or an incomplete status.
  if [[ -e "$status_dir/ACTIVE" ]]; then
    echo "stale ACTIVE backup marker; investigate interrupted prior run" >&2
    return 1
  fi
  printf '{"status":"running","set":"%s","started_at":"%s"}\n' \
    "$set_id" "$started_at" > "$status_dir/ACTIVE.tmp"
  mv -- "$status_dir/ACTIVE.tmp" "$status_dir/ACTIVE"
}

sorted_backup_lock_finish() {
  local status_dir="$1"
  rm -f -- "$status_dir/ACTIVE"
}
