#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_ROOT="${FSM_DEPLOY_ROOT:-/opt/business/ai-fsm}"
REPO_ROOT="${FSM_REPO_ROOT:-${DEPLOY_ROOT}/repo}"
ENV_FILE="${FSM_ENV_FILE:-${DEPLOY_ROOT}/env/.env}"
COMPOSE_FILE="${FSM_COMPOSE_FILE:-${REPO_ROOT}/infra/compose.garonhome.yml}"
BACKUP_DIR="${FSM_BACKUP_DIR:-${DEPLOY_ROOT}/backups}"
STATUS_DIR="${BACKUP_DIR}/status"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
DB_FILE="${BACKUP_DIR}/ai_fsm_${TIMESTAMP}.dump.gpg"
UPLOADS_FILE="${BACKUP_DIR}/ai_fsm_uploads_${TIMESTAMP}.tar.gz.gpg"
ENV_FILE_BACKUP="${BACKUP_DIR}/ai_fsm_env_${TIMESTAMP}.gpg"
MANIFEST_FILE="${BACKUP_DIR}/ai_fsm_${TIMESTAMP}.sha256"

# Record startup failures before loading configuration. Previously a missing or
# unreadable .env exited under set -e without writing a machine-readable status.
# Monitoring must see the failure even when the alert hook is not configured.
mkdir -p "${STATUS_DIR}"
if [[ ! -f "${ENV_FILE}" || ! -r "${ENV_FILE}" ]]; then
  printf '{"status":"incomplete","set":"%s","finished_at":"%s","failures":["environment file missing or unreadable"]}\n' \
    "${TIMESTAMP}" "${NOW_ISO}" > "${STATUS_DIR}/last-run.json"
  printf 'INCOMPLETE backup set %s: environment file missing or unreadable\n' "${TIMESTAMP}" > "${STATUS_DIR}/INCOMPLETE"
  echo "ERROR: backup configuration unavailable; see ${STATUS_DIR}/last-run.json" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
if ! source "${ENV_FILE}"; then
  set +a
  printf '{"status":"incomplete","set":"%s","finished_at":"%s","failures":["environment file could not be loaded"]}\n' \
    "${TIMESTAMP}" "${NOW_ISO}" > "${STATUS_DIR}/last-run.json"
  printf 'INCOMPLETE backup set %s: environment file could not be loaded\n' "${TIMESTAMP}" > "${STATUS_DIR}/INCOMPLETE"
  echo "ERROR: backup configuration invalid; see ${STATUS_DIR}/last-run.json" >&2
  exit 1
fi
set +a

# Resolve AFTER sourcing .env so FSM_DATA_ROOT / FSM_BACKUP_PASSPHRASE_FILE set
# only in the env file are honored (they would otherwise fall back to defaults
# and silently skip the uploads / encrypted-.env backups).
DATA_ROOT="${FSM_DATA_ROOT:-${DEPLOY_ROOT}/data}"
PASSPHRASE_FILE="${FSM_BACKUP_PASSPHRASE_FILE:-${DEPLOY_ROOT}/env/backup.passphrase}"
RCLONE_REMOTE="${FSM_RCLONE_REMOTE:-googledrive}"
RCLONE_DEST="${RCLONE_REMOTE}:ai-fsm-backups"
REMOTE_RETENTION_DAYS="${FSM_BACKUP_REMOTE_RETENTION_DAYS:-30}"

# ponytail: DB dump and the uploads tar are taken sequentially while web/worker
# stay live, so an upload deleted between the two can leave a dump row whose file
# is missing from the archive. Acceptable for a solo nightly backup run at a
# low-activity hour; upgrade to a coordinated filesystem snapshot only if
# concurrent write volume during the backup window ever makes this real.

FAILURES=()
ARTIFACTS=()   # encrypted artifacts that exist for this set
UPLOAD_LIST=() # what goes offsite: artifacts plus the manifest

# Remove partial output from this run if it stops mid-write. Finished artifacts
# (renamed out of .partial) are never removed here.
trap 'rm -f -- "${BACKUP_DIR}/ai_fsm_"*"${TIMESTAMP}"*.partial' EXIT

record_failure() {
  FAILURES+=("$1")
  echo "ERROR: $1" >&2
}

json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "${s}"
}

# Optional alert hook. Not configured in the repo: set BACKUP_ALERT_CMD in the
# env file to a command that accepts the message as its first argument (for
# example a script that posts to the operator's chat or email service).
alert() {
  local msg="$1"
  if [[ -n "${BACKUP_ALERT_CMD:-}" ]]; then
    bash -c "${BACKUP_ALERT_CMD} \"\$1\"" _ "${msg}" \
      || echo "WARNING: BACKUP_ALERT_CMD failed; alert not delivered" >&2
  else
    echo "ALERT (BACKUP_ALERT_CMD not configured; nothing sent): ${msg}" >&2
  fi
}

write_success_marker() {
  local out="${STATUS_DIR}/last-success.json" first=1 f name size sum
  {
    printf '{\n  "status": "ok",\n  "set": "%s",\n  "completed_at": "%s",\n' "${TIMESTAMP}" "${NOW_ISO}"
    printf '  "offsite": {"remote": "%s", "verified": true, "verification": "sha256-readback"},\n  "artifacts": [\n' "$(json_escape "${RCLONE_DEST}")"
    for f in "${ARTIFACTS[@]}"; do
      name="$(basename "${f}")"
      size="$(stat -c %s "${f}")"
      sum="$(sha256sum "${f}" | cut -d' ' -f1)"
      if (( first == 0 )); then printf ',\n'; fi
      first=0
      printf '    {"name": "%s", "bytes": %s, "sha256": "%s"}' "${name}" "${size}" "${sum}"
    done
    printf '\n  ]\n}\n'
  } > "${out}.tmp"
  mv -f -- "${out}.tmp" "${out}"
}

# Writes the machine-readable status for this run, alerts on an incomplete run,
# and exits. Every exit path goes through here.
finish_run() {
  trap - ERR
  mkdir -p "${STATUS_DIR}"
  if (( ${#FAILURES[@]} == 0 )); then
    write_success_marker
    printf '{"status": "ok", "set": "%s", "finished_at": "%s", "failures": []}\n' \
      "${TIMESTAMP}" "${NOW_ISO}" > "${STATUS_DIR}/last-run.json"
    rm -f -- "${STATUS_DIR}/INCOMPLETE"
    echo "backup set ${TIMESTAMP} complete and verified offsite"
    exit 0
  fi

  local list="" r
  for r in "${FAILURES[@]}"; do
    list+="${list:+, }\"$(json_escape "${r}")\""
  done
  printf '{"status": "incomplete", "set": "%s", "finished_at": "%s", "failures": [%s]}\n' \
    "${TIMESTAMP}" "${NOW_ISO}" "${list}" > "${STATUS_DIR}/last-run.json"
  {
    echo "INCOMPLETE backup set ${TIMESTAMP} at ${NOW_ISO}"
    for r in "${FAILURES[@]}"; do echo "- ${r}"; done
  } > "${STATUS_DIR}/INCOMPLETE"
  alert "backup set ${TIMESTAMP} INCOMPLETE: ${FAILURES[*]}"
  echo "ERROR: backup set ${TIMESTAMP} is INCOMPLETE; see ${STATUS_DIR}" >&2
  exit 1
}

# Invoked through the ERR trap below.
# shellcheck disable=SC2329
on_unexpected_error() {
  record_failure "unexpected error at line $1"
  finish_run
}
trap 'on_unexpected_error ${LINENO}' ERR

# Runs a producer command and encrypts its stdout to OUT. The result is renamed
# into place only if the producer AND gpg both succeed (pipefail), so a failed
# pg_dump or tar never leaves a truncated but valid-looking encrypted file.
encrypt_command_to() {
  local out="$1"
  shift
  local rc=0
  "$@" | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
    --passphrase-file "${PASSPHRASE_FILE}" -o "${out}.partial" || rc=$?
  if (( rc != 0 )); then
    rm -f -- "${out}.partial"
    return "${rc}"
  fi
  mv -f -- "${out}.partial" "${out}"
}

mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

# Every artifact is encrypted (AES-256, gpg symmetric, key from PASSPHRASE_FILE)
# while it is still in the pipeline, so no plaintext dump or archive is written
# to disk or uploaded. Without a passphrase nothing is written at all.
if [[ ! -s "${PASSPHRASE_FILE}" ]]; then
  record_failure "passphrase file missing or empty: ${PASSPHRASE_FILE}; refusing to write or upload unencrypted backups"
  finish_run
fi
# The key must not sit beside the archives it protects.
case "$(realpath -m "${PASSPHRASE_FILE}")" in
  "$(realpath -m "${BACKUP_DIR}")"/*)
    record_failure "passphrase file is inside the backup directory; the key must not sit beside the archives"
    finish_run ;;
esac

# 1. Database dump (required)
if ! encrypt_command_to "${DB_FILE}" \
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom --compress=9; then
  record_failure "database dump failed; no ${DB_FILE}"
else
  echo "backup written (encrypted): ${DB_FILE}"
fi

# 2. Uploaded files (receipts, job photos), not covered by the DB dump (required)
if [[ -d "${DATA_ROOT}/uploads" ]]; then
  if ! encrypt_command_to "${UPLOADS_FILE}" tar -czf - -C "${DATA_ROOT}" uploads; then
    record_failure "uploads archive failed for ${DATA_ROOT}/uploads"
  else
    echo "backup written (encrypted): ${UPLOADS_FILE}"
  fi
else
  record_failure "uploads directory missing: ${DATA_ROOT}/uploads; uploads archive not written"
fi

# 3. Encrypted copy of .env (required). Needed to decrypt APP_ENCRYPTION_KEY-protected
# data (e.g. Square tokens) after a restore. Keep the passphrase file itself out of
# git and out of this backup (chmod 600, store its value in a password manager).
if ! encrypt_command_to "${ENV_FILE_BACKUP}" cat "${ENV_FILE}"; then
  record_failure "encrypted .env backup failed"
else
  echo "backup written (encrypted): ${ENV_FILE_BACKUP}"
fi

for f in "${DB_FILE}" "${UPLOADS_FILE}" "${ENV_FILE_BACKUP}"; do
  if [[ -f "${f}" ]]; then
    ARTIFACTS+=("${f}")
  fi
done

# SHA-256 of every encrypted artifact in this set, for integrity checks before restore.
if (( ${#ARTIFACTS[@]} > 0 )); then
  NAMES=()
  for f in "${ARTIFACTS[@]}"; do NAMES+=("$(basename "${f}")"); done
  (cd "${BACKUP_DIR}" && sha256sum -- "${NAMES[@]}" > "$(basename "${MANIFEST_FILE}")")
  echo "checksums written: ${MANIFEST_FILE}"
fi

# 4. Offsite copy to Google Drive. Failures are recorded, not fatal to the other copies.
UPLOAD_LIST=("${ARTIFACTS[@]}")
if [[ -f "${MANIFEST_FILE}" ]]; then
  UPLOAD_LIST+=("${MANIFEST_FILE}")
fi
for f in "${UPLOAD_LIST[@]}"; do
  if rclone copy "${f}" "${RCLONE_DEST}/" --log-level INFO; then
    echo "offsite copy complete: ${RCLONE_DEST}/$(basename "${f}")"
  else
    record_failure "offsite copy failed for $(basename "${f}")"
  fi
done

# 5. Verify every remote object by reading its bytes back with rclone cat and
# comparing SHA-256 to the original local object. Name+size alone cannot detect
# corruption or an old same-size object left behind after a broken upload.
# This includes the manifest itself. A failed read MUST prevent successful status.
if listing="$(rclone lsf --format sp --separator ';' --files-only "${RCLONE_DEST}" 2>/dev/null)"; then
  for f in "${UPLOAD_LIST[@]}"; do
    name="$(basename "${f}")"
    local_size="$(stat -c %s "${f}")"
    remote_size="$(awk -F';' -v n="${name}" '$2 == n { print $1; exit }' <<<"${listing}")"
    if [[ "${remote_size}" != "${local_size}" ]]; then
      record_failure "offsite verify failed for ${name} (remote size '${remote_size:-missing}', local ${local_size})"
      continue
    fi
    local_sha="$(sha256sum -- "${f}" | cut -d' ' -f1)"
    if ! remote_sha="$(rclone cat "${RCLONE_DEST}/${name}" | sha256sum | cut -d' ' -f1)"; then
      record_failure "offsite hash read failed for ${name}"
    elif [[ "${remote_sha}" != "${local_sha}" ]]; then
      record_failure "offsite SHA-256 mismatch for ${name}"
    fi
  done
else
  record_failure "offsite listing failed; copies could not be verified"
fi

if (( ${#FAILURES[@]} == 0 )); then
  : > "${STATUS_DIR}/verified-${TIMESTAMP}"
  echo "offsite set verified: ${TIMESTAMP}"
fi

# 6. Local prune: only after this run succeeds, and only remove each
# individually verified set after seven days. A newly successful backup does
# NOT attest the safety of a different historical set; incomplete/unverified
# older sets must survive for investigation and possible recovery.
# Legacy plaintext names are matched by the same rule.
while IFS= read -r -d '' f; do
  ts="$(sed -nE 's/^ai_fsm_(uploads_|env_)?([0-9]{8}T[0-9]{6}Z).*/\2/p' <<<"$(basename "${f}")")"
  [[ -n "${ts}" ]] || continue
  if (( ${#FAILURES[@]} == 0 )) && [[ -f "${STATUS_DIR}/verified-${ts}" ]]; then
    rm -f -- "${f}"
  fi
done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name 'ai_fsm_*' -mmin +10080 -print0)
for m in "${STATUS_DIR}"/verified-*; do
  [[ -e "${m}" ]] || continue
  ts="${m##*verified-}"
  if ! find "${BACKUP_DIR}" -maxdepth 1 -type f -name "ai_fsm_*${ts}*" | grep -q .; then
    rm -f -- "${m}"
  fi
done
echo "local backup retention evaluated (only individually verified sets older than 7 days)"

# 7. Offsite retention is deliberately NOT a broad rclone delete.
# Age-only deletion can destroy old but unverified or incomplete recovery sets
# and their companion manifests. Retain remotely until a separate per-set,
# explicitly reviewed retention command exists and has completed restore drills.
echo "offsite prune deferred: no destructive age-only delete is permitted"

finish_run
