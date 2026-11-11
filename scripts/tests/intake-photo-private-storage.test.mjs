import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/lib/intake/media-storage.ts","utf8");
test("photo path is under the server-managed private upload root",()=>{assert.match(code,/path\.join\(UPLOAD_ROOT, "intake"\)/);assert.doesNotMatch(code,/\/public\/uploads/);});
test("invite directory must be UUID-shaped",()=>{assert.match(code,/UUID\.test\(inviteId\)/);});
test("only generated UUID image names may be retrieved or removed",()=>{assert.match(code,/STORED_PHOTO\.test\(filename\)/);assert.match(code,/resolveStoredUpload/);});
