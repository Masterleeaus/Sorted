#!/usr/bin/env node
/**
 * Read-only check of a recent encrypted backup's local bytes, manifest and
 * success metadata. This is not an offsite read and cannot prove recoverability.
 */
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function auditLocalBackup(backupDir) {
  let report;
  try {
    report = JSON.parse(readFileSync(join(backupDir, "status", "last-success.json"), "utf8"));
  } catch { return { ok: false, reason: "missing or invalid success metadata" }; }
  const set = report?.set;
  if (typeof set !== "string" || !/^\d{8}T\d{6}Z$/.test(set)) {
    return { ok: false, reason: "invalid backup set identifier" };
  }
  const names = [
    `ai_fsm_${set}.dump.gpg`,
    `ai_fsm_uploads_${set}.tar.gz.gpg`,
    `ai_fsm_env_${set}.gpg`,
  ];
  if (!Array.isArray(report.artifacts) || report.artifacts.length !== 3 ||
      names.some(name => report.artifacts.filter(x => x?.name === name).length !== 1)) {
    return { ok: false, reason: "incomplete or duplicated artifact metadata" };
  }
  let manifest;
  try { manifest = readFileSync(join(backupDir, `ai_fsm_${set}.sha256`), "utf8"); }
  catch { return { ok: false, reason: "local SHA-256 manifest unavailable" }; }
  const entries = manifest.trimEnd().split("\n").map(line => {
    const m = /^([0-9a-f]{64})  (ai_fsm_[A-Za-z0-9_.-]+)$/.exec(line);
    return m ? { hash: m[1], name: m[2] } : null;
  });
  if (entries.length !== 3 || entries.some(x => !x) ||
      names.some(name => entries.filter(e => e.name === name).length !== 1)) {
    return { ok: false, reason: "SHA-256 manifest lacks exactly three expected entries" };
  }
  for (const name of names) {
    const metadata = report.artifacts.find(a => a.name === name);
    const expected = entries.find(a => a.name === name).hash;
    if (metadata.sha256 !== expected || !Number.isSafeInteger(metadata.bytes) ||
        metadata.bytes <= 0) {
      return { ok: false, reason: `status/manifest mismatch: ${name}` };
    }
    let stats;
    try {
      const p = join(backupDir, name);
      stats = statSync(p);
      if (!stats.isFile() || stats.size !== metadata.bytes) {
        return { ok: false, reason: `local artifact size mismatch: ${name}` };
      }

    } catch { return { ok: false, reason: `local encrypted artifact missing: ${name}` }; }
    const digest = createHash("sha256");
    try {
      for await (const chunk of createReadStream(join(backupDir, name))) digest.update(chunk);
    } catch { return { ok: false, reason: `local artifact unreadable: ${name}` }; }
    const actual = digest.digest("hex");
    if (actual !== expected) return { ok: false, reason: `local artifact SHA-256 mismatch: ${name}` };
  }
  return { ok: true, set, checked: names.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? process.env.FSM_BACKUP_DIR ?? "/opt/business/ai-fsm/backups";
  const result = await auditLocalBackup(root);
  process.stdout.write(JSON.stringify(result) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
