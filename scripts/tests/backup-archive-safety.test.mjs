import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
const source=resolve("scripts/lib/backup-archive-safety.sh");
function run(command,input="") {
  return spawnSync("bash",["-c",'source "$1"; '+command,"_",source],
    {encoding:"utf8",input,timeout:5000});
}
test("regular files and directories are the only permitted archive member types",()=>{
  assert.equal(run("sorted_backup_archive_types","drwxr-xr-x root/root 0 uploads/\n-rw-r--r-- root/root 5 uploads/a.jpg\n").status,0);
  for(const type of ["l","h","c","b","p","s"]) {
    const x=run("sorted_backup_archive_types",type+"rwxrwxrwx user/group 1 uploads/link\n");
    assert.equal(x.status,1,type);
    assert.match(x.stderr,/unsafe uploads archive entry type/);
  }
});
test("archive type verification fails on empty input",()=>{
  const x=run("sorted_backup_archive_types");
  assert.equal(x.status,1);
  assert.match(x.stderr,/no member types/);
});
test("source upload tree rejects symlinked files and roots",()=>{
  const root=mkdtempSync(join(tmpdir(),"sorted-symlink-audit-"));
  try{
    const uploads=join(root,"uploads"); mkdirSync(uploads);
    writeFileSync(join(uploads,"receipt.txt"),"safe");
    let x=run('sorted_backup_no_source_links "$2"'); // no path: fail
    assert.equal(x.status,1);
    const exec=(target)=>spawnSync("bash",["-c",'source "$1"; sorted_backup_no_source_links "$2"',"·",source,target],{encoding:"utf8",timeout:5000});
    assert.equal(exec(uploads).status,0);
    symlinkSync("/etc/passwd",join(uploads,"external"));
    x=exec(uploads);assert.equal(x.status,1);assert.match(x.stderr,/symlink/);
    x=exec(join(uploads,"external"));assert.equal(x.status,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});
