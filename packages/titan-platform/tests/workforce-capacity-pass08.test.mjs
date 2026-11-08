import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildCapacitySubjectModel,
  buildWorkforceCapacityDiagnostics,
  buildWorkforceSlaPriority,
  scoreQualityOutcome,
  buildWorkforceBackpressurePlan,
  buildRoutingFeedbackAdjustment,
} from '../.test-dist/workforce-capacity/index.js';

function fixtures() {
  const capacity = [
    buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'supervisor', subject_id: 's1', concurrency_limit: 4, active_count: 1, subordinate_ids: ['w1', 'w2'] }),
    buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', concurrency_limit: 2, active_count: 2, queued_count: 3 }),
    buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w2', concurrency_limit: 4, active_count: 1 }),
    buildCapacitySubjectModel({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w3', concurrency_limit: 4, active_count: 1 }),
  ];
  const sla = [
    buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-1', now_ms: 2000, due_at_ms: 1000 }),
    buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-2', now_ms: 1000, due_at_ms: 1500, warning_window_ms: 1000 }),
    buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-3', now_ms: 1000, due_at_ms: 9000 }),
  ];
  const quality = [
    scoreQualityOutcome({ company_id: 'co-1', subject_id: 'w1', task_count: 10, success_count: 3, failure_count: 4, rework_count: 3, evidence_count: 10, validation_pass_count: 4, validation_fail_count: 3 }),
    scoreQualityOutcome({ company_id: 'co-1', subject_id: 'w2', task_count: 10, success_count: 10, evidence_count: 10, validation_pass_count: 10, on_time_count: 10 }),
    scoreQualityOutcome({ company_id: 'co-1', subject_id: 'w3', task_count: 10, success_count: 10, evidence_count: 10, validation_pass_count: 10, on_time_count: 10 }),
  ];
  const backpressure = buildWorkforceBackpressurePlan({ company_id: 'co-1', subjects: capacity }).decisions;
  const feedback = [
    buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', observation_window_id: 'w', verified_outcome_count: 10, quality_score: 0.4, capacity_state: 'SATURATED' }),
    buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w2', observation_window_id: 'w', verified_outcome_count: 10, quality_score: 0.95, capacity_state: 'AVAILABLE' }),
  ];
  return { capacity, sla, quality, backpressure, feedback };
}

test('manager diagnostics aggregate capacity SLA quality backpressure and feedback read-only', () => {
  const f = fixtures();
  const result = buildWorkforceCapacityDiagnostics({ company_id: 'co-1', viewer: { role: 'manager' }, ...f });
  assert.equal(result.inspection_surface, 'MANAGER');
  assert.equal(result.summary.capacity.total, 4);
  assert.equal(result.summary.sla.breached, 1);
  assert.ok(result.summary.quality.review >= 1);
  assert.ok(result.summary.critical_alerts >= 1);
  assert.equal(result.read_only, true);
  assert.equal(result.mutation_permitted, false);
  assert.equal(result.execution_permitted, false);
  assert.equal(result.grants_authority, false);
});

test('supervisor diagnostics fail closed to declared subordinate scope', () => {
  const f = fixtures();
  const result = buildWorkforceCapacityDiagnostics({
    company_id: 'co-1', viewer: { role: 'supervisor', supervisor_id: 's1', subordinate_ids: ['w1', 'w2'] }, ...f,
    work_owner_map: { 'job-1': 'w1', 'job-2': 'w3', 'job-3': 'w2' },
  });
  assert.deepEqual(result.sections.capacity.map((x) => x.subject_id).sort(), ['s1', 'w1', 'w2']);
  assert.deepEqual(result.sections.quality.map((x) => x.subject_id).sort(), ['w1', 'w2']);
  assert.deepEqual(result.sections.sla.map((x) => x.work_id).sort(), ['job-1', 'job-3']);
  assert.equal(result.inspection_surface, 'SUPERVISOR');
});

test('supervisor SLA rows without scoped owner evidence are omitted instead of leaked', () => {
  const f = fixtures();
  const result = buildWorkforceCapacityDiagnostics({ company_id: 'co-1', viewer: { role: 'supervisor', supervisor_id: 's1', subordinate_ids: ['w1'] }, ...f });
  assert.equal(result.sections.sla.length, 0);
});

test('diagnostic alerts sort deterministically by severity and identity', () => {
  const f = fixtures();
  const result = buildWorkforceCapacityDiagnostics({ company_id: 'co-1', viewer: { role: 'manager' }, ...f });
  const ranks = { CRITICAL: 3, WARNING: 2, INFO: 1 };
  for (let i = 1; i < result.sections.alerts.length; i++) assert.ok(ranks[result.sections.alerts[i - 1].severity] >= ranks[result.sections.alerts[i].severity]);
});

test('diagnostics reject legacy or cross-company evidence', () => {
  const f = fixtures();
  assert.throws(() => buildWorkforceCapacityDiagnostics({ company_id: 'co-1', tenant_id: 'legacy', viewer: { role: 'manager' }, ...f }), /legacy tenant boundary/);
  const foreign = buildCapacitySubjectModel({ company_id: 'co-2', subject_kind: 'worker', subject_id: 'x', concurrency_limit: 1 });
  assert.throws(() => buildWorkforceCapacityDiagnostics({ company_id: 'co-1', viewer: { role: 'manager' }, capacity: [foreign] }), /cross-company/);
});

test('supervisor diagnostics require explicit supervisor identity', () => {
  assert.throws(() => buildWorkforceCapacityDiagnostics({ company_id: 'co-1', viewer: { role: 'supervisor' } }), /supervisor_id/);
});

test('web inspection adapter is additive read-only and exposes no mutation actions', () => {
  const source = fs.readFileSync(new URL('../../../apps/web/lib/titan/workforce-capacity/diagnostics.ts', import.meta.url), 'utf8');
  assert.match(source, /buildWorkforceCapacityDiagnostics/);
  assert.match(source, /readOnly:\s*true/);
  assert.match(source, /mutationActions:\s*\[\]/);
  assert.match(source, /existing diagnostics\/control-room patterns/);
});
