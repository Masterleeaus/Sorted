import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
const code=readFileSync("apps/web/app/api/intake/[token]/media/[mediaId]/route.ts","utf8");
test("both rate limits are applied prior to database access",()=>{assert.ok(code.indexOf("INTAKE_MEDIA_IP_RATE_LIMIT")<code.indexOf("getPool()"));assert.ok(code.indexOf("INTAKE_MEDIA_TOKEN_RATE_LIMIT")<code.indexOf("getPool()"));});
test("malformed media IDs fail without querying the database",()=>{assert.match(code,/UUID_RE\.test\(mediaId\)/);assert.match(code,/Photo not found/);});
test("only the current invite can resolve an uploaded filename",()=>{assert.match(code,/resolveOpenInvite\(pool, token\)/);assert.match(code,/intakeMediaFilePath\(invite\.id, filename\)/);});
