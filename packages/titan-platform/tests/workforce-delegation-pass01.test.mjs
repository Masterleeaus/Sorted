import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTitanDelegationPrimitiveMap,
  getTitanDelegationLifecycleContract,
  normalizeTitanDelegationLifecycle,
  canTransitionTitanDelegation,
  transitionTitanDelegationLifecycle,
} from '../.test-dist/workforce-delegation/index.js';

test('pass01 maps existing primitives instead of owning a parallel queue/workflow engine', () => {
  const primitives = getTitanDelegationPrimitiveMap();
  assert.ok(primitives.length >= 10);
  assert.ok(primitives.some((item) => item.id === 'workflow_execution'));
  assert.ok(primitives.some((item) => item.id === 'authority_delegation'));
  assert.ok(primitives.some((item) => item.id === 'operation_identity'));
  const contract = getTitanDelegationLifecycleContract();
  assert.equal(contract.queue_rule, 'reuse_existing_workflow_or_domain_runtime');
  assert.equal(contract.identity_confers_authority, false);
});

test('delegation lifecycle is company-scoped and authority-neutral', () => {
  const record = normalizeTitanDelegationLifecycle({ company_id: 'company-1', delegation_id: 'del-1' });
  assert.equal(record.company_id, 'company-1');
  assert.equal(record.state, 'PROPOSED');
  assert.equal(record.authority_effect, false);
  assert.equal(record.identity_confers_authority, false);
  assert.throws(() => normalizeTitanDelegationLifecycle({ company_id: '', delegation_id: 'del-1' }), /company-id-required/);
});

test('canonical lifecycle permits governed progress and rejects invalid skips', () => {
  assert.equal(canTransitionTitanDelegation('PROPOSED', 'ROUTED'), true);
  assert.equal(canTransitionTitanDelegation('PROPOSED', 'COMPLETED'), false);
  const routed = transitionTitanDelegationLifecycle({ company_id: 'company-1', delegation_id: 'del-1', state: 'PROPOSED' }, 'ROUTED');
  assert.equal(routed.state, 'ROUTED');
  assert.throws(
    () => transitionTitanDelegationLifecycle(routed, 'COMPLETED'),
    /delegation-transition-invalid:ROUTED->COMPLETED/,
  );
});

test('terminal delegation states cannot be revived', () => {
  for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED']) {
    assert.equal(canTransitionTitanDelegation(terminal, 'ROUTED'), false);
  }
});

test('company binding mismatch fails closed during transition', () => {
  assert.throws(
    () => transitionTitanDelegationLifecycle(
      { company_id: 'company-1', delegation_id: 'del-1', state: 'PROPOSED' },
      'ROUTED',
      { company_id: 'company-2' },
    ),
    /delegation-company-mismatch/,
  );
});
