import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { test } from "node:test";
const script=resolve("scripts/deploy.sh");
test("wrapper forwards a validated branch as data and never runs local Git",()=>{
 const root=mkdtempSync(join(tmpdir(),"sorted-ssh-wrapper-"));const bin=join(root,"bin");mkdirSync(bin);
 const output=join(root,"args");
 writeFileSync(join(bin,"ssh"),'#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$MOCK_SSH_ARGS"\ncat > /dev/null\n',{mode:0o755});
 try{
  const env={...process.env,PATH:bin+":"+process.env.PATH,MOCK_SSH_ARGS:output};
  const ok=spawnSync("bash",[script,"fix/safe-review"],{encoding:"utf8",env,timeout:5000});
  assert.equal(ok.status,0,ok.stderr);
  assert.match(readFileSync(output,"utf8"),/fix\/safe-review/);
  const invalid=spawnSync("bash",[script,"foo;touch /tmp/invalid"],{encoding:"utf8",env,timeout:5000});
  assert.notEqual(invalid.status,0);
  assert.equal(readFileSync(output,"utf8").includes("foo;"),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
