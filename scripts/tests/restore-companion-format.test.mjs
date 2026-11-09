import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const restore=readFileSync("scripts/restore-garonhome.sh","utf8");
test("decrypt and parse required uploads archive before any service stop",()=>{
 const begin=restore.indexOf("tar -tzf -");
 const stop=restore.indexOf('stop web worker');
 assert.ok(begin>=0 && stop>begin);
 assert.match(restore,/uploads archive is not a readable compressed tar/);
 assert.match(restore,/gpg --batch --quiet --decrypt/);
});
test("encrypted environment contents checked before destructive operation",()=>{
 const env=restore.indexOf("grep '^POSTGRES_PASSWORD='");
 const stop=restore.indexOf('stop web worker');
 assert.ok(env>0 && env<stop);
 assert.match(restore,/encrypted environment backup does not contain PostgreSQL credentials/);
});
