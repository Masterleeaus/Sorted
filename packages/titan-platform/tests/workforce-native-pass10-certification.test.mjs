import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listTitanNativeWorkforceAgentMaps,
  getTitanNativeWorkforceAgentMap,
  buildTitanNativeWorkflowPlan,
  buildTitanNativeGovernanceEvidence,
} from '../.test-dist/workforce-native/index.js';

const ROOT = path.resolve(process.cwd(), '../..');
const routeFor = (agent) => path.join(ROOT, 'apps/web/app/api/v1/titan/workforce/native', agent, 'route.ts');

test('Pass10 parity certifies exactly six native agents with Business Ops truth and no identity authority', () => {
  const agents = listTitanNativeWorkforceAgentMaps();
  assert.equal(agents.length, 6);
  for (const agent of agents) {
    assert.equal(agent.companyBoundary, 'company_id');
    assert.equal(agent.canonicalBusinessTruth, 'business_ops');
    assert.equal(agent.identityGrantsAuthority, false);
    assert.ok(agent.operations.length > 0);
  }
});

test('Pass10 parity certifies all six governed web routes remain present and free of Chrome runtime messaging', () => {
  const routeNames = ['reception','sales','booking','scheduling','jobs','customer-care'];
  for (const name of routeNames) {
    const file = routeFor(name);
    assert.equal(fs.existsSync(file), true, `missing native route ${name}`);
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /chrome\.(runtime|tabs|storage)|sendMessage\s*\(/i, `extension messaging leaked into ${name}`);
    assert.match(source, /owner|admin/i, `governed role guard missing from ${name}`);
  }
});

test('Pass10 parity certifies critical canonical Business Ops mutations remain mapped', () => {
  const booking = getTitanNativeWorkforceAgentMap('booking');
  const scheduling = getTitanNativeWorkforceAgentMap('scheduling');
  const jobs = getTitanNativeWorkforceAgentMap('jobs');
  assert.ok(booking.operations.some((op) => op.path === '/api/v1/booking-requests/:id/convert' && op.mutating));
  assert.ok(scheduling.operations.some((op) => /visits/.test(op.path) && op.mutating));
  assert.ok(jobs.operations.some((op) => op.path === '/api/v1/work-orders/:id/complete' && op.mutating));
});

test('Pass10 parity certifies workflow execution remains externally authorized', () => {
  const plan = buildTitanNativeWorkflowPlan({
    workflowId: 'cert-wf', companyId: 'cert-company', actorId: 'cert-user', idempotencyKey: 'cert-idem',
    steps: [{ id: 'care', agentKey: 'customer_care', input: { action: 'get_customer', customerId: 'customer-1' } }],
  });
  assert.equal(plan.authority.execution_permitted, false);
  assert.equal(plan.company_id, 'cert-company');
});

test('Pass10 parity certifies offline mutation is fail-closed with no automatic replay', () => {
  const booking = getTitanNativeWorkforceAgentMap('booking');
  const op = booking.operations.find((entry) => entry.mutating);
  assert.ok(op);
  const evidence = buildTitanNativeGovernanceEvidence({
    companyId: 'cert-company', actorId: 'cert-user', agentKey: 'booking', action: 'certify', traceId: 'cert-trace',
    operation: op, permissionGranted: true, online: false,
  });
  assert.equal(evidence.diagnostics.status, 'BLOCKED');
  assert.equal(evidence.offline.automatic_effect_replay, false);
  assert.equal(evidence.offline.explicit_resume_required, true);
});
