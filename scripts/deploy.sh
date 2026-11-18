#!/usr/bin/env bash
# Deploy a reviewed branch via the canonical garonhome entrypoint.
# Does NOT reset or check out files itself: deploy-garonhome.sh owns safe sync.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/deploy-safety.sh
source "${SCRIPT_DIR}/lib/deploy-safety.sh"
BRANCH="${1:-main}"
[[ $# -le 1 ]] || { echo "usage: $0 [branch]" >&2; exit 2; }
sorted_validate_deploy_branch "$BRANCH"
echo "Requesting authorized deployment of branch: $BRANCH"
ssh garonhome bash -s -- "$BRANCH" <<'REMOTE'
set -euo pipefail
branch="$1"
cd /opt/business/ai-fsm/repo
# No git reset, fetch, checkout or branch interpolation in remote shell input.
# The single production entrypoint revalidates the branch and refuses dirty worktrees.
DEPLOY_BRANCH="$branch" bash scripts/deploy-garonhome.sh
REMOTE
