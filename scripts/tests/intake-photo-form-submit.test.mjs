import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/intake/[token]/IntakeClientForm.tsx","utf8");
test("submit is blocked until every selected photo finishes uploading",()=>{assert.match(code,/photosRef\.current\.some\(\(p\) => p\.status !== "done"\)/);});
test("submission does not supply a client-invented photo count",()=>{assert.doesNotMatch(code,/photo_count:\s*photos\.length/);assert.match(code,/fetch\(`\/api\/intake\/\$\{token\}`/);});
test("upload completion updates ref before React render",()=>{assert.match(code,/photosRef\.current = photosRef\.current\.map/);assert.match(code,/setPhotos\(photosRef\.current\)/);});
