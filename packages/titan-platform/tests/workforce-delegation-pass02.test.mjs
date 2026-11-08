import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTitanDelegationEnvelopeCompany,
  deriveTitanDelegationOperationIdentity,
  normalizeTitanDelegationTaskEnvelope,
} from '../.test-dist/workforce-delegation/index.js';

const base = {
  company_id: 'company-a',
  delegation_id: 'delegation-2',
  objective: 'Prepare a governed quote handoff',
  inputs: { lead_ref: 'lead-1' },
  authority_ceiling: 'PROPOSE',
  priority: 'HIGH',
  due_at: '2026-09-13T05:00:00+10:00',
  idempotency_key: 'idem-2',
  causality: { correlation_id: 'corr-2', source_event_id: 'evt-2' },
  expected_outcome: { description: 'Quote handoff proposal ready for approval', evidence_required: ['lead_ref', 'service_ref', 'lead_ref'] },
};

test('normalizes a typed authority-neutral delegation envelope', () => {
  const envelope = normalizeTitanDelegationTaskEnvelope(base);
  assert.equal(envelope.schema, 'titan.workforce.delegation-task-envelope.v1');
  assert.equal(envelope.company_id, 'company-a');
  assert.equal(envelope.authority_ceiling, 'PROPOSE');
  assert.equal(envelope.priority, 'HIGH');
  assert.equal(envelope.causality.root_delegation_id, 'delegation-2');
  assert.deepEqual(envelope.expected_outcome.evidence_required, ['lead_ref', 'service_ref']);
  assert.equal(envelope.authority_effect, false);
  assert.equal(envelope.grants_authority, false);
  assert.equal(envelope.execution_permitted, false);
});

test('requires objective, idempotency, correlation and expected outcome', () => {
  for (const [key, mutate, pattern] of [
    ['objective', (x) => ({ ...x, objective: '' }), /objective-required/],
    ['idempotency', (x) => ({ ...x, idempotency_key: '' }), /idempotency-key-required/],
    ['correlation', (x) => ({ ...x, causality: {} }), /correlation-id-required/],
    ['outcome', (x) => ({ ...x, expected_outcome: {} }), /expected-outcome-required/],
  ]) {
    assert.throws(() => normalizeTitanDelegationTaskEnvelope(mutate(base)), pattern, key);
  }
});

test('fails closed on invalid ceiling, priority, due time and parent self-reference', () => {
  assert.throws(() => normalizeTitanDelegationTaskEnvelope({ ...base, authority_ceiling: 'ROOT' }), /authority-ceiling-invalid/);
  assert.throws(() => normalizeTitanDelegationTaskEnvelope({ ...base, priority: 'NOW' }), /priority-invalid/);
  assert.throws(() => normalizeTitanDelegationTaskEnvelope({ ...base, due_at: 'tomorrow-ish' }), /due-at-invalid/);
  assert.throws(() => normalizeTitanDelegationTaskEnvelope({ ...base, causality: { correlation_id: 'c', parent_delegation_id: 'delegation-2' } }), /parent-self-reference/);
});

test('company binding rejects cross-company envelope reuse', () => {
  assert.equal(assertTitanDelegationEnvelopeCompany(base, 'company-a').company_id, 'company-a');
  assert.throws(() => assertTitanDelegationEnvelopeCompany(base, 'company-b'), /company-mismatch/);
});

test('derives existing operation identity without granting authority', () => {
  const identity = deriveTitanDelegationOperationIdentity(base);
  assert.deepEqual(identity, {
    company_id: 'company-a',
    operation_id: 'delegation-2',
    correlation_id: 'corr-2',
    idempotency_key: 'idem-2',
    authority_ceiling: 'PROPOSE',
    grants_authority: false,
  });
});
