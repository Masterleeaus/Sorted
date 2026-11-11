import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";
const helper = resolve("scripts/lib/deploy-safety.sh");
const run = (command, args = []) => spawnSync("bash", ["-c", 'source "$1"; shift; '+command, "_", helper, ...args], { encoding:"utf8", timeout:5000 });
test("only simple, slash-separated branch references are valid",()=>{
  for(const name of ["main","fix/backup-123","feature/a_b.c"]) assert.equal(run('sorted_validate_deploy_branch "$1"',[name]).status,0,name);
  for(const name of ["-evil","../main","main;touch /tmp/x","a b","main~1","a//b","a.lock","refs/heads/../main","a/"]) assert.notEqual(run('sorted_validate_deploy_branch "$1"',[name]).status,0,name);
});
test("timeouts reject zero, negative, absurd and nonnumeric attempts",()=>{
  for(const value of ["1","60","300"]) assert.equal(run('sorted_wait_attempts "$1"',[value]).status,0,value);
  for(const value of ["0","-1","301","nan","1e4",""]) assert.notEqual(run('sorted_wait_attempts "$1"',[value]).status,0,value);
});
test("wait helper exits after bounded failures and succeeds on readiness",()=>{
  const failed=run('sorted_wait_for_postgres 2 0 bash -c "exit 1"');
  assert.equal(failed.status,1);
  assert.match(failed.stderr,/timed out/);
  assert.equal(run('sorted_wait_for_postgres 2 0 bash -c "exit 0"').status,0);
});
