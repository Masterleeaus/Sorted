#!/usr/bin/env bash
# Simulation test for scripts/backup-garonhome.sh, restore-garonhome.sh and
# verify-backup-garonhome.sh. Runs entirely in a temp dir with a fake `docker`
# (pg_dump / pg_restore / psql) and a fake `rclone` backed by a local directory.
# Real gpg and sha256sum are used. Never touches a real deploy root or remote.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="${SCRIPT_DIR}/backup-garonhome.sh"
RESTORE_SH="${SCRIPT_DIR}/restore-garonhome.sh"
VERIFY_SH="${SCRIPT_DIR}/verify-backup-garonhome.sh"

T="$(mktemp -d)"
trap 'rm -rf -- "${T}"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); echo "  PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL: $1"; }
check() { # check "description" command...
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then pass "${desc}"; else fail "${desc}"; fi
}

DEPLOY="${T}/deploy"
BACKUP_DIR="${DEPLOY}/backups"
REMOTE="${T}/remote"
STATE="${T}/state"
BIN="${T}/bin"
VERIFY_TMP="${T}/verify-tmp"
mkdir -p "${DEPLOY}/env" "${DEPLOY}/data/uploads" "${BACKUP_DIR}" "${REMOTE}" "${STATE}" "${BIN}" "${VERIFY_TMP}" "${T}/gnupg"
chmod 700 "${T}/gnupg"
echo "receipt bytes" > "${DEPLOY}/data/uploads/receipt.txt"
printf 'POSTGRES_USER=ai_fsm\nPOSTGRES_DB=ai_fsm\nPOSTGRES_PASSWORD=test-only\n' > "${DEPLOY}/env/.env"
# Throwaway passphrase generated at test time. Never committed.
openssl rand -base64 32 > "${DEPLOY}/env/backup.passphrase"
chmod 600 "${DEPLOY}/env/backup.passphrase"
touch "${T}/compose.yml"

DUMP_MARKER="FAKE-PG-DUMP-PLAINTEXT-MARKER"
UPLOAD_MARKER="receipt bytes"

# Fake docker: only `docker compose ... exec -T postgres <cmd>` is simulated.
cat > "${BIN}/docker" <<'EOF'
#!/usr/bin/env bash
args="$*"
echo "docker $args" >> "${FAKE_STATE}/docker.log"
case "$args" in
  *" pg_dump "*) printf '%s\n' "${FAKE_DUMP_MARKER}" ;;
  *" pg_restore "*)
    cat > "${FAKE_STATE}/restored.bin"
    [[ -z "${FAKE_RESTORE_FAIL:-}" ]] || exit 1 ;;
  *" psql "*)
    cat > /dev/null
    case "$args" in *"count(*)"*) echo 5 ;; esac ;;
  *" ps -q "*) echo fakecontainer ;;
  *" inspect "*) echo healthy ;;
  *) : ;;
esac
EOF

# Fake rclone: remote "googledrive:path" maps to ${FAKE_REMOTE}/path.
cat > "${BIN}/rclone" <<'EOF'
#!/usr/bin/env bash
cmd="$1"; shift
rpath() { local r="${1#*:}"; printf '%s/%s' "${FAKE_REMOTE}" "${r}"; }
echo "rclone ${cmd} $*" >> "${FAKE_STATE}/rclone.log"
case "${cmd}" in
  copy)
    src="$1"; dest="$(rpath "$2")"; mkdir -p "${dest}"
    name="$(basename "${src}")"
    if [[ -n "${FAKE_RCLONE_FAIL:-}" && "${name}" == *"${FAKE_RCLONE_FAIL}"* ]]; then
      echo "fake rclone: simulated copy failure for ${name}" >&2
      exit 5
    fi
    cp -- "${src}" "${dest}/${name}" ;;
  delete)
    find "$(rpath "$1")" -type f -mtime +30 -delete 2>/dev/null || true ;;
esac
EOF
chmod +x "${BIN}/docker" "${BIN}/rclone"

export FSM_DEPLOY_ROOT="${DEPLOY}"
export FSM_ENV_FILE="${DEPLOY}/env/.env"
export FSM_COMPOSE_FILE="${T}/compose.yml"
export FSM_BACKUP_DIR="${BACKUP_DIR}"
export FSM_DATA_ROOT="${DEPLOY}/data"
export FSM_BACKUP_PASSPHRASE_FILE="${DEPLOY}/env/backup.passphrase"
export FSM_VERIFY_TMPDIR="${VERIFY_TMP}"
export FSM_RCLONE_REMOTE="googledrive"
export GNUPGHOME="${T}/gnupg"
export PATH="${BIN}:${PATH}"
export FAKE_STATE="${STATE}" FAKE_REMOTE="${REMOTE}" FAKE_DUMP_MARKER="${DUMP_MARKER}"

list_backup_files() { find "${BACKUP_DIR}" -mindepth 1 -maxdepth 1 -printf "%f\n" | sort; }
count_backup_files() { list_backup_files | wc -l | tr -d ' '; }
set_ts() { list_backup_files | grep '^ai_fsm_[0-9]' | head -1 | sed -E 's/^ai_fsm_(uploads_|env_)?//; s/\.(dump|tar\.gz|gpg|sha256).*$//' | head -1; }
no_plaintext_anywhere() {
  ! grep -rqF -e "${DUMP_MARKER}" -e "${UPLOAD_MARKER}" "${BACKUP_DIR}" "${REMOTE}" 2>/dev/null
}
verify_tmp_empty() { [[ -z "$(ls -A "${VERIFY_TMP}")" ]]; }

echo "== syntax and lint"
check "bash -n backup script" bash -n "${BACKUP_SH}"
check "bash -n restore script" bash -n "${RESTORE_SH}"
check "bash -n verify script" bash -n "${VERIFY_SH}"
if command -v shellcheck >/dev/null 2>&1; then
  check "shellcheck backup script" shellcheck -x "${BACKUP_SH}"
  check "shellcheck restore script" shellcheck -x "${RESTORE_SH}"
  check "shellcheck verify script" shellcheck -x "${VERIFY_SH}"
  check "shellcheck test script" shellcheck -x "$0"
fi

echo "== backup: encrypted happy path"
bash "${BACKUP_SH}" > "${STATE}/backup1.out" 2>&1
check "backup exits 0" test $? -eq 0
TS="$(set_ts)"
check "exactly four artifacts (dump, uploads, env, manifest)" test "$(count_backup_files)" -eq 4
check "dump is encrypted (.dump.gpg)" test -f "${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg"
check "uploads archive is encrypted (.tar.gz.gpg)" test -f "${BACKUP_DIR}/ai_fsm_uploads_${TS}.tar.gz.gpg"
check "env backup present" test -f "${BACKUP_DIR}/ai_fsm_env_${TS}.gpg"
check "no .partial files left" test -z "$(list_backup_files | grep partial || true)"
check "no plaintext dump or uploads on host or remote" no_plaintext_anywhere
check "encrypted dump decrypts to the dump" bash -c \
  "gpg --batch --quiet --decrypt --passphrase-file '${DEPLOY}/env/backup.passphrase' '${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg' | grep -qF '${DUMP_MARKER}'"
check "encrypted uploads decrypt to the uploads tar" bash -c \
  "gpg --batch --quiet --decrypt --passphrase-file '${DEPLOY}/env/backup.passphrase' '${BACKUP_DIR}/ai_fsm_uploads_${TS}.tar.gz.gpg' | tar -tz | grep -q 'uploads/receipt.txt'"
check "sha256 manifest verifies" bash -c "cd '${BACKUP_DIR}' && sha256sum -c --quiet 'ai_fsm_${TS}.sha256'"
check "offsite got the same four files, byte-identical" bash -c \
  "for f in '${BACKUP_DIR}'/ai_fsm_${TS}*; do cmp -s \"\$f\" \"${REMOTE}/ai-fsm-backups/\$(basename \"\$f\")\" || exit 1; done"
check "offsite got no plaintext names" bash -c "! ls '${REMOTE}/ai-fsm-backups' | grep -qE '\.dump$|\.tar\.gz$'"

echo "== backup: refuses to run without a passphrase, and never writes plaintext"
before="$(count_backup_files)"
FSM_BACKUP_PASSPHRASE_FILE="${T}/missing.passphrase" bash "${BACKUP_SH}" > "${STATE}/nopass.out" 2>&1 && rc=0 || rc=$?
check "missing passphrase exits non-zero" test "${rc}" -ne 0
check "missing passphrase creates no artifacts" test "$(count_backup_files)" -eq "${before}"

echo "== backup: key stored beside the archives is refused"
cp "${DEPLOY}/env/backup.passphrase" "${BACKUP_DIR}/key.txt"
before="$(count_backup_files)"
FSM_BACKUP_PASSPHRASE_FILE="${BACKUP_DIR}/key.txt" bash "${BACKUP_SH}" > "${STATE}/beside.out" 2>&1 && rc=0 || rc=$?
check "passphrase inside backup dir exits non-zero" test "${rc}" -ne 0
check "passphrase inside backup dir creates no artifacts" test "$(count_backup_files)" -eq "$((before))"
rm -f -- "${BACKUP_DIR}/key.txt"

echo "== verify: restore drill on the good set"
verify_out="${STATE}/verify1.out"
bash "${VERIFY_SH}" "${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg" > "${verify_out}" 2>&1 && rc=0 || rc=$?
check "verify exits 0" test "${rc}" -eq 0
check "verify reports OK" grep -q 'VERIFY OK' "${verify_out}"
check "verify restored the decrypted dump into the scratch db" bash -c \
  "grep -qF '${DUMP_MARKER}' '${STATE}/restored.bin'"
check "verify left no plaintext in its work dir" verify_tmp_empty
check "verify dropped its scratch database" grep -q 'DROP DATABASE IF EXISTS ai_fsm_verify_' "${STATE}/docker.log"

echo "== verify: failure during restore still removes plaintext (trap)"
rm -f -- "${STATE}/restored.bin"
FAKE_RESTORE_FAIL=1 bash "${VERIFY_SH}" "${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg" > "${STATE}/verify2.out" 2>&1 && rc=0 || rc=$?
check "verify exits non-zero when restore fails" test "${rc}" -ne 0
check "verify reports FAILED" grep -q 'VERIFY FAILED' "${STATE}/verify2.out"
check "failed verify still leaves no plaintext in work dir" verify_tmp_empty

echo "== verify: tampered encrypted artifact is rejected before decrypting"
cp "${BACKUP_DIR}/ai_fsm_uploads_${TS}.tar.gz.gpg" "${T}/uploads.bak"
printf 'x' >> "${BACKUP_DIR}/ai_fsm_uploads_${TS}.tar.gz.gpg"
bash "${VERIFY_SH}" "${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg" > "${STATE}/verify3.out" 2>&1 && rc=0 || rc=$?
check "tampered uploads fail verification" test "${rc}" -ne 0
check "tampered run leaves no plaintext in work dir" verify_tmp_empty
cp "${T}/uploads.bak" "${BACKUP_DIR}/ai_fsm_uploads_${TS}.tar.gz.gpg"

echo "== restore: encrypted dump streams into pg_restore"
rm -f -- "${STATE}/restored.bin"
bash "${RESTORE_SH}" "${BACKUP_DIR}/ai_fsm_${TS}.dump.gpg" > "${STATE}/restore.out" 2>&1 && rc=0 || rc=$?
check "restore exits 0" test "${rc}" -eq 0
check "restore fed the decrypted dump to pg_restore" bash -c "grep -qF '${DUMP_MARKER}' '${STATE}/restored.bin'"
check "restore leaves no plaintext on host or remote" no_plaintext_anywhere

echo
echo "RESULT: ${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]]
