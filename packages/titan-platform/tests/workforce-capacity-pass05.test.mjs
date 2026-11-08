import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCapacitySubjectModel, buildSupervisorBalancingPlan } from '../.test-dist/workforce-capacity/index.js';

function supervisor(ids = ['w1', 'w2', 'w3']) {
  return buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'supervisor', subject_id: 'sup-1', subordinate_ids: ids, concurrency_limit: 10, active_count: 1 });
}

function worker(id, { limit = 4, active = 0, queued = 0, healthy = true, available = true } = {}) {
  return buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: id, concurrency_limit: limit, active_count: active, queued_count: queued, healthy, available });
}

test('saturated worker gets approval-required lower-load balancing proposal without reassignment authority', () => {
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(), subjects: [worker('w1', { active: 4, queued: 2 }), worker('w2', { active: 1 }), worker('w3', { active: 2 })], work: [{ company_id: 'co-1', work_id: 'job-1', assigned_subject_kind: 'worker', assigned_subject_id: 'w1', priority_score: 90 }] });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].to_subject_id, 'w2');
  assert.equal(plan.proposals[0].requires_approval, true);
  assert.equal(plan.automatic_reassignment, false);
  assert.equal(plan.execution_permitted, false);
  assert.equal(plan.grants_authority, false);
});

test('healthy uncongested source is not moved', () => {
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(), subjects: [worker('w1', { active: 1 }), worker('w2', { active: 0 })], work: [{ company_id: 'co-1', work_id: 'job-1', assigned_subject_kind: 'worker', assigned_subject_id: 'w1' }] });
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.skipped[0].reason, 'SOURCE_DOES_NOT_REQUIRE_RELIEF');
});

test('supervisor scope prevents balancing to undeclared subordinate', () => {
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(['w1']), subjects: [worker('w1', { active: 4, queued: 1 }), worker('w2', { active: 0 })], work: [{ company_id: 'co-1', work_id: 'job-1', assigned_subject_kind: 'worker', assigned_subject_id: 'w1' }] });
  assert.equal(plan.proposals.length, 0);
  assert.equal(plan.skipped[0].reason, 'NO_ELIGIBLE_LOWER_LOAD_TARGET');
});

test('proposal count is bounded and deterministic by work priority', () => {
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(), max_proposals: 1, subjects: [worker('w1', { active: 4, queued: 3 }), worker('w2', { active: 0 }), worker('w3', { active: 1 })], work: [
    { company_id: 'co-1', work_id: 'low', assigned_subject_kind: 'worker', assigned_subject_id: 'w1', priority_score: 10 },
    { company_id: 'co-1', work_id: 'high', assigned_subject_kind: 'worker', assigned_subject_id: 'w1', priority_score: 90 },
  ] });
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].work_id, 'high');
  assert.equal(plan.summary.proposal_limit, 1);
});

test('candidate ranking prefers lower utilization then quality evidence', () => {
  const w2 = worker('w2', { limit: 4, active: 1 });
  const w3 = worker('w3', { limit: 4, active: 1 });
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(), quality_scores: { w2: 0.7, w3: 0.9 }, subjects: [worker('w1', { active: 4, queued: 1 }), w2, w3], work: [{ company_id: 'co-1', work_id: 'job-1', assigned_subject_kind: 'worker', assigned_subject_id: 'w1' }] });
  assert.equal(plan.proposals[0].to_subject_id, 'w3');
  assert.equal(plan.proposals[0].target_quality_score, 0.9);
});

test('agent balancing stays within agent kind and cannot spill to workers', () => {
  const sup = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'supervisor', subject_id: 'sup-1', subordinate_ids: ['a1', 'a2', 'w1'] });
  const a1 = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'agent', subject_id: 'a1', concurrency_limit: 2, active_count: 2, queued_count: 1 });
  const a2 = buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'agent', subject_id: 'a2', concurrency_limit: 2, active_count: 0 });
  const plan = buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: sup, subjects: [a1, a2, worker('w1', { active: 0 })], work: [{ company_id: 'co-1', work_id: 'booking-1', assigned_subject_kind: 'agent', assigned_subject_id: 'a1' }] });
  assert.equal(plan.proposals[0].to_subject_id, 'a2');
  assert.equal(plan.proposals[0].subject_kind, 'agent');
});

test('cross-company and legacy tenant inputs fail closed', () => {
  assert.throws(() => buildSupervisorBalancingPlan({ company_id: 'co-1', supervisor: supervisor(), subjects: [worker('w1')], work: [{ company_id: 'co-2', work_id: 'x', assigned_subject_kind: 'worker', assigned_subject_id: 'w1' }] }), /cross-company/);
  assert.throws(() => buildSupervisorBalancingPlan({ company_id: 'co-1', tenant_id: 'legacy', supervisor: supervisor(), subjects: [], work: [] }), /legacy tenant boundary/);
});
