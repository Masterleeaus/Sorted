import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/intake/[token]/IntakeClientForm.tsx","utf8");
test("removing an uploading image keeps track of the in-flight result",()=>{assert.match(code,/removedWhileUploading\.current\.add\(item\.key\)/);});
test("late successful upload of a removed image requests server deletion",()=>{assert.match(code,/removedWhileUploading\.current\.has\(item\.key\)/);assert.match(code,/method: "DELETE"/);});
test("preview URLs are released on individual removal and unmount",()=>{assert.match(code,/URL\.revokeObjectURL\(item\.previewUrl\)/);assert.match(code,/URL\.revokeObjectURL\(p\.previewUrl\)/);});
