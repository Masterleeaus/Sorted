import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
const script=resolve("scripts/backup-garonhome.sh");
function run(extra) {
  const root=mkdtempSync(join(tmpdir(),"sorted-backup-config-"));
  const backups=join(root,"backups");
  const envFile=join(root,"runtime.env");
  mkdirSync(backups);
  writeFileSync(envFile,"POSTGRES_USER=test\nPOSTGRES_DB=test\n");
  try {
    const result=spawnSync("bash",[script],{encoding:"utf8",timeout:5000,
      env:{...process.env,FSM_DEPLOY_ROOT:root,FSM_BACKUP_DIR:backups,
        FSM_ENV_FILE:envFile,...extra}});
    assert.equal(result.status,1,result.stderr);
    assert.ok(existsSync(join(backups,"status","INCOMPLETE")));
    const last=JSON.parse(readFileSync(join(backups,"status","last-run.json"),"utf8"));
    assert.equal(last.status,"incomplete");
    return { last, stderr:result.stderr };
  } finally { rmSync(root,{recursive:true,force:true}); }
}
test("invalid rclone remote leaves an explicit incomplete status",()=>{
 const result=run({FSM_RCLONE_REMOTE:"remote:/other"});
 assert.match(result.last.failures.join(" "),/unsafe offsite/);
});
test("invalid copy timeout leaves an explicit incomplete status",()=>{
 const result=run({FSM_BACKUP_REMOTE_COPY_TIMEOUT_SEC:"-10"});
 assert.match(result.last.failures.join(" "),/copy timeout/);
});
test("invalid read timeout leaves an explicit incomplete status",()=>{
 const result=run({FSM_BACKUP_REMOTE_READ_TIMEOUT_SEC:"999999"});
 assert.match(result.last.failures.join(" "),/read timeout/);
});
