#!/usr/bin/env bash
# Shared read-only deployment preflight utilities; does not perform Git/Docker writes.
# Call after sourcing only trusted, operator-controlled deployment configuration.
set -euo pipefail

sorted_validate_deploy_branch() {
  local branch="${1:-}"
  # Forbid options, whitespace, shell metacharacters, revision expressions and
  # ambiguous refs. Slash-separated feature branches remain valid.
  if [[ ! "$branch" =~ ^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,127}$ ]] ||
     [[ "$branch" == *..* || "$branch" == */ || "$branch" == *//*
        || "$branch" == *.lock || "$branch" == -* || "$branch" == *./* ]]; then
    echo "unsafe deployment branch: $branch" >&2
    return 1
  fi
}

sorted_wait_attempts() {
  local value="${1:-}" label="${2:-wait attempts}"
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( 10#$value < 1 || 10#$value > 300 )); then
    echo "$label must be an integer between 1 and 300" >&2
    return 1
  fi
  printf '%d\n' "$((10#$value))"
}

sorted_wait_for_postgres() {
  local attempts="$1" interval="$2"
  shift 2
  local i
  for ((i=1; i<=attempts; i++)); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    if (( i < attempts )); then sleep "$interval"; fi
  done
  echo "database readiness timed out after ${attempts} attempts" >&2
  return 1
}

sorted_wait_for_web_health() {
  local attempts="$1" interval="$2" container="$3"
  local state i
  [[ -n "$container" ]] || { echo "missing web container ID" >&2; return 1; }
  for ((i=1; i<=attempts; i++)); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "$container" 2>/dev/null || true)"
    case "$state" in
      healthy) return 0 ;;
      unhealthy|no-healthcheck|exited|dead)
        echo "web container health is ${state}; refusing to treat deployment as healthy" >&2
        return 1 ;;
    esac
    if (( i < attempts )); then sleep "$interval"; fi
  done
  echo "web health timed out after ${attempts} attempts" >&2
  return 1
}
