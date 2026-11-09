import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const backup=readFileSync("scripts/backup-garonhome.sh","utf8");
test("all offsite reads and writes have finite configured timeouts",()=>{
 assert.match(backup,/timeout "\$\{COPY_TIMEOUT\}" rclone copy/);
 assert.match(backup,/timeout "\$\{READ_TIMEOUT\}" rclone lsf/);
 assert.match(backup,/timeout "\$\{READ_TIMEOUT\}" rclone cat/);
 assert.match(backup,/sorted_backup_timeout/);
});
test("backup files inherit private permissions and never run a shell alert string",()=>{
 assert.match(backup,/^umask 077$/m);
 assert.match(backup,/sorted_backup_remote/);
 assert.doesNotMatch(backup,/bash -c "\$\{BACKUP_ALERT_CMD\}/);
});
