import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs";
const src=fs.readFileSync(new URL("../src/titan-builder/preview-data.ts",import.meta.url),"utf8");
const studio=fs.readFileSync(new URL("../../../apps/web/app/app/builder/BuilderStudio.tsx",import.meta.url),"utf8");
test("preview pipeline is source-contract bounded and always read-only",()=>{assert.match(src,/builderDataSourceOptions\(surface\)/);assert.match(src,/synthetic:!runtime,read_only:true,authority_granted:false/);});
test("preview maps only declared component targets",()=>{assert.match(src,/builderFieldTargets\(componentType\)/);assert.match(src,/allowed\.has\(target\)/);});
test("list components receive mapped preview rows",()=>{assert.match(src,/listLike/);assert.match(src,/items:mapped/);assert.match(src,/data:mapped/);});
test("live canvas consumes mapped preview props",()=>{assert.match(studio,/previewBuilderNodeProps\(surface,node\.type/);assert.match(studio,/surface=\{document\.surface\}/);});
