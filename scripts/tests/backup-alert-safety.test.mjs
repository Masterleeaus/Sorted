import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const source=readFileSync("scripts/backup-garonhome.sh","utf8");
test("alert hook is invoked as one executable path with separate message argument",()=>{
 assert.match(source,/! "\$\{BACKUP_ALERT_CMD\}" "\$\{msg\}"/);
 assert.match(source,/! -x "\$\{BACKUP_ALERT_CMD\}"/);
 assert.doesNotMatch(source,/bash -c "\$\{BACKUP_ALERT_CMD\}/);
});
test("missing alert hook does not turn incomplete backups into success",()=>{
 assert.match(source,/ALERT \(BACKUP_ALERT_CMD not configured/);
 assert.match(source,/backup set \$\{TIMESTAMP\} is INCOMPLETE/);
 assert.match(source,/exit 1/);
});
