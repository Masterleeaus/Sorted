import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync("scripts/verify-backup-garonhome.sh", "utf8");

test("scratch restore drill requires and verifies all three encrypted artifacts", () => {
  assert.match(script, /mapfile -t manifest_lines/);
  assert.match(script, /manifest_lines\[@\]/);
  assert.match(script, /exactly three artifact checksums/);
  assert.match(script, /sha256sum -c --quiet/);
  assert.match(script, /--exit-on-error/);
});
test("scratch drill cleans temporary plaintext and its disposable database", () => {
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /rm -rf -- "\$\{WORK\}"/);
  assert.match(script, /DROP DATABASE IF EXISTS :"scratch_db"/);
});
test("scratch drill rejects symlinked dump inputs and unsafe archive links",()=>{
 assert.match(script,/\[\[ ! -f "\$\{DUMP_GPG\}" \|\| -L "\$\{DUMP_GPG\}" \]\]/);
 assert.match(script,/sorted_backup_archive_types/);
 assert.match(script,/manual cleanup required/);
});
test("scratch drill refuses nonconforming backup identifiers", () => {
  assert.match(script, /invalid encrypted backup filename or timestamp/);
});
