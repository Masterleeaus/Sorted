#!/usr/bin/env bash
# Shared read-only tar archive type checks for encrypted uploads recoveries.
# GNU tar verbose listings begin each member with a file-type indicator:
# '-' regular file, 'd' directory, 'l' symlink, 'h' hardlink, etc.
# Refuse links and special files even when their apparent names are under uploads/.
set -euo pipefail

sorted_backup_archive_types() {
  local line count=0
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    case "${line:0:1}" in
      -|d) ;;
      *) echo "unsafe uploads archive entry type: ${line:0:1}" >&2; return 1 ;;
    esac
    count=$((count + 1))
  done
  if (( count == 0 )); then
    echo "uploads archive contains no member types" >&2
    return 1
  fi
}

sorted_backup_no_source_links() {
  local root="$1" link
  [[ -d "$root" && ! -L "$root" ]] || {
    echo "uploads root missing or symlinked" >&2
    return 1
  }
  link="$(find "$root" -type l -print -quit)"
  if [[ -n "$link" ]]; then
    echo "uploads contain a symlink; refusing to follow or archive it: $link" >&2
    return 1
  fi
}
