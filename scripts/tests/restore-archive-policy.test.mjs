import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const restore=readFileSync("scripts/restore-garonhome.sh","utf8");
const drill=readFileSync("scripts/verify-backup-garonhome.sh","utf8");
test("destructive restore checks a fully listed archive before stopping services",()=>{
 const list=restore.indexOf('tar -tzf - > "${ARCHIVE_ENTRIES}"');
 const check=restore.indexOf('sorted_backup_archive_entries < "${ARCHIVE_ENTRIES}"');
 const stop=restore.indexOf('stop web worker');
 assert.ok(list>0 && check>list && stop>check);
 assert.match(restore,/trap 'rm -f -- "\$\{ARCHIVE_ENTRIES\}"' EXIT/);
});
test("destructive restore and scratch drill reject tar link and special member types",()=>{
 assert.match(restore,/tar -tvzf - \| sorted_backup_archive_types/);
 assert.match(drill,/tar -tvzf "\$\{WORK\}\/uploads\.tar\.gz" \| sorted_backup_archive_types/);
 assert.match(restore,/backup-archive-safety\.sh/);
 assert.match(drill,/backup-archive-safety\.sh/);
});
test("scratch restore shares the exact archive-path policy",()=>{
 assert.match(drill,/source "\$\{SCRIPT_DIR\}\/lib\/backup-policy.sh"/);
 assert.match(drill,/sorted_backup_archive_entries < "\$\{WORK\}\/uploads\.entries"/);
 assert.match(drill,/trap cleanup EXIT/);
});
