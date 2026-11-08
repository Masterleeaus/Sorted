import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTitanNativeWorkforceAgentMap,
  listTitanNativeWorkforceAgentMaps,
  assertTitanNativeWorkforceBoundary,
} from '../.test-dist/workforce-native/index.js';

test('maps exactly the six Merge52 remaining native agents', () => {
  const agents = listTitanNativeWorkforceAgentMaps();
  assert.deepEqual(
    agents.map((agent) => agent.agentKey).sort(),
    ['booking', 'customer_care', 'jobs', 'reception', 'sales', 'scheduling'],
  );
});

test('every agent preserves company_id and identity-not-authority', () => {
  for (const agent of listTitanNativeWorkforceAgentMaps()) {
    assert.equal(agent.companyBoundary, 'company_id');
    assert.equal(agent.identityGrantsAuthority, false);
    assert.equal(agent.canonicalBusinessTruth, 'business_ops');
    assert.ok(agent.donorModules.length > 0);
    assert.ok(agent.operations.length > 0);
  }
});

test('booking conversion and jobs completion reuse canonical Business Ops routes', () => {
  const booking = getTitanNativeWorkforceAgentMap('booking');
  const jobs = getTitanNativeWorkforceAgentMap('jobs');
  assert.ok(booking.operations.some((op) => op.path === '/api/v1/booking-requests/:id/convert'));
  assert.ok(jobs.operations.some((op) => op.path === '/api/v1/work-orders/:id/complete'));
});

test('customer care has read-only billing context and no refund/credit mutation route', () => {
  const care = getTitanNativeWorkforceAgentMap('customer_care');
  const invoice = care.operations.find((op) => op.id === 'invoices.get');
  assert.equal(invoice?.mutating, false);
  assert.equal(care.operations.some((op) => /refund|credit/i.test(op.id + op.path)), false);
});

test('company boundary fails closed', () => {
  assert.equal(assertTitanNativeWorkforceBoundary('company-1'), 'company-1');
  assert.throws(() => assertTitanNativeWorkforceBoundary(''), /company_id-required/);
});
