import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/route.ts","utf8");
test("metadata validation runs before reading bytes",()=>{assert.ok(code.indexOf("validateIntakePhotoMeta") < code.indexOf("await file.arrayBuffer()"));});
test("signature mismatch rejects a spoofed content type",()=>{assert.match(code,/sniffIntakePhotoMime\(bytes\)/);assert.match(code,/mime !== file\.type/);assert.match(code,/Photo type does not match its file contents/);});
test("stored extension derives from sniffed MIME, not original filename",()=>{assert.match(code,/INTAKE_PHOTO_EXTENSION\[mime\]/);assert.doesNotMatch(code,/filename = file\.name/);});
