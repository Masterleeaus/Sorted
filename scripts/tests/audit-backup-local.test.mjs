import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { auditLocalBackup } from "../audit-backup-local.mjs";
const stamp="20261109T010101Z";
const names=[`ai_fsm_${stamp}.dump.gpg`,`ai_fsm_uploads_${stamp}.tar.gz.gpg`,`ai_fsm_env_${stamp}.gpg`];
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"sorted-local-hash-"));
 mkdirSync(join(root,"status"));
 const artifacts=names.map((name,i)=>{
  const bytes=Buffer.from("encrypted-test-only-"+i);
  writeFileSync(join(root,name),bytes);
  return {name,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")};
 });
 const report={status:"ok",set:stamp,offsite:{verified:true,verification:"sha256-readback"},artifacts};
 writeFileSync(join(root,"status","last-success.json"),JSON.stringify(report));
 writeFileSync(join(root,`ai_fsm_${stamp}.sha256`),artifacts.map(a=>a.sha256+"  "+a.name).join("\n")+"\n");
 return {root,artifacts,report,save:()=>writeFileSync(join(root,"status","last-success.json"),JSON.stringify(report)),cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
test("encrypted byte audit matches exactly three manifest entries and status records",()=>{
 const f=fixture();
 try{assert.deepEqual(auditLocalBackup(f.root),{ok:true,set:stamp,checked:3});}finally{f.cleanup();}
});
test("tampering a local encrypted artifact fails closed",()=>{
 const f=fixture();
 try{
  writeFileSync(join(f.root,names[1]),"tampered encrypted payload");
  assert.match(auditLocalBackup(f.root).reason,/size mismatch|SHA-256 mismatch/);
 }finally{f.cleanup();}
});
test("status tampering and absent manifest are rejected",()=>{
 const f=fixture();
 try{
  f.report.artifacts[0].sha256="f".repeat(64);f.save();
  assert.match(auditLocalBackup(f.root).reason,/status\/manifest mismatch/);
  writeFileSync(join(f.root,`ai_fsm_${stamp}.sha256`),"untrusted manifest");
  assert.match(auditLocalBackup(f.root).reason,/SHA-256 manifest/);
 }finally{f.cleanup();}
});
test("duplicated artifact metadata cannot satisfy the audit",()=>{
 const f=fixture();
 try{
  f.report.artifacts.push(f.report.artifacts[0]);f.save();
  assert.match(auditLocalBackup(f.root).reason,/incomplete or duplicated/);
 }finally{f.cleanup();}
});
