import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSignal, prioritizeSignals, SIGNAL_POLICY } from '../.test-dist/ported/titan-intelligence/signal/index.js';

test('Signal prioritisation is deterministic and company scoped',()=>{
 const signals=[
  {id:'b',company_id:'company-1',kind:'risk',priority:5,confidence:.8},
  {id:'a',company_id:'company-1',kind:'risk',priority:5,confidence:.8},
  {id:'x',company_id:'company-2',kind:'risk',priority:99,confidence:1},
 ];
 assert.throws(()=>prioritizeSignals(signals,'company-1'),/signal-company-mismatch/);
 const local=signals.filter(s=>s.company_id==='company-1');
 assert.deepEqual(prioritizeSignals(local,'company-1').map(s=>s.id),['a','b']);
});

test('Signal normalization never confers authority',()=>{
 const signal=normalizeSignal({id:'s1',company_id:'company-1',kind:'opportunity'});
 assert.equal(signal.authority_neutral,true);
 assert.equal(signal.execution_authority,false);
 assert.equal(SIGNAL_POLICY.signal_is_authority,false);
 assert.equal(SIGNAL_POLICY.tenant_boundary,'company_id');
});
