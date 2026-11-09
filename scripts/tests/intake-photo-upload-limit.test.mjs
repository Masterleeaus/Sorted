import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/route.ts","utf8");
test("public photo upload uses bounded multipart parser",()=>{assert.match(code,/readMultipartWithLimit\(request, UPLOAD_BODY_LIMITS\.intakePhoto\)/);});
test("one and only one multipart file field is accepted",()=>{assert.match(code,/formData\.getAll\("file"\)\.length !== 1/);assert.match(code,/Upload exactly one photo per request/);});
test("server enforces count of attachments while invite is locked",()=>{assert.match(code,/count\(\*\)::int AS n FROM intake_media/);assert.match(code,/MAX_INTAKE_PHOTOS/);});
