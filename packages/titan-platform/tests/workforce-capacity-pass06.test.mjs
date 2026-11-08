import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapacitySubjectModel, buildWorkforceBackpressurePlan } from '../.test-dist/workforce-capacity/index.js';

function worker(id, { limit = 4, active = 0, queued = 0, healthy = true, available = true } = {}) {
  return buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: id, concurrency_limit: limit, active_count: active, queued_count: queued, healthy, available });
}

test('healthy online capacity accepts work without granting execution authority', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: [worker('w1', { active: 1 })] });
  assert.equal(plan.decisions[0].recommendation, 'ACCEPT');
  assert.equal(plan.decisions[0].recommended_intake_fraction, 1);
  assert.equal(plan.execution_permitted, false);
  assert.equal(plan.grants_authority, false);
});

test('constrained capacity throttles intake instead of dropping queued work', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: [worker('w1', { active: 3, queued: 2 })] });
  assert.equal(plan.decisions[0].recommendation, 'THROTTLE');
  assert.equal(plan.decisions[0].drop_pending_work, false);
  assert.equal(plan.preserves_pending_work, true);
});

test('saturated subject defers new intake and never auto-reassigns', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: [worker('w1', { active: 4, queued: 3 })] });
  assert.equal(plan.decisions[0].recommendation, 'DEFER');
  assert.ok(plan.decisions[0].reasons.includes('SUBJECT_SATURATED'));
  assert.equal(plan.automatic_reassignment, false);
});

test('offline mode fails closed and requires reconnect review without blind replay', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', operating_mode: 'OFFLINE', subjects: [worker('w1')] });
  const decision = plan.decisions[0];
  assert.equal(decision.recommendation, 'DEFER');
  assert.equal(decision.requires_reconnect_review, true);
  assert.equal(decision.blind_retry_permitted, false);
  assert.equal(plan.automatic_retry, false);
});

test('degraded mode throttles otherwise healthy subjects with bounded intake fraction', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', operating_mode: 'DEGRADED', policy: { degraded_intake_fraction: 0.2 }, subjects: [worker('w1')] });
  assert.equal(plan.decisions[0].recommendation, 'THROTTLE');
  assert.equal(plan.decisions[0].recommended_intake_fraction, 0.2);
  assert.ok(plan.decisions[0].reasons.includes('WORKFORCE_DEGRADED'));
});

test('queue hard limit defers intake even when concurrency is not saturated', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', policy: { queue_warning_depth: 2, queue_hard_limit: 5 }, subjects: [worker('w1', { limit: 20, active: 1, queued: 5 })] });
  assert.equal(plan.decisions[0].recommendation, 'DEFER');
  assert.ok(plan.decisions[0].reasons.includes('QUEUE_HARD_LIMIT'));
});

test('backpressure decisions are deterministic by severity then queue pressure', () => {
  const plan = buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: [
    worker('available', { active: 0 }),
    worker('throttle', { active: 3, queued: 2 }),
    worker('hold', { active: 4, queued: 4 }),
  ] });
  assert.deepEqual(plan.decisions.map((d) => d.subject_id), ['hold', 'throttle', 'available']);
});

test('cross-company and legacy tenant boundaries fail closed', () => {
  const foreign = buildCapacitySubjectModel({ company_id: 'co-2', subject_kind: 'worker', subject_id: 'w2', concurrency_limit: 1 });
  assert.throws(() => buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: [foreign] }), /cross-company/);
  assert.throws(() => buildWorkforceBackpressurePlan({ company_id: 'co-1', tenant_id: 'legacy', subjects: [] }), /legacy tenant boundary/);
});

import fs from 'node:fs';

test('shared public export surface preserves native, delegation and capacity lanes', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./workforce-native'], './src/workforce-native/index.ts');
  assert.equal(pkg.exports['./workforce-delegation'], './src/workforce-delegation/index.ts');
  assert.equal(pkg.exports['./workforce-capacity'], './src/workforce-capacity/index.ts');
  const index = fs.readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(index, /workforce-native\/index\.js/);
  assert.match(index, /workforce-delegation\/index\.js/);
  assert.match(index, /workforce-capacity\/index\.js/);
});
