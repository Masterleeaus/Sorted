import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const adapter=fs.readFileSync(new URL("../src/titan-builder/preview-adapter.ts",import.meta.url),"utf8");
const preview=fs.readFileSync(new URL("../src/titan-builder/preview-data.ts",import.meta.url),"utf8");
const studio=fs.readFileSync(new URL("../../../apps/web/app/app/builder/BuilderStudio.tsx",import.meta.url),"utf8");
test("runtime DTO adapter is company, surface and source bound",()=>{assert.match(adapter,/runtime\.company_id!==input\.company_id/);assert.match(adapter,/runtime\.surface!==input\.surface/);assert.match(adapter,/runtime\.source!==input\.source/);});
test("runtime DTO adapter allowlists source fields and strips secret-shaped fields",()=>{assert.match(adapter,/allowed\.has\(key\)/);assert.match(adapter,/api\[_-\]\?key\|secret\|password\|token/);assert.match(adapter,/records\.slice\(0,6\)/);});
test("preview prefers runtime records and falls back to synthetic",()=>{assert.match(preview,/runtime\?\.records\?\?createBuilderPreviewRecords/);assert.match(preview,/mode:runtime\?\.mode\?\?"synthetic"/);assert.match(preview,/authority_granted:false/);});
test("studio can receive runtime previews without persisting them into Builder document",()=>{assert.match(studio,/runtimePreviews\?:readonly BuilderRuntimePreviewEnvelope\[\]/);assert.match(studio,/previewBuilderNodeProps\(surface,node\.type/);assert.doesNotMatch(studio,/runtimePreviews.*n\.props=/);});
