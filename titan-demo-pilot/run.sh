#!/usr/bin/env bash
set -euo pipefail
MODE="${1:---dry-run}"
[[ "$MODE" == "--dry-run" || "$MODE" == "--apply" ]] || { echo 'Usage: ./run.sh --dry-run|--apply'; exit 2; }
: "${TITAN_ACCOUNT_ID:?Set TITAN_ACCOUNT_ID to your verified account UUID}"
: "${TITAN_OWNER_ID:?Set TITAN_OWNER_ID to your verified owner user UUID}"
: "${DATABASE_URL:?Set DATABASE_URL using the existing production environment without printing it}"
[[ "$TITAN_ACCOUNT_ID" =~ ^[0-9a-fA-F-]{36}$ && "$TITAN_OWNER_ID" =~ ^[0-9a-fA-F-]{36}$ ]] || { echo 'Invalid UUID format'; exit 2; }
DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ "$MODE" == '--apply' ]]; then
  [[ "${TITAN_DEMO_BACKUP_CONFIRMED:-}" == YES ]] || { echo 'Set TITAN_DEMO_BACKUP_CONFIRMED=YES only after a verified pg_dump backup'; exit 3; }
  read -r -p 'Type APPLY-DEMO to commit 235 synthetic records: ' CONFIRM
  [[ "$CONFIRM" == APPLY-DEMO ]] || exit 4
fi
APPLY=false; [[ "$MODE" == '--apply' ]] && APPLY=true
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -v account_id="$TITAN_ACCOUNT_ID" -v owner_id="$TITAN_OWNER_ID" -v apply="$APPLY" -f "$DIR/seed.sql"
