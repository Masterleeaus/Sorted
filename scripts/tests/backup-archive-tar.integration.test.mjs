import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
const safety=resolve("scripts/lib/backup-archive-safety.sh");
function inspect(root) {
 const tar=spawnSync("tar",["-czf","-", "-C",root,"uploads"],{encoding:null,timeout:5000});
 assert.equal(tar.status,0,tar.stderr?.toString());
 const listing=spawnSync("tar",["-tvzf","-"],{input:tar.stdout,encoding:"utf8",timeout:5000});
 assert.equal(listing.status,0,listing.stderr);
 return spawnSync("bash",["-c",'source "$1"; sorted_backup_archive_types',"·",safety],
   {input:listing.stdout,encoding:"utf8",timeout:5000});
}
test("real GNU tar fixture with only uploads and regular images passes",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-tar-"));
 try{
   mkdirSync(join(root,"uploads"));
   writeFileSync(join(root,"uploads","image.jpeg"),"image bytes");
   assert.equal(inspect(root).status,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test("real GNU tar fixture containing external symlink fails",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-tar-"));
 try{
   mkdirSync(join(root,"uploads"));
   symlinkSync("/etc/passwd",join(root,"uploads","escape"));
   const result=inspect(root);
   assert.equal(result.status,1);
   assert.match(result.stderr,/unsafe uploads archive entry type/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
