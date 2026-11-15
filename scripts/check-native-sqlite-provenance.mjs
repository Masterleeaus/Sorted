#!/usr/bin/env node
/**
 * Read-only provenance diagnostic for the four SQLite migration sources pinned
 * in packages/storage/src/company-native-schema-manifest.ts.
 *
 * This is not a substitute for the integration suite. A missing file is
 * BLOCKED, never synthesized from schema names or test expectations.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PINNED_SQLITE_SOURCES = Object.freeze({
  "db/sqlite/001_canonical.sql": "fde73791fc94d10bb2a5758cb006428cf6ee9d8dca571a65dd30e32e8bdbede9",
  "db/sqlite/005_work_order_completion.sql": "a295984f85fcdb169a0e2ab91d90abaab4b7eac53e868d829a2f97f440b094ee",
  "db/sqlite/company-native/0001_work_orders.sql": "9efd5eafd9af06d0aa0b67b22c064859166956efd9b4d217af611c0e755b3013",
  "db/sqlite/company-native/0002_visit_tasks.sql": "def828afc351554735fdc38615d6b67ad1d90c6195ca0b714ed4194b2db5906c",
});

export function auditPinnedSqliteSources(root) {
  const files = Object.entries(PINNED_SQLITE_SOURCES).map(([path, expected]) => {
    let bytes;
    try {
      bytes = readFileSync(join(root, path));
    } catch (error) {
      return { path, status: "missing", expected, detail: error?.code ?? "unreadable" };
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    return { path, status: actual === expected ? "verified" : "mismatch", expected, actual };
  });
  return { ok: files.every(f => f.status === "verified"), files };
}
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === self) {
  const root = resolve(process.argv[2] ?? new URL("..", import.meta.url).pathname);
  const result = auditPinnedSqliteSources(root);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.ok ? 0 : 1;
}
