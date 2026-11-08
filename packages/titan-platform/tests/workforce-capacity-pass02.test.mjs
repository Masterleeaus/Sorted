import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapacitySubjectModel,
  buildCapacityPortfolio,
  adaptWorkloadCapacitySnapshot,
} from '../.test-dist/workforce-capacity/index.js';

test('worker model computes concurrency, queue and budgets without authority', () => {
  const model = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', concurrency_limit: 4, active_count: 2, queued_count: 3, time_budget_minutes: 480, time_committed_minutes: 240, cost_budget_minor: 10000, cost_committed_minor: 4000 });
  assert.equal(model.concurrency.remaining, 2);
  assert.equal(model.concurrency.queued, 3);
  assert.equal(model.time_budget.utilization, 0.5);
  assert.equal(model.cost_budget.remaining, 6000);
  assert.equal(model.grants_authority, false);
  assert.equal(model.execution_permitted, false);
});

test('agent saturation blocks new work', () => {
  const model = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'agent', subject_id: 'booking', concurrency_limit: 2, active_count: 2, queued_count: 1 });
  assert.equal(model.state, 'SATURATED');
  assert.equal(model.available_for_new_work, false);
  assert.ok(model.blockers.includes('CONCURRENCY_SATURATED'));
});

test('supervisor model carries subordinate scope but does not reassign', () => {
  const model = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'supervisor', subject_id: 'sup-1', concurrency_limit: 8, active_count: 3, subordinate_ids: ['w2', 'w1', 'w2'] });
  assert.deepEqual(model.subordinate_ids, ['w1', 'w2']);
  assert.equal(model.automatic_reassignment, false);
  assert.equal(model.grants_authority, false);
});

test('portfolio rejects cross-company subjects', () => {
  assert.throws(() => buildCapacityPortfolio({ company_id: 'co-1', subjects: [{ company_id: 'co-2', subject_kind: 'agent', subject_id: 'sales' }] }), /cross-company/);
});

test('legacy tenant aliases fail closed', () => {
  assert.throws(() => buildCapacitySubjectModel({ company_id: 'co-1', tenant_id: 'legacy', subject_kind: 'worker', subject_id: 'w1' }), /legacy tenant boundary/);
});

test('retained workload capacity snapshot adapts into worker models', () => {
  const models = adaptWorkloadCapacitySnapshot({ company_id: 'co-1', snapshot: { company_id: 'co-1', worker_capacity: [{ worker_id: 'w1', capacity_units: 40, committed_units: 10, state: 'BALANCED' }] }, availability: [{ worker_id: 'w1', state: 'AVAILABLE' }] });
  assert.equal(models.length, 1);
  assert.equal(models[0].subject_id, 'w1');
  assert.equal(models[0].concurrency.remaining, 30);
  assert.equal(models[0].source_refs.includes('titan.workforce.workload-capacity.v1'), true);
});
