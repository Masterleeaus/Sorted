import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/route.ts","utf8");
test("photo count is determined by server query",()=>{assert.match(code,/count\(\*\)::int AS n FROM intake_media/);assert.match(code,/photo_count: String\(photoRows\[0\]\?\.n \?\? 0\)/);});
test("photos are linked to the selected request and account within transaction",()=>{assert.match(code,/UPDATE intake_media SET booking_request_id = \$1/);assert.match(code,/WHERE intake_invite_id = \$2 AND account_id = \$3/);});
test("claiming the invite and associating photo records is atomic",()=>{const claim=code.indexOf("UPDATE intake_invites SET used_at");const assoc=code.indexOf("UPDATE intake_media SET booking_request_id");const commit=code.indexOf('client.query("COMMIT")');assert.ok(claim>=0 && assoc>claim && commit>assoc);});
