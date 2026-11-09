import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/route.ts","utf8");
test("resolve invite before accepting multipart upload",()=>{assert.ok(code.indexOf("const pre = await resolveOpenInvite(pool, token)") < code.indexOf("const multipart = await readMultipartWithLimit"));});
test("token-derived account sets transaction-local session context",()=>{assert.match(code,/set_config\('app\.current_account_id', \$1, true\)/);assert.match(code,/\[invite\.account_id\]/);});
test("invite is rechecked under a row lock",()=>{assert.match(code,/FOR UPDATE/);assert.match(code,/used_at IS NULL AND expires_at > now\(\)/);});
