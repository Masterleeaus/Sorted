import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapabilityRegistry } from '../.test-dist/ported/titan-capabilities/capability-registry.js';

test('Capability Registry normalizes canonical company_id for scoped modules', () => {
  const records=[{enabled:true,status:'active',manifest:{id:'mod-a',name:'Module A',version:'1.0.0',scope:{company_id:'company-1'},contributes:{capabilities:[{id:'jobs.read'}]}}}];
  const registry=buildCapabilityRegistry(records,{company_id:' company-1 '});
  assert.equal(registry.company_id,'company-1');
  assert.equal(registry.entries.length,1);
  assert.equal(registry.entries[0].company_id,'company-1');
});

test('Capability Registry rejects blank company scope', () => {
  assert.throws(()=>buildCapabilityRegistry([],{company_id:'   '}),/company_id-required/);
});
