#!/usr/bin/env bash
set -euo pipefail

DEPLOY_ROOT="${FSM_DEPLOY_ROOT:-/opt/business/ai-fsm}"
REPO_ROOT="${FSM_REPO_ROOT:-${DEPLOY_ROOT}/repo}"
ENV_FILE="${FSM_ENV_FILE:-${DEPLOY_ROOT}/env/.env}"
COMPOSE_FILE="${FSM_COMPOSE_FILE:-${REPO_ROOT}/infra/compose.garonhome.yml}"
BACKUP_DIR="${FSM_BACKUP_DIR:-${DEPLOY_ROOT}/backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="${BACKUP_DIR}/ai_fsm_${TIMESTAMP}.dump.gpg"
UPLOADS_FILE="${BACKUP_DIR}/ai_fsm_uploads_${TIMESTAMP}.tar.gz.gpg"
ENV_FILE_BACKUP="${BACKUP_DIR}/ai_fsm_env_${TIMESTAMP}.gpg"
MANIFEST_FILE="${BACKUP_DIR}/ai_fsm_${TIMESTAMP}.sha256"

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# Resolve AFTER sourcing .env so FSM_DATA_ROOT / FSM_BACKUP_PASSPHRASE_FILE set
# only in the env file are honored (they would otherwise fall back to defaults
# and silently skip the uploads / encrypted-.env backups).
DATA_ROOT="${FSM_DATA_ROOT:-${DEPLOY_ROOT}/data}"
PASSPHRASE_FILE="${FSM_BACKUP_PASSPHRASE_FILE:-${DEPLOY_ROOT}/env/backup.passphrase}"

# ponytail: DB dump and the uploads tar are taken sequentially while web/worker
# stay live, so an upload deleted between the two can leave a dump row whose file
# is missing from the archive. Acceptable for a solo nightly backup run at a
# low-activity hour; upgrade to a coordinated filesystem snapshot only if
# concurrent write volume during the backup window ever makes this real.

mkdir -p "${BACKUP_DIR}"

# Every artifact is encrypted (AES-256, gpg symmetric, key from PASSPHRASE_FILE)
# while it is still in the pipeline, so no plaintext dump or archive is written
# to disk or uploaded. Without a passphrase nothing is written at all.
if [[ ! -s "${PASSPHRASE_FILE}" ]]; then
  echo "ERROR: backup passphrase file missing or empty: ${PASSPHRASE_FILE}" >&2
  echo "ERROR: refusing to write or upload unencrypted backups" >&2
  exit 1
fi
# The key must not sit beside the archives it protects.
case "$(realpath -m "${PASSPHRASE_FILE}")" in
  "$(realpath -m "${BACKUP_DIR}")"/*)
    echo "ERROR: passphrase file must not live inside the backup directory" >&2
    exit 1 ;;
esac

# Remove partial output from this run if it stops mid-write. Finished artifacts
# (renamed out of .partial) are never removed here.
trap 'rm -f -- "${BACKUP_DIR}/ai_fsm_"*"${TIMESTAMP}"*.partial' EXIT

encrypt_stdin_to() {
  local out="$1"
  gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
    --passphrase-file "${PASSPHRASE_FILE}" -o "${out}.partial"
  mv -f -- "${out}.partial" "${out}"
}

docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom --compress=9 \
  | encrypt_stdin_to "${DB_FILE}"
echo "backup written (encrypted): ${DB_FILE}"

# Uploaded files (receipts, job photos) — not covered by the DB dump
if [[ -d "${DATA_ROOT}/uploads" ]]; then
  tar -czf - -C "${DATA_ROOT}" uploads | encrypt_stdin_to "${UPLOADS_FILE}"
  echo "backup written (encrypted): ${UPLOADS_FILE}"
else
  UPLOADS_FILE=""
  echo "WARNING: ${DATA_ROOT}/uploads not found; skipping uploads backup" >&2
fi

# Encrypted copy of .env — needed to decrypt APP_ENCRYPTION_KEY-protected data
# (e.g. Square tokens) after a restore. Keep the passphrase file itself out of
# git and out of this backup (chmod 600, store its value in a password manager).
encrypt_stdin_to "${ENV_FILE_BACKUP}" < "${ENV_FILE}"
echo "backup written (encrypted): ${ENV_FILE_BACKUP}"

# SHA-256 of every encrypted artifact in this set, for integrity checks before restore.
SET_FILES=("$(basename "${DB_FILE}")")
if [[ -n "${UPLOADS_FILE}" ]]; then
  SET_FILES+=("$(basename "${UPLOADS_FILE}")")
fi
SET_FILES+=("$(basename "${ENV_FILE_BACKUP}")")
(cd "${BACKUP_DIR}" && sha256sum -- "${SET_FILES[@]}" > "$(basename "${MANIFEST_FILE}")")
echo "checksums written: ${MANIFEST_FILE}"

# Offsite copy to Google Drive (non-fatal — pruning must still run)
RCLONE_REMOTE="${FSM_RCLONE_REMOTE:-googledrive}"
RCLONE_DEST="${RCLONE_REMOTE}:ai-fsm-backups"
for f in "${DB_FILE}" "${UPLOADS_FILE}" "${ENV_FILE_BACKUP}" "${MANIFEST_FILE}"; do
  [[ -z "${f}" ]] && continue
  if rclone copy "${f}" "${RCLONE_DEST}/" --log-level INFO; then
    echo "offsite copy complete: ${RCLONE_DEST}/$(basename "${f}")"
  else
    echo "WARNING: offsite copy failed for $(basename "${f}") (rclone exit $?); local backup retained" >&2
  fi
done

# Prune local backups older than 7 days (runs regardless of offsite result).
# Legacy unencrypted patterns are kept so old plaintext files still age out.
find "${BACKUP_DIR}" \( -name "ai_fsm_*.dump" -o -name "ai_fsm_uploads_*.tar.gz" \
  -o -name "ai_fsm_*.dump.gpg" -o -name "ai_fsm_uploads_*.tar.gz.gpg" \
  -o -name "ai_fsm_env_*.gpg" -o -name "ai_fsm_*.sha256" \) -mtime +7 -delete
echo "old local backups pruned"

# Prune offsite copies older than 30 days (best-effort; local retention is authoritative)
REMOTE_RETENTION_DAYS="${FSM_BACKUP_REMOTE_RETENTION_DAYS:-30}"
if rclone delete "${RCLONE_DEST}" --min-age "${REMOTE_RETENTION_DAYS}d" --log-level INFO; then
  echo "old offsite backups pruned (older than ${REMOTE_RETENTION_DAYS}d)"
else
  echo "WARNING: offsite prune failed (rclone exit $?)" >&2
fi
