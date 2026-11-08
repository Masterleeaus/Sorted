import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const p=new URL('../../../apps/web/app/app/builder/StructuredPropEditor.tsx',import.meta.url);const s=fs.readFileSync(p,'utf8');
test('structured editor is component aware',()=>{assert.match(s,/componentType:string/);assert.match(s,/job\|schedule\|booking/);assert.match(s,/inbound.*outbound.*system/)});
test('kanban columns support nested cards',()=>{assert.match(s,/propKey==="columns"/);assert.match(s,/propKey="tasks"/);assert.match(s,/setCards/)});
test('chart values use numeric controls',()=>{assert.match(s,/propKey==="series"\|\|propKey==="data"/);assert.match(s,/kind:"number"/)});
