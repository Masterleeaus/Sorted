import test from 'node:test';
import assert from 'node:assert/strict';
import { runTitanDelegationSimulation, runTitanDelegationSimulationSuite } from '../.test-dist/workforce-delegation/index.js';

for (const scenario of ['LEASE_RACE','STALE_LEASE_RECOVERY','DUPLICATE_REQUEST','PARTIAL_FAILURE','AUTHORITY_CONTRACTION']) {
  test(`deterministic simulation ${scenario} preserves safety invariants`, async()=>{
    const result=await runTitanDelegationSimulation({scenario});
    assert.equal(result.invariant_passed,true);
    assert.equal(result.deterministic,true);
    assert.equal(result.side_effect_free,true);
    assert.equal(result.grants_authority,false);
    assert.equal(result.authority_effect,false);
    assert.equal(result.execution_permitted,false);
  });
}

test('suite is deterministic across repeated runs and all scenarios pass',async()=>{
  const a=await runTitanDelegationSimulationSuite();
  const b=await runTitanDelegationSimulationSuite();
  assert.deepEqual(a,b);
  assert.equal(a.scenario_count,5);
  assert.equal(a.passed,true);
});

test('custom company/correlation remain isolated in simulation output',async()=>{
  const envelope={company_id:'co-x',delegation_id:'root-x',objective:'verify',inputs:{},authority_ceiling:'PROPOSE',priority:'NORMAL',idempotency_key:'idem-x',causality:{correlation_id:'corr-x',root_delegation_id:'root-x'},expected_outcome:{description:'verified'}};
  const result=await runTitanDelegationSimulation({scenario:'DUPLICATE_REQUEST',envelope});
  assert.equal(result.company_id,'co-x');
  assert.equal(result.correlation_id,'corr-x');
});
