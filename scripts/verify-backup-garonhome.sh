#!/usr/bin/env bash
# Restore drill for one encrypted backup set (see docs/BACKUP_RUNBOOK.md).
# Decrypts the set into a private temp dir, restores the dump into a scratch
# database, checks the uploads archive and the .env backup, then removes all
# plaintext and the scratch database. The cleanup trap runs on success AND failure.
#
# Usage: verify-backup-garonhome.sh /path/to/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 /path/to/ai_fsm_YYYYMMDDTHHMMSSZ.dump.gpg" >&2
  exit 2
fi

DUMP_GPG="$1"
if [[ ! -f "${DUMP_GPG}" ]]; then
  echo "dump not found: ${DUMP_GPG}" >&2
  exit 1
fi

SET_DIR="$(cd "$(dirname "${DUMP_GPG}")" && pwd)"
SET_TS="$(basename "${DUMP_GPG}")"
SET_TS="${SET_TS#ai_fsm_}"
SET_TS="${SET_TS%.dump.gpg}"
UPLOADS_GPG="${SET_DIR}/ai_fsm_uploads_${SET_TS}.tar.gz.gpg"
ENV_GPG="${SET_DIR}/ai_fsm_env_${SET_TS}.gpg"
MANIFEST="${SET_DIR}/ai_fsm_${SET_TS}.sha256"

DEPLOY_ROOT="${FSM_DEPLOY_ROOT:-/opt/business/ai-fsm}"
REPO_ROOT="${FSM_REPO_ROOT:-${DEPLOY_ROOT}/repo}"
ENV_FILE="${FSM_ENV_FILE:-${DEPLOY_ROOT}/env/.env}"
COMPOSE_FILE="${FSM_COMPOSE_FILE:-${REPO_ROOT}/infra/compose.garonhome.yml}"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

PASSPHRASE_FILE="${FSM_BACKUP_PASSPHRASE_FILE:-${DEPLOY_ROOT}/env/backup.passphrase}"
COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

for f in "${UPLOADS_GPG}" "${ENV_GPG}" "${MANIFEST}"; do
  if [[ ! -f "${f}" ]]; then
    echo "incomplete set: missing ${f}" >&2
    exit 1
  fi
done
if [[ ! -s "${PASSPHRASE_FILE}" ]]; then
  echo "passphrase file missing or empty: ${PASSPHRASE_FILE}" >&2
  exit 1
fi

# Private work dir for plaintext. Lives outside the backup dir.
WORK_ROOT="${FSM_VERIFY_TMPDIR:-${TMPDIR:-/tmp}}"
WORK="$(mktemp -d "${WORK_ROOT%/}/fsm-restore-verify.XXXXXX")"
chmod 700 "${WORK}"
SCRATCH_DB="ai_fsm_verify_$$"
SCRATCH_CREATED=0

cleanup() {
  local rc=$?
  if (( SCRATCH_CREATED == 1 )); then
    "${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER}" -d postgres \
      -c "DROP DATABASE IF EXISTS ${SCRATCH_DB};" >/dev/null 2>&1 \
      || echo "WARNING: could not drop scratch database ${SCRATCH_DB}" >&2
  fi
  rm -rf -- "${WORK}"
  if (( rc == 0 )); then
    echo "VERIFY OK: ${SET_TS} (plaintext and scratch database removed)"
  else
    echo "VERIFY FAILED (exit ${rc}): ${SET_TS} (plaintext and scratch database removed)" >&2
  fi
  exit "${rc}"
}
trap cleanup EXIT

# 1. Checksums of every encrypted artifact in the set.
(cd "${SET_DIR}" && sha256sum -c --quiet "$(basename "${MANIFEST}")")
echo "checksums: ok"

# 2. Decrypt all three artifacts into the private work dir.
gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
  -o "${WORK}/dump" "${DUMP_GPG}"
gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
  -o "${WORK}/uploads.tar.gz" "${UPLOADS_GPG}"
gpg --batch --quiet --decrypt --passphrase-file "${PASSPHRASE_FILE}" \
  -o "${WORK}/env" "${ENV_GPG}"
echo "decrypt: ok"

# 3. Uploads archive must be a readable tar with at least one entry.
UPLOAD_ENTRIES="$(tar -tzf "${WORK}/uploads.tar.gz" | wc -l)"
if (( UPLOAD_ENTRIES < 1 )); then
  echo "uploads archive is empty" >&2
  exit 1
fi
echo "uploads archive: ${UPLOAD_ENTRIES} entries"

# 4. The .env backup must contain the database settings the app needs.
grep -q '^POSTGRES_PASSWORD=' "${WORK}/env"
echo "env backup: ok"

# 5. Restore the dump into a scratch database and count public tables.
SCRATCH_CREATED=1
"${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER}" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${SCRATCH_DB};" >/dev/null
"${COMPOSE[@]}" exec -T postgres pg_restore -U "${POSTGRES_USER}" -d "${SCRATCH_DB}" \
  --no-owner --no-privileges < "${WORK}/dump"
TABLES="$("${COMPOSE[@]}" exec -T postgres psql -U "${POSTGRES_USER}" -d "${SCRATCH_DB}" -tA \
  -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"
TABLES="${TABLES//[[:space:]]/}"
if ! [[ "${TABLES}" =~ ^[0-9]+$ ]] || (( TABLES < 1 )); then
  echo "restored scratch database has no public tables (got '${TABLES}')" >&2
  exit 1
fi
echo "dump restored to scratch database: ${TABLES} public tables"
