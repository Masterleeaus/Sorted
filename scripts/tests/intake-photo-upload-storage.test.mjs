import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/route.ts","utf8");
test("upload writes under generated invite-scoped location",()=>{assert.match(code,/intakeMediaFilePath\(invite\.id, filename\)/);assert.match(code,/randomUUID\(\)/);});
test("files are created exclusive and private",()=>{assert.match(code,/writePrivateIntakeFile\(filePath, bytes\)/);});
test("failed database commit removes written file",()=>{assert.match(code,/if \(written\)/);assert.match(code,/removePrivateIntakeFile\(filePath\)/);});
