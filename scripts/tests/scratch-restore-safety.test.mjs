import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const verify=readFileSync("scripts/verify-backup-garonhome.sh","utf8");
test("scratch database creation and cleanup quote psql identifiers",()=>{
 assert.match(verify,/CREATE DATABASE :"scratch_db"/);
 assert.match(verify,/DROP DATABASE IF EXISTS :"scratch_db"/);
 assert.doesNotMatch(verify,/DROP DATABASE IF EXISTS \$\{SCRATCH_DB\};/);
 assert.doesNotMatch(verify,/CREATE DATABASE \$\{SCRATCH_DB\};/);
});
test("scratch restore never treats traversal and absolute paths as safe uploads",()=>{
 assert.match(verify,/uploads archive contains unsafe traversal or absolute paths/);
 assert.match(verify,/uploads\.entries/);
 assert.match(verify,/tar -tzf/);
});
test("scratch cleanup retains trap on both success and failure",()=>{
 assert.match(verify,/trap cleanup EXIT/);
 assert.match(verify,/rm -rf -- "\$\{WORK\}"/);
});
