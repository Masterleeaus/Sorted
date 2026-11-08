import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const studio=fs.readFileSync(new URL('../../../apps/web/app/app/builder/BuilderStudio.tsx',import.meta.url),'utf8');
const editor=fs.readFileSync(new URL('../../../apps/web/app/app/builder/StructuredPropEditor.tsx',import.meta.url),'utf8');
test('json catalogue props use visual structured editor',()=>{assert.match(studio,/StructuredPropEditor/);assert.doesNotMatch(studio,/control\.kind==="json"\?<textarea/)});
test('visual editor supports add remove reorder',()=>{for(const x of ['+ Add','remove(i)','move(i,-1)','move(i,1)'])assert.ok(editor.includes(x))});
test('covers high value structured props',()=>{for(const x of ['messages','fields','columns','series','tasks','suggestions'])assert.ok(editor.includes(x))});
