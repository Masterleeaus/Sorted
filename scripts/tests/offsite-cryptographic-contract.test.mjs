import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const backup=readFileSync("scripts/backup-garonhome.sh","utf8");
const checker=readFileSync("scripts/check-backup-health.mjs","utf8");
test("offsite read-back hashes every uploaded object, including the manifest",()=>{
 const begin=backup.indexOf('for f in "${UPLOAD_LIST[@]}"; do',backup.indexOf("# 5. Verify"));
 const finish=backup.indexOf('if (( ${#FAILURES[@]} == 0 )); then',begin);
 assert.ok(begin>=0 && finish>begin);
 const snippet=backup.slice(begin,finish);
 assert.match(snippet,/rclone cat/);
 assert.match(snippet,/sha256sum/);
 assert.match(snippet,/offsite SHA-256 mismatch/);
 assert.match(snippet,/offsite hash read failed/);
 assert.match(backup,/UPLOAD_LIST=\("\$\{ARTIFACTS\[@\]\}"\)/);
 assert.match(backup,/UPLOAD_LIST\+=\("\$\{MANIFEST_FILE\}"\)/);
});
test("size-only status cannot claim a cryptographically verified backup",()=>{
 assert.match(backup,/"verification": "sha256-readback"/);
 assert.match(checker,/successful\.offsite\?\.verification !== "sha256-readback"/);
});
