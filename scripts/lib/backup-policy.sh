#!/usr/bin/env bash
# Shared operator backup/restore policy. Source from trusted local scripts.
set -euo pipefail

sorted_backup_timeout() {
  local value="${1:-}" label="${2:-timeout}"
  if [[ ! "$value" =~ ^[0-9]+$ ]] ||
     (( 10#$value < 5 || 10#$value > 3600 )); then
    echo "$label must be between 5 and 3600 seconds" >&2
    return 1
  fi
  printf '%d\n' "$((10#$value))"
}

sorted_backup_remote() {
  local remote="${1:-}"
  if [[ ! "$remote" =~ ^[A-Za-z][A-Za-z0-9_-]{0,63}$ ]]; then
    echo "unsafe rclone remote name" >&2
    return 1
  fi
}

sorted_restore_confirm() {
  local target="$1" provided="${2:-}"
  if [[ -z "$target" || "$provided" != "$target" ]]; then
    echo "destructive restore confirmation required: set FSM_RESTORE_CONFIRM_DB to the exact target database name" >&2
    return 1
  fi
}

sorted_backup_archive_entries() {
  # Read a complete tar -tzf name listing; only normalized uploads paths pass.
  local entry count=0
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    if [[ "$entry" != "uploads" && "$entry" != "uploads/" && "$entry" != uploads/* ]] ||
       [[ "$entry" == /* || "$entry" == *\\* || "$entry" == *//* ||
          "$entry" == */./* || "$entry" == */../* ||
          "$entry" == */. || "$entry" == */.. ]] ||
       [[ "$entry" == *[[:cntrl:]]* ]]; then
      echo "invalid uploads archive path: $entry" >&2
      return 1
    fi
    count=$((count + 1))
  done
  if (( count < 1 )); then
    echo "uploads archive has no entries" >&2
    return 1
  fi
}
