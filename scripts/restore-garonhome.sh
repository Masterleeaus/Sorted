#!/usr/bin/env bash
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/backup-policy.sh
source "${SCRIPT_DIR}/lib/backup-policy.sh"
# shellcheck source=./lib/deploy-safety.sh
source "${SCRIPT_DIR}/lib/deploy-safety.sh"

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

# A restore is destructive. Refuse legacy plaintext input and reserved system
# databases, even if a caller supplies a checksum manifest for them.
if [[ "${DUMP_FILE}" != *.dump.gpg ]]; then
  echo "ERROR: restore accepts only encrypted *.dump.gpg backup sets" >&2
  exit 1
fi
if [[ -z "${POSTGRES_DB:-}" || -z "${POSTGRES_USER:-}" ]] ||
   [[ "${POSTGRES_DB}" == "postgres" || "${POSTGRES_DB}" == "template0" || "${POSTGRES_DB}" == "template1" ]]; then
  echo "ERROR: missing or unsafe target database/owner; refusing destructive restore" >&2
  exit 1
fi
if [[ ! -s "${PASSPHRASE_FILE}" ]]; then
  echo "ERROR: backup decryption passphrase unavailable; refusing destructive restore" >&2
  exit 1
fi

# Verify the set's checksum manifest when present (written by backup-garonhome.sh).
DUMP_DIR="$(cd "$(dirname "${DUMP_FILE}")" && pwd)"
DUMP_BASE="$(basename "${DUMP_FILE}")"
SET_TS="${DUMP_BASE#ai_fsm_}"
SET_TS="${SET_TS%.dump*}"
MANIFEST="${DUMP_DIR}/ai_fsm_${SET_TS}.sha256"
if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: checksum manifest missing: ${MANIFEST}; refusing destructive restore" >&2
  echo "Recover the verified manifest before proceeding (see docs/BACKUP_RUNBOOK.md)." >&2
  exit 1
fi
# Require exactly the three known encrypted artifacts, each represented
# once in the manifest. Without this, sha256sum -c can pass a dump-only
# manifest while two companion files are present but unverified.
if [[ ! "${SET_TS}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
  echo "ERROR: invalid backup set identifier" >&2
  exit 1
fi
expected=(
  "ai_fsm_${SET_TS}.dump.gpg"
  "ai_fsm_uploads_${SET_TS}.tar.gz.gpg"
  "ai_fsm_env_${SET_TS}.gpg"
)
mapfile -t manifest_lines < "${MANIFEST}"
if (( ${#manifest_lines[@]} != 3 )); then
  echo "ERROR: backup manifest must contain exactly three artifact checksums" >&2
  exit 1
fi
for required in "${expected[@]}"; do
  if [[ ! -f "${DUMP_DIR}/${required}" ]]; then
    echo "ERROR: backup set missing required artifact: ${required}" >&2
    exit 1
  fi
  matched=0
  for entry in "${manifest_lines[@]}"; do
    if [[ "${entry}" =~ ^[0-9a-f]{64}[[:space:]][[:space:]] ]] &&
       [[ "${entry:66}" == "${required}" ]]; then
      matched=$((matched + 1))
    fi
  done
  if (( matched != 1 )); then
    echo "ERROR: missing or duplicate checksum entry for ${required}" >&2
    exit 1
  fi
done
if ! (cd "${DUMP_DIR}" && sha256sum -c "$(basename "${MANIFEST}")"); then
  echo "ERROR: backup checksum verification failed; nothing was stopped or dropped" >&2
  exit 1
fi

# Encrypted sets (*.dump.gpg) stream from gpg straight into pg_restore, so no
# plaintext dump is written to disk. Decrypt once to /dev/null first: this checks
# the passphrase and gpg's integrity check before web/worker are stopped or the
# database is dropped.
dump_stream() {
  gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" "${DUMP_FILE}"
}
dump_stream > /dev/null
# The companion archives must decrypt successfully too; a valid SHA-256 file
# alone is insufficient to establish recoverability with the current key.
for artifact in "${expected[@]:1}"; do
  if ! gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
    "${DUMP_DIR}/${artifact}" > /dev/null; then
    echo "ERROR: cannot decrypt companion archive ${artifact}; restore aborted" >&2
    exit 1
  fi
done

# Validate the encrypted uploads as a readable tar BEFORE stopping services.
# A decryptable random file is not a usable uploads archive. Never extract the
# archive here; this is a read-only format and entry-list verification.
# A complete tar stream must be listed before validating its member names.
ARCHIVE_ENTRIES="$(mktemp)"
trap 'rm -f -- "${ARCHIVE_ENTRIES}"' EXIT
if ! gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
  "${DUMP_DIR}/${expected[1]}" | tar -tzf - > "${ARCHIVE_ENTRIES}"; then
  echo "ERROR: uploads archive is not a readable compressed tar; restore aborted" >&2
  exit 1
fi
sorted_backup_archive_entries < "${ARCHIVE_ENTRIES}"
rm -f -- "${ARCHIVE_ENTRIES}"
trap - EXIT
# Require the encrypted environment backup to contain essential DB credentials.
if ! gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
  "${DUMP_DIR}/${expected[2]}" | grep '^POSTGRES_PASSWORD=' > /dev/null; then
  echo "ERROR: encrypted environment backup does not contain PostgreSQL credentials" >&2
  exit 1
fi

# Confirmation is validated only after safe read-only preflight. Do not allow
# unattended one-argument commands to destroy a live database by accident.
sorted_restore_confirm "${POSTGRES_DB}" "${FSM_RESTORE_CONFIRM_DB:-}"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" stop web worker

# Pass names as psql variables, using identifier/literal quoting rather than
# interpolating environment values into SQL. Quote the heredoc delimiter so
# the shell cannot expand or execute SQL source text.
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  psql -U "${POSTGRES_USER:-ai_fsm}" -d postgres -v ON_ERROR_STOP=1 \
  -v "target_db=${POSTGRES_DB}" -v "target_owner=${POSTGRES_USER}" <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_db'
  AND pid <> pg_backend_pid();
DROP DATABASE IF EXISTS :"target_db";
CREATE DATABASE :"target_db" OWNER :"target_owner";
SQL

dump_stream | docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-privileges --exit-on-error

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up -d web worker

# Wait for web to be healthy, then verify from inside the container
# (host port 3000 may be occupied by another service)
WEB_CONTAINER=$(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" ps -q web)
echo "waiting for web to be healthy..."
RESTORE_WEB_ATTEMPTS="$(sorted_wait_attempts "${FSM_RESTORE_WEB_ATTEMPTS:-30}" "restore web attempts")"
sorted_wait_for_web_health "${RESTORE_WEB_ATTEMPTS}" 2 "${WEB_CONTAINER}"

docker exec "${WEB_CONTAINER}" wget -qO- http://127.0.0.1:3000/api/health
echo ""
