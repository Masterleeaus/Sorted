#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg"
  exit 1
fi

DUMP_FILE="$1"
if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "dump file not found: ${DUMP_FILE}"
  exit 1
fi

DEPLOY_ROOT="${FSM_DEPLOY_ROOT:-/opt/business/ai-fsm}"
REPO_ROOT="${FSM_REPO_ROOT:-${DEPLOY_ROOT}/repo}"
ENV_FILE="${FSM_ENV_FILE:-${DEPLOY_ROOT}/env/.env}"
COMPOSE_FILE="${FSM_COMPOSE_FILE:-${REPO_ROOT}/infra/compose.garonhome.yml}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

PASSPHRASE_FILE="${FSM_BACKUP_PASSPHRASE_FILE:-${DEPLOY_ROOT}/env/backup.passphrase}"

# Verify the set's checksum manifest when present (written by backup-garonhome.sh).
DUMP_DIR="$(cd "$(dirname "${DUMP_FILE}")" && pwd)"
DUMP_BASE="$(basename "${DUMP_FILE}")"
SET_TS="${DUMP_BASE#ai_fsm_}"
SET_TS="${SET_TS%.dump*}"
MANIFEST="${DUMP_DIR}/ai_fsm_${SET_TS}.sha256"
if [[ -f "${MANIFEST}" ]]; then
  if ! (cd "${DUMP_DIR}" && grep -F "  ${DUMP_BASE}" "$(basename "${MANIFEST}")" | sha256sum -c -); then
    echo "ERROR: checksum mismatch for ${DUMP_FILE}; nothing was stopped or dropped" >&2
    exit 1
  fi
else
  echo "WARNING: no checksum manifest at ${MANIFEST}; skipping checksum check" >&2
fi

# Encrypted sets (*.dump.gpg) stream from gpg straight into pg_restore, so no
# plaintext dump is written to disk. Decrypt once to /dev/null first: this checks
# the passphrase and gpg's integrity check before web/worker are stopped or the
# database is dropped.
dump_stream() {
  if [[ "${DUMP_FILE}" == *.gpg ]]; then
    gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" "${DUMP_FILE}"
  else
    cat "${DUMP_FILE}"
  fi
}
dump_stream > /dev/null

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop web worker

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER:-ai_fsm}" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${POSTGRES_DB}'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS ${POSTGRES_DB};
CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};
SQL

dump_stream | docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-privileges

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d web worker

# Wait for web to be healthy, then verify from inside the container
# (host port 3000 may be occupied by another service)
WEB_CONTAINER=$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q web)
echo "waiting for web to be healthy..."
for _ in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "${WEB_CONTAINER}" 2>/dev/null || echo "unknown")
  if [[ "${STATUS}" == "healthy" ]]; then
    break
  fi
  sleep 2
done

docker exec "${WEB_CONTAINER}" wget -qO- http://127.0.0.1:3000/api/health
echo ""
