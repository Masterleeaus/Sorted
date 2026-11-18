import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { test } from "node:test";
const helper=resolve("scripts/lib/deploy-safety.sh");
function check(state){
 const root=mkdtempSync(join(tmpdir(),"sorted-web-ready-"));const bin=join(root,"bin");mkdirSync(bin);
 writeFileSync(join(bin,"docker"),'#!/usr/bin/env bash\nprintf "%s\\n" "$FAKE_DOCKER_STATE"\n',{mode:0o755});
 const run=spawnSync("bash",["-c",'source "$1"; sorted_wait_for_web_health 2 0 fake-container',"_",helper],{
  encoding:"utf8",env:{...process.env,PATH:bin+":"+process.env.PATH,FAKE_DOCKER_STATE:state},timeout:5000
 });
 rmSync(root,{recursive:true,force:true});return run;
}
test("health success returns zero",()=>assert.equal(check("healthy").status,0));
test("missing healthcheck fails explicitly",()=>{const r=check("no-healthcheck");assert.equal(r.status,1);assert.match(r.stderr,/no-healthcheck/);});
test("permanent starting state times out, unhealthy fails immediately",()=>{
 const pending=check("starting");assert.equal(pending.status,1);assert.match(pending.stderr,/timed out/);
 const unhealthy=check("unhealthy");assert.equal(unhealthy.status,1);assert.match(unhealthy.stderr,/unhealthy/);
});
