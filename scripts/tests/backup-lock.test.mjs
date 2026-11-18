import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "node:test";
const helper=resolve("scripts/lib/backup-run-lock.sh");
function run(dir,body){
  return spawnSync("bash",["-c",'source "$1"; shift; '+body,"_",helper,dir],{encoding:"utf8",timeout:5000});
}
test("a successful lock writes active status and finalizes it explicitly",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-lock-"));
 try{
   const r=run(root,'sorted_backup_lock_start "$1" "20261109T010101Z" "2026-11-09T01:01:01Z"; test -f "$1/ACTIVE"; sorted_backup_lock_finish "$1"; test ! -e "$1/ACTIVE"');
   assert.equal(r.status,0,r.stderr);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("stale ACTIVE marker is not overwritten by a new run",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-lock-"));
 try{
  writeFileSync(join(root,"ACTIVE"),"prior interrupted backup");
  const r=run(root,'sorted_backup_lock_start "$1" "20261109T020202Z" "2026-11-09T02:02:02Z"');
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/stale ACTIVE/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("concurrent holders of advisory lock are rejected without overwriting status",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-lock-")); const ready=join(root,"ready");
 try{
  const script='source "$1"; sorted_backup_lock_start "$2" "20261109T010101Z" "2026-11-09T01:01:01Z"';
  const acquire=run(root,'sorted_backup_lock_start "$1" "20261109T010101Z" "2026-11-09T01:01:01Z"; sorted_backup_lock_finish "$1"');
  assert.equal(acquire.status,0,acquire.stderr);
  // flock is also tested against an independently held kernel lock.
  const locked=spawnSync("flock",["-x",join(root,".backup.lock"),"bash","-c",'source "$1"; sorted_backup_lock_start "$2" "20261109T010101Z" "2026-11-09T01:01:01Z"',"_",helper,root],{encoding:"utf8",timeout:5000});
  assert.notEqual(locked.status,0);
  assert.match(locked.stderr,/another backup/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
