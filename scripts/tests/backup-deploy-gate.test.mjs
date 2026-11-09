import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { test } from "node:test";
const checker=resolve("scripts/check-backup-health.mjs");
test("predeploy backup gate fails when no verified backup has ever been recorded",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-empty-backup-"));
 try{
  const run=spawnSync(process.execPath,[checker,root,"26"],{encoding:"utf8",timeout:5000});
  assert.equal(run.status,1);
  assert.match(run.stdout,/"ok":false/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("predeploy backup gate rejects invalid time windows",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-age-backup-"));
 try{
  const run=spawnSync(process.execPath,[checker,root,"0"],{encoding:"utf8",timeout:5000});
  assert.equal(run.status,1);
  assert.match(run.stdout,/invalid maximum age/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
