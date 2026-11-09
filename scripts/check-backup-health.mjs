#!/usr/bin/env node
/**
 * Read-only monitoring gate for encrypted backup health.
 * Does not access credentials, rclone, or the database.
 *
 * Usage: node scripts/check-backup-health.mjs [backup-dir] [maximum-age-hours]
 * Exit 0 = healthy, 1 = missing/failed/stale/malformed report.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function evaluateBackupHealth(backupDir, maxAgeHours = 26, now = Date.now()) {
  const statusDir = join(backupDir, "status");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    return { ok: false, reason: "invalid maximum age" };
  }
  if (existsSync(join(statusDir, "INCOMPLETE"))) {
    return { ok: false, reason: "latest run is incomplete" };
  }
  let latest, successful;
  try {
    latest = JSON.parse(readFileSync(join(statusDir, "last-run.json"), "utf8"));
    successful = JSON.parse(readFileSync(join(statusDir, "last-success.json"), "utf8"));
  } catch {
    return { ok: false, reason: "backup status reports missing or malformed" };
  }
  if (latest?.status !== "ok" || successful?.status !== "ok") {
    return { ok: false, reason: "no verified successful backup" };
  }
  if (latest.set !== successful.set || !/^[0-9]{8}T[0-9]{6}Z$/.test(successful.set ?? "")) {
    return { ok: false, reason: "most recent run does not match verified backup" };
  }
  if (successful.offsite?.verified !== true || successful.offsite?.verification !== "sha256-readback") {
    return { ok: false, reason: "offsite verification not recorded" };
  }
  if (!existsSync(join(statusDir, `verified-${successful.set}`))) {
    return { ok: false, reason: "verified-set marker missing" };
  }
  const expected = [
    `ai_fsm_${successful.set}.dump.gpg`,
    `ai_fsm_uploads_${successful.set}.tar.gz.gpg`,
    `ai_fsm_env_${successful.set}.gpg`,
  ];
  if (!Array.isArray(successful.artifacts) ||
      !expected.every(name => successful.artifacts.some(a =>
        a?.name === name && Number.isSafeInteger(a.bytes) && a.bytes > 0 &&
        typeof a.sha256 === "string" && /^[a-f0-9]{64}$/.test(a.sha256)))) {
    return { ok: false, reason: "verified backup artifact metadata incomplete" };
  }
  const at = Date.parse(successful.completed_at);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > maxAgeHours * 3_600_000) {
    return { ok: false, reason: "last verified backup is stale or invalid" };
  }
  return { ok: true, set: successful.set, ageHours: Math.round((now - at) / 3_600_000 * 10) / 10 };
}

if (process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href) {
  const backupDir = process.argv[2] || process.env.FSM_BACKUP_DIR || "/opt/business/ai-fsm/backups";
  const hours = process.argv[3] === undefined ? 26 : Number(process.argv[3]);
  const result = evaluateBackupHealth(backupDir, hours);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
