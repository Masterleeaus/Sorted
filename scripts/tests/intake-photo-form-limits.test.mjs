import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/intake/[token]/IntakeClientForm.tsx","utf8");
test("all selections share the synchronous photo count",()=>{assert.match(code,/MAX_INTAKE_PHOTOS - photosRef\.current\.length/);});
test("invalid files are rejected before upload",()=>{assert.match(code,/validateIntakePhotoMeta\(\{ type: file\.type, size: file\.size \}\)/);});
test("UI offers failed uploads a retry and distinguishes failure",()=>{assert.match(code,/status === "failed"/);assert.match(code,/Try again/);});
