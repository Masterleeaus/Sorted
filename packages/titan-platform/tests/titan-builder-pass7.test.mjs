import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
const ui=fs.readFileSync(new URL('../../../apps/web/app/app/builder/BuilderStudio.tsx', import.meta.url),'utf8');
test('pass7 exposes governed action and data-source inspectors',()=>{assert.match(ui,/actions/);assert.match(ui,/data-sources/);assert.match(ui,/bindCatalogAction/);assert.match(ui,/setDataSource/)});
test('pass7 exposes theme and per-device responsive controls',()=>{assert.match(ui,/applyTheme/);assert.match(ui,/setResponsiveProp/);assert.match(ui,/Responsive width/)});
test('pass7 keeps nested layer tree',()=>assert.match(ui,/Layer tree/));
