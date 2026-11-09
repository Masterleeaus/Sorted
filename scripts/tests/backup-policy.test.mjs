import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
const helper=resolve("scripts/lib/backup-policy.sh");
const invoke=(command,args=[],input="")=>spawnSync("bash",["-c",'source "$1"; shift; '+command,"_",helper,...args],
 {encoding:"utf8",input,timeout:5000});
test("remote is a named rclone destination, never a path or flag",()=>{
  for(const remote of ["googledrive","remote_1","backup-host"]) assert.equal(invoke('sorted_backup_remote "$1"',[remote]).status,0,remote);
  for(const remote of ["","../secrets","local:/etc","x/y","-R","hello world","a:b","/"]) assert.notEqual(invoke('sorted_backup_remote "$1"',[remote]).status,0,remote);
});
test("remote transfer timeouts are finite and explicitly bounded",()=>{
  for(const n of ["5","300","900","3600"]) assert.equal(invoke('sorted_backup_timeout "$1"',[n]).status,0,n);
  for(const n of ["0","1","3601","-1","garbage",""]) assert.notEqual(invoke('sorted_backup_timeout "$1"',[n]).status,0,n);
});
test("destructive restore confirmation must equal exact database name",()=>{
  assert.equal(invoke('sorted_restore_confirm "$1" "$2"',["ai_fsm","ai_fsm"]).status,0);
  assert.notEqual(invoke('sorted_restore_confirm "$1" "$2"',["ai_fsm",""]).status,0);
  assert.notEqual(invoke('sorted_restore_confirm "$1" "$2"',["ai_fsm","postgres"]).status,0);
});
test("only names below uploads/ may occur in an archive",()=>{
  const valid="uploads/\nuploads/receipt.png\nuploads/2026/job-1.jpg\n";
  assert.equal(invoke("sorted_backup_archive_entries",[],valid).status,0);
  for(const entry of ["/etc/passwd","../escape","uploads/../../etc","uploads/foo/../bar","etc/shadow","uploads\\file",""]) {
    const r=invoke("sorted_backup_archive_entries",[],entry+"\n");
    assert.notEqual(r.status,0,entry);
  }
});
