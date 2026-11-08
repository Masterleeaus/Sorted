import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapacitySubjectModel,
  buildCapacityPortfolio,
  buildSupervisorBalancingPlan,
  buildWorkforceBackpressurePlan,
  buildWorkforceSlaPriority,
  buildWorkforceSlaQueue,
  buildRoutingFeedbackAdjustment,
  rankRoutingCandidatesWithFeedback,
  buildWorkforceCapacityDiagnostics,
  scoreQualityOutcome,
} from '../.test-dist/workforce-capacity/index.js';

const company_id = 'co-stress';
const worker = (id, { limit = 10, active = 0, queued = 0, healthy = true, available = true } = {}) =>
  buildCapacitySubjectModel({ company_id, subject_kind: 'worker', subject_id: id, concurrency_limit: limit, active_count: active, queued_count: queued, healthy, available });
const supervisor = (ids) => buildCapacitySubjectModel({ company_id, subject_kind: 'supervisor', subject_id: 'sup', subordinate_ids: ids, concurrency_limit: 100, active_count: 1 });

test('load spike remains bounded and deterministic across 500 capacity subjects', () => {
  const subjectInputs = Array.from({ length: 500 }, (_, i) => ({ company_id, subject_kind: 'worker', subject_id: `w${String(i).padStart(3,'0')}`, concurrency_limit: 10, active_count: i % 11, queued_count: i % 7 }));
  const portfolio = buildCapacityPortfolio({ company_id, subjects: subjectInputs });
  assert.equal(portfolio.summary.total, 500);
  assert.equal(portfolio.summary.queue_depth, subjectInputs.reduce((n, x) => n + x.queued_count, 0));
  assert.equal(portfolio.execution_permitted, false);
  assert.equal(portfolio.grants_authority, false);
});

test('spike balancing accounts for projected target load instead of stampeding one worker', () => {
  const ids = ['source', 'a', 'b', 'c'];
  const subjects = [worker('source', { limit: 20, active: 20, queued: 20 }), worker('a', { limit: 4 }), worker('b', { limit: 4 }), worker('c', { limit: 4 })];
  const work = Array.from({ length: 9 }, (_, i) => ({ company_id, work_id: `job-${i}`, assigned_subject_kind: 'worker', assigned_subject_id: 'source', priority_score: 80 - i }));
  const plan = buildSupervisorBalancingPlan({ company_id, supervisor: supervisor(ids), subjects, work, max_proposals: 9 });
  const counts = new Map();
  for (const p of plan.proposals) counts.set(p.to_subject_id, (counts.get(p.to_subject_id) ?? 0) + 1);
  assert.equal(plan.projected_load_accounting, true);
  assert.equal(plan.proposals.length, 9);
  assert.ok(Math.max(...counts.values()) - Math.min(...counts.values()) <= 1, JSON.stringify([...counts]));
  assert.ok(plan.proposals.every((p) => p.projected_target_utilization_after_move <= 1));
});

test('priority inversion is prevented when proposal cap is smaller than stressed queue', () => {
  const subjects = [worker('source', { limit: 10, active: 10, queued: 10 }), worker('target', { limit: 10 })];
  const work = [
    { company_id, work_id: 'routine', assigned_subject_kind: 'worker', assigned_subject_id: 'source', priority_score: 10, due_at_ms: 999999 },
    { company_id, work_id: 'critical', assigned_subject_kind: 'worker', assigned_subject_id: 'source', priority_score: 100, due_at_ms: 100 },
    { company_id, work_id: 'urgent', assigned_subject_kind: 'worker', assigned_subject_id: 'source', priority_score: 90, due_at_ms: 200 },
  ];
  const plan = buildSupervisorBalancingPlan({ company_id, supervisor: supervisor(['source','target']), subjects, work, max_proposals: 2 });
  assert.deepEqual(plan.proposals.map((p) => p.work_id), ['critical', 'urgent']);
});

test('overdue and at-risk SLA inputs outrank routine work deterministically', () => {
  const rows = [
    buildWorkforceSlaPriority({ company_id, work_id: 'routine', now_ms: 1000, due_at_ms: 100000000, base_priority: 20 }),
    buildWorkforceSlaPriority({ company_id, work_id: 'overdue', now_ms: 1000, due_at_ms: 900, base_priority: 20 }),
    buildWorkforceSlaPriority({ company_id, work_id: 'risk', now_ms: 1000, due_at_ms: 1100, warning_window_ms: 1000, base_priority: 20 }),
  ];
  const ranked = buildWorkforceSlaQueue({ company_id, work: rows.map((row) => ({ company_id, work_id: row.work_id, now_ms: row.deadline.now_ms, due_at_ms: row.deadline.due_at_ms, warning_window_ms: row.deadline.warning_window_ms, base_priority: row.priority.base_priority })) }).items;
  assert.equal(ranked[0].work_id, 'overdue');
  assert.ok(ranked.findIndex((x) => x.work_id === 'risk') < ranked.findIndex((x) => x.work_id === 'routine'));
});

test('repeated verified failures degrade routing gradually but cannot create ineligibility authority', () => {
  let previous = 0;
  for (let i = 0; i < 10; i++) {
    const result = buildRoutingFeedbackAdjustment({ company_id, subject_kind: 'worker', subject_id: 'w1', observation_window_id: `window-${i}`, verified_outcome_count: 20, quality_score: 0.2, failure_rate: 0.8, rework_rate: 0.7, sla_breach_rate: 0.6, previous_adjustment: previous, capacity_state: 'CONSTRAINED' });
    previous = result.routing_adjustment;
    assert.ok(Math.abs(result.applied_delta) <= 5);
    assert.ok(Math.abs(result.routing_adjustment) <= 15);
    assert.equal(result.grants_authority, false);
  }
  assert.equal(previous, -15);
  const ranking = rankRoutingCandidatesWithFeedback({ company_id, candidates: [
    { company_id, subject_kind: 'worker', subject_id: 'w1', eligible: false, base_routing_score: 100, feedback_adjustment: 15 },
    { company_id, subject_kind: 'worker', subject_id: 'w2', eligible: true, base_routing_score: 50, feedback_adjustment: -15 },
  ]});
  assert.deepEqual(ranking.ranked.map((x) => x.subject_id), ['w2']);
  assert.equal(ranking.feedback_cannot_create_eligibility, true);
});

test('offline recovery defers all intake and reconnect does not imply automatic replay', () => {
  const subjects = [worker('w1', { active: 1, queued: 8 }), worker('w2', { active: 0, queued: 2 })];
  const offline = buildWorkforceBackpressurePlan({ company_id, operating_mode: 'OFFLINE', subjects });
  assert.ok(offline.decisions.every((x) => x.recommendation === 'DEFER' && x.requires_reconnect_review));
  assert.equal(offline.automatic_retry, false);
  const recovered = buildWorkforceBackpressurePlan({ company_id, operating_mode: 'ONLINE', subjects });
  assert.equal(recovered.automatic_retry, false);
  assert.equal(recovered.automatic_execution, false);
  assert.equal(recovered.preserves_pending_work, true);
});

test('diagnostics remain bounded/read-only under repeated failures and queue pressure', () => {
  const capacity = Array.from({ length: 100 }, (_, i) => worker(`w${i}`, { limit: 4, active: i % 5, queued: i % 9, healthy: i % 17 !== 0 }));
  const quality = capacity.map((row, i) => scoreQualityOutcome({ company_id, subject_id: row.subject_id, task_count: 20, success_count: i % 4 === 0 ? 8 : 18, failure_count: i % 4 === 0 ? 8 : 1, rework_count: i % 4 === 0 ? 4 : 1, evidence_count: 20, validation_pass_count: 18 }));
  const backpressure = buildWorkforceBackpressurePlan({ company_id, subjects: capacity }).decisions;
  const diagnostics = buildWorkforceCapacityDiagnostics({ company_id, viewer: { role: 'manager' }, capacity, quality, backpressure });
  assert.equal(diagnostics.summary.capacity.total, 100);
  assert.ok(diagnostics.summary.warning_alerts + diagnostics.summary.critical_alerts > 0);
  assert.equal(diagnostics.read_only, true);
  assert.equal(diagnostics.mutation_permitted, false);
  assert.equal(diagnostics.grants_authority, false);
});

test('cross-company contamination fails closed during stress paths', () => {
  const foreign = buildCapacitySubjectModel({ company_id: 'co-other', subject_kind: 'worker', subject_id: 'foreign', concurrency_limit: 2 });
  assert.throws(() => buildCapacityPortfolio({ company_id, subjects: [foreign] }), /cross-company/);
  assert.throws(() => buildWorkforceBackpressurePlan({ company_id, subjects: [foreign] }), /cross-company/);
});
