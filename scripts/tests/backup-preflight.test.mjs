import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const backup = resolve("scripts/backup-garonhome.sh");

function runPreflight(envFile) {
  const root = mkdtempSync(join(tmpdir(), "sorted-backup-preflight-"));
  const status = join(root, "backups", "status");
  try {
    const result = spawnSync("bash", [backup], {
      encoding: "utf8",
      env: {
        ...process.env,
        FSM_DEPLOY_ROOT: root,
        FSM_BACKUP_DIR: join(root, "backups"),
        FSM_ENV_FILE: envFile ?? join(root, "missing.env"),
      },
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(existsSync(join(status, "INCOMPLETE")), true);
    const report = JSON.parse(readFileSync(join(status, "last-run.json"), "utf8"));
    assert.equal(report.status, "incomplete");
    assert.equal(report.failures.length, 1);
    assert.match(result.stderr, /backup configuration/);
    return report;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("missing backup environment emits persistent incomplete health", () => {
  const report = runPreflight();
  assert.match(report.failures[0], /missing or unreadable/);
});

test("invalid sourced environment emits persistent incomplete health", () => {
  const root = mkdtempSync(join(tmpdir(), "sorted-invalid-env-"));
  try {
    const file = join(root, "broken.env");
    writeFileSync(file, "return 1\\n");
    const report = runPreflight(file);
    assert.match(report.failures[0], /could not be loaded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
