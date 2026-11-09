import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const script = resolve("scripts/backup-garonhome.sh");
function executable(path, source) {
  writeFileSync(path, "#!/usr/bin/env bash\nset -euo pipefail\n" + source, { mode: 0o755 });
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sorted-backup-lifecycle-"));
  const bin = join(root, "bin");
  const backups = join(root, "backups");
  const remote = join(root, "offsite");
  const data = join(root, "data");
  const envFile = join(root, "runtime.env");
  const passphrase = join(root, "passphrase");
  for (const dir of [bin, backups, remote, join(data, "uploads")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(data, "uploads", "receipt.txt"), "fixture");
  writeFileSync(envFile, "POSTGRES_DB=fixture_db\nPOSTGRES_USER=fixture_user\n");
  writeFileSync(passphrase, "test-only-passphrase");
  executable(join(bin, "docker"), 'printf "fake pg_dump bytes"');
  // Test double only: this writes plaintext fixture bytes; it is NOT an
  // encryption test. The real script still invokes GPG AES256.
  executable(join(bin, "gpg"), `
out=""
while (( $# )); do
  if [[ "$1" == "-o" ]]; then out="$2"; shift 2; else shift; fi
done
[[ -n "$out" ]] || exit 4
cat > "$out"
`);
  executable(join(bin, "rclone"), `
command="$1"; shift
case "$command" in
  copy)
    [[ "${MOCK_RCLONE_FAIL_COPY:-0}" != "1" ]] || exit 7
    cp -- "$1" "${MOCK_REMOTE_DIR}/"
    ;;
  lsf)
    for file in "${MOCK_REMOTE_DIR}"/*; do
      [[ -f "$file" ]] || continue
      printf '%s;%s\\n' "$(stat -c %s "$file")" "$(basename "$file")"
    done
    ;;
  delete) ;;
  *) exit 9 ;;
esac
`);
  const environment = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    FSM_ENV_FILE: envFile,
    FSM_BACKUP_DIR: backups,
    FSM_DEPLOY_ROOT: root,
    FSM_DATA_ROOT: data,
    FSM_BACKUP_PASSPHRASE_FILE: passphrase,
    MOCK_REMOTE_DIR: remote,
  };
  return {
    root, backups, remote, environment,
    run(extra = {}) {
      return spawnSync("bash", [script], { encoding: "utf8", env: { ...environment, ...extra }, timeout: 15_000 });
    },
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}
function oldArtifact(backups, timestamp, verified) {
  const filename = `ai_fsm_${timestamp}.dump.gpg`;
  const path = join(backups, filename);
  writeFileSync(path, "historical");
  const date = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  utimesSync(path, date, date);
  if (verified) writeFileSync(join(backups, "status", `verified-${timestamp}`), "");
  return path;
}
test("success verifies a complete offsite set and prunes only individually verified old sets", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.backups, "status"), { recursive: true });
    const unverified = oldArtifact(f.backups, "20260101T010101Z", false);
    const verified = oldArtifact(f.backups, "20260102T010101Z", true);
    const run = f.run();
    assert.equal(run.status, 0, run.stderr);
    assert.equal(existsSync(unverified), true, "unverified old set must be retained");
    assert.equal(existsSync(verified), false, "verified old set may be pruned");
    const report = JSON.parse(readFileSync(join(f.backups, "status", "last-success.json"), "utf8"));
    assert.equal(report.status, "ok");
    assert.equal(report.artifacts.length, 3);
    assert.equal(readdirSync(f.remote).length, 4, "three encrypted objects plus manifest");
  } finally { f.cleanup(); }
});
test("failed offsite copies emit INCOMPLETE and never prune historical verified or unverified files", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.backups, "status"), { recursive: true });
    const unverified = oldArtifact(f.backups, "20260101T010101Z", false);
    const verified = oldArtifact(f.backups, "20260102T010101Z", true);
    const run = f.run({ MOCK_RCLONE_FAIL_COPY: "1" });
    assert.equal(run.status, 1, run.stderr);
    assert.equal(existsSync(unverified), true);
    assert.equal(existsSync(verified), true);
    const last = JSON.parse(readFileSync(join(f.backups, "status", "last-run.json"), "utf8"));
    assert.equal(last.status, "incomplete");
    assert.equal(existsSync(join(f.backups, "status", "INCOMPLETE")), true);
  } finally { f.cleanup(); }
});
test("missing uploads reports incomplete and does not claim last-success", () => {
  const f = fixture();
  try {
    rmSync(join(f.root, "data", "uploads"), { recursive: true });
    const run = f.run();
    assert.equal(run.status, 1);
    assert.equal(existsSync(join(f.backups, "status", "last-success.json")), false);
    const report = JSON.parse(readFileSync(join(f.backups, "status", "last-run.json"), "utf8"));
    assert.match(report.failures.join(" "), /uploads directory missing/);
  } finally { f.cleanup(); }
});
