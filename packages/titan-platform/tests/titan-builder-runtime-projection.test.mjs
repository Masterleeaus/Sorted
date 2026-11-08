import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const projection=fs.readFileSync(new URL("../src/titan-builder/runtime-projection.ts",import.meta.url),"utf8");
const bridge=fs.readFileSync(new URL("../src/titan-builder/runtime-bridge.ts",import.meta.url),"utf8");
const route=fs.readFileSync(new URL("../../../apps/web/app/api/v1/titan/builder/route.ts",import.meta.url),"utf8");

test("projection requests are company/surface scoped, read-only and authority neutral",()=>{
 assert.match(projection,/company_id:document\.company_id/);
 assert.match(projection,/surface:document\.surface/);
 assert.match(projection,/read_only:true/);
 assert.match(projection,/authority_granted:false/);
 assert.match(projection,/builder_context_company_mismatch/);
 assert.match(projection,/builder_context_surface_mismatch/);
});

test("projection provider results fail closed on boundary mismatch",()=>{
 assert.match(projection,/builder_projection_company_mismatch/);
 assert.match(projection,/builder_projection_surface_mismatch/);
 assert.match(projection,/builder_projection_source_mismatch/);
 assert.match(projection,/if\(!input\.provider\)return Object\.freeze\(\[\]\)/);
});

test("runtime bridge exposes projection requests and synthetic fallback without authority",()=>{
 assert.match(bridge,/previewBuilderWithRuntimeProjections/);
 assert.match(bridge,/runtime_previews/);
 assert.match(bridge,/runtime-with-synthetic-fallback/);
 assert.match(bridge,/authority_granted:false/);
});

test("Builder API obtains projection plan from server runtime handoff rather than client DTO input",()=>{
 assert.match(route,/await previewBuilderWithRuntimeProjections/);
 assert.match(route,/projectionRequests/);
 assert.match(route,/runtimePreviews/);
 assert.match(route,/projectionAuthorityGranted: false/);
 assert.doesNotMatch(route,/runtime_previews\?:/);
});
