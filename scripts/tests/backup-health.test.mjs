import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { evaluateBackupHealth } from "../check-backup-health.mjs";

const set = "20261109T010101Z";
const when = Date.parse("2026-11-09T02:00:00Z");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sorted-backup-health-"));
  const status = join(root, "status");
  mkdirSync(status);
  const artifact = name => ({ name, bytes: 15, sha256: "a".repeat(64) });
  const successful = {
    status: "ok", set, completed_at: new Date(when).toISOString(),
    offsite: { verified: true, verification: "sha256-readback" },
    artifacts: [
      artifact(`ai_fsm_${set}.dump.gpg`),
      artifact(`ai_fsm_uploads_${set}.tar.gz.gpg`),
      artifact(`ai_fsm_env_${set}.gpg`),
    ],
  };
  const latest = { status: "ok", set };
  function save() {
    writeFileSync(join(status, "last-run.json"), JSON.stringify(latest));
    writeFileSync(join(status, "last-success.json"), JSON.stringify(successful));
  }
  writeFileSync(join(status, `verified-${set}`), "");
  save();
  return { root, status, latest, successful, save, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test("complete recent verified set is healthy", () => {
  const f = fixture();
  try {
    assert.equal(evaluateBackupHealth(f.root, 26, when + 60_000).ok, true);
  } finally { f.cleanup(); }
});
test("missing or malformed reports fail closed", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.status, "last-run.json"), "not-json");
    assert.equal(evaluateBackupHealth(f.root, 26, when + 60_000).ok, false);
  } finally { f.cleanup(); }
});
test("stale success fails even when last-run says ok", () => {
  const f = fixture();
  try {
    assert.match(evaluateBackupHealth(f.root, 26, when + 27 * 3_600_000).reason, /stale/);
  } finally { f.cleanup(); }
});
test("an incomplete marker overrides historical success", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.status, "INCOMPLETE"), "failed");
    assert.match(evaluateBackupHealth(f.root, 26, when + 60_000).reason, /incomplete/);
  } finally { f.cleanup(); }
});
test("legacy size-only verification cannot satisfy the cryptographic backup gate", () => {
  const f = fixture();
  try {
    delete f.successful.offsite.verification;
    f.save();
    assert.match(evaluateBackupHealth(f.root, 26, when + 60_000).reason, /offsite verification/);
    f.successful.offsite.verification = "name-size";
    f.save();
    assert.equal(evaluateBackupHealth(f.root, 26, when + 60_000).ok, false);
  } finally { f.cleanup(); }
});
test("success report must contain exactly the three expected encrypted artifacts", () => {
  const f = fixture();
  try {
    f.successful.artifacts.push({ name:"untrusted.dump", bytes:10, sha256:"0".repeat(64) });
    f.save();
    assert.match(evaluateBackupHealth(f.root, 26, when + 60_000).reason, /artifact metadata/);
  } finally { f.cleanup(); }
});
test("wrong set, incomplete metadata, and unverified status fail closed", () => {
  const f = fixture();
  try {
    f.latest.set = "20260101T000000Z";
    f.save();
    assert.equal(evaluateBackupHealth(f.root, 26, when + 60_000).ok, false);
    f.latest.set = set;
    f.successful.artifacts.pop();
    f.save();
    assert.match(evaluateBackupHealth(f.root, 26, when + 60_000).reason, /artifact metadata/);
    f.successful.offsite.verified = false;
    f.save();
    assert.match(evaluateBackupHealth(f.root, 26, when + 60_000).reason, /offsite verification/);
  } finally { f.cleanup(); }
});
