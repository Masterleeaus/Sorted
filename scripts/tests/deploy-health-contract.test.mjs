import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("scripts/deploy-garonhome.sh","utf8");
test("deploy checks verified backup after code sync and before starting containers",()=>{
 const check=code.indexOf('node "${REPO_ROOT}/scripts/check-backup-health.mjs"');
 assert.ok(check>code.indexOf("sync_repo\n"));
 assert.ok(check<code.indexOf('up -d postgres'));
 assert.match(code,/deploy blocked: a complete recent verified backup is required/);
});
test("deployment refuses untracked files and unexpected refs before resetting",()=>{
 assert.match(code,/git status --porcelain/);
 assert.match(code,/sorted_validate_deploy_branch/);
 assert.match(code,/git branch "\$\{backup_branch\}" HEAD/);
});
test("deployment bounds both readiness waits and rejects missing healthchecks",()=>{
 assert.match(code,/sorted_wait_for_postgres "\$\{DB_ATTEMPTS\}"/);
 assert.match(code,/sorted_wait_for_web_health "\$\{WEB_ATTEMPTS\}"/);
 assert.doesNotMatch(code,/until \[\[ "\$\(docker inspect/);
});
