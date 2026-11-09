import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/[mediaId]/route.ts","utf8");
test("delete locks active invite before deleting a media row",()=>{const lock=code.indexOf("FOR UPDATE");const del=code.indexOf("DELETE FROM intake_media");assert.ok(lock>0 && del>lock);});
test("deletion rejects already-used or expired invite under lock",()=>{assert.match(code,/used_at IS NULL AND expires_at > now\(\)/);assert.match(code,/ALREADY_USED/);});
test("delete never uses a generic unscoped media identifier",()=>{assert.match(code,/id = \$1 AND intake_invite_id = \$2 AND account_id = \$3/);});

test("photo removal uses a safe private-media deletion helper",()=>{
 assert.match(code,/removePrivateIntakeFile\(filePath\)/);
 assert.match(code,/intakeMediaFilePath\(invite\.id, filename\)/);
 assert.match(code,/logger\.warn\("\[intake media DELETE\] file not removed"/);
});
