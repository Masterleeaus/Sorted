import assert from 'node:assert/strict';
import test from 'node:test';
import { createSurfaceCommandIntent, getDemoSurfaceProjection } from '../surface-contract.mjs';

test('canonical Zero chat has an authority-neutral presentation and command capability', () => {
  const projection = getDemoSurfaceProjection('zero');
  assert.equal(projection.surface, 'zero');
  assert.equal(projection.actor_id, 'zero-demo-actor');
  assert.ok(projection.data.presentation.suggestions.length);
  const intent = createSurfaceCommandIntent({ projection, capability_id: 'decision.resolve', operation: 'approve', idempotency_key: 'zero-1', correlation_id: 'zero-correlation' });
  assert.equal(intent.surface, 'zero');
  assert.equal(intent.execution_authorised, false);
  assert.equal(intent.requires_server_acceptance, true);
  assert.equal(intent.requires_receipt, true);
});

test('legacy command presentation remains compatible', () => {
  const projection = getDemoSurfaceProjection('command');
  assert.equal(projection.surface, 'command');
  assert.equal(projection.actor_id, 'command-demo-actor');
  assert.equal(projection.data.presentation.name, 'Titan Command');
});

test('surface declarations do not grant capabilities or bypass expiry', () => {
  const projection = getDemoSurfaceProjection('go');
  assert.throws(() => getDemoSurfaceProjection('unknown'), /canonical-surface-required/);
  assert.throws(() => createSurfaceCommandIntent({ projection, capability_id: 'decision.resolve', operation: 'approve' }), /surface-capability-not-authorised/);
  assert.throws(() => createSurfaceCommandIntent({ projection: { ...projection, expires_at: '2000-01-01T00:00:00Z' }, capability_id: 'jobs.progress', operation: 'start' }), /surface-projection-expired/);
  assert.throws(() => createSurfaceCommandIntent({ projection, tenant_id: 'legacy' }), /tenant_company_id-not-authoritative/);
});
