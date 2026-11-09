import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const restore=readFileSync("scripts/restore-garonhome.sh","utf8");
test("target DB requires an exact explicit operator confirmation before service stops",()=>{
 const approve=restore.indexOf('sorted_restore_confirm "${POSTGRES_DB}"');
 const stop=restore.indexOf('stop web worker');
 const drop=restore.indexOf('DROP DATABASE IF EXISTS');
 assert.ok(approve>0 && approve<stop && stop<drop);
 assert.match(restore,/FSM_RESTORE_CONFIRM_DB/);
});
test("restore web readiness is bounded and requires a healthy container",()=>{
 assert.match(restore,/sorted_wait_for_web_health/);
 assert.match(restore,/FSM_RESTORE_WEB_ATTEMPTS/);
 assert.doesNotMatch(restore,/for _ in \$\(seq 1 30\)/);
});
