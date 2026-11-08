import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";
const root=path.resolve(process.cwd());
const route=fs.readFileSync(path.join(root,"../../apps/web/app/api/v1/titan/builder/route.ts"),"utf8");
const server=fs.readFileSync(path.join(root,"../../apps/web/lib/titan/builder-projection-executors.ts"),"utf8");
const studio=fs.readFileSync(path.join(root,"../../apps/web/app/app/builder/BuilderStudio.tsx"),"utf8");
test("preview route installs server capability-owned provider",()=>{assert.match(route,/projectionProvider: createServerBuilderProjectionProvider\(\)/);assert.doesNotMatch(route,/runtimePreviews\s*:\s*body/)});
test("server projection executor is company scoped and read only",()=>{assert.match(server,/account_id=\$1|account_id = \$1/);assert.match(server,/query\.company_id !== context\.company_id/);assert.match(server,/query\.read_only/);assert.doesNotMatch(server,/INSERT INTO|UPDATE .* SET|DELETE FROM/i)});
test("workcore and titan money stay separate owners",()=>{assert.match(server,/const workcore:/);assert.match(server,/const titanMoney:/);assert.match(server,/createCapabilityOwnedBuilderProjectionProvider\(\{ workcore, titanMoney \}\)/)});
test("studio consumes server runtime previews and clears stale data on edits",()=>{assert.match(studio,/setRuntimePreviews\(Array\.isArray\(j\.runtimePreviews\)/);assert.match(studio,/setRuntimePreviews\(\[\]\)/);assert.match(studio,/companyId\?\?document\.company_id/)});
