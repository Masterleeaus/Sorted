import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkforceSlaPriority,
  buildWorkforceSlaQueue,
} from '../.test-dist/workforce-capacity/index.js';

const HOUR = 60 * 60 * 1000;

test('on-track SLA produces non-authoritative scheduling inputs', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-1', now_ms: 10 * HOUR, due_at_ms: 20 * HOUR, warning_window_ms: 4 * HOUR, base_priority: 10 });
  assert.equal(item.sla_state, 'ON_TRACK');
  assert.equal(item.scheduling_inputs.overdue, false);
  assert.equal(item.execution_permitted, false);
  assert.equal(item.grants_authority, false);
  assert.equal(item.automatic_assignment, false);
});

test('approaching deadline creates at-risk signal and deadline urgency', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-2', now_ms: 10 * HOUR, due_at_ms: 11 * HOUR, warning_window_ms: 4 * HOUR, base_priority: 10 });
  assert.equal(item.sla_state, 'AT_RISK');
  assert.ok(item.priority.deadline_urgency > 0);
  assert.ok(item.escalation.reasons.includes('SLA_AT_RISK'));
});

test('overdue work breaches SLA and records overdue duration', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-3', now_ms: 12 * HOUR, due_at_ms: 10 * HOUR, base_priority: 5 });
  assert.equal(item.sla_state, 'BREACHED');
  assert.equal(item.deadline.overdue_ms, 2 * HOUR);
  assert.equal(item.escalation.required, true);
  assert.ok(item.escalation.reasons.includes('SLA_BREACHED'));
});

test('paused SLA does not accrue deadline urgency and is not rank-eligible', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-4', now_ms: 12 * HOUR, due_at_ms: 10 * HOUR, paused: true, base_priority: 20 });
  assert.equal(item.sla_state, 'PAUSED');
  assert.equal(item.priority.deadline_urgency, 0);
  assert.equal(item.scheduling_inputs.eligible_for_priority_ranking, false);
});

test('high severity/risk signals escalation without granting authority', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-5', now_ms: 1, severity: 5, risk: 5, customer_impact: 4, dependency_criticality: 3 });
  assert.ok(item.escalation.reasons.includes('HIGH_SEVERITY'));
  assert.ok(item.escalation.reasons.includes('HIGH_RISK'));
  assert.equal(item.recommendation_only, true);
  assert.equal(item.execution_permitted, false);
});

test('authorized override can raise ranking but still cannot authorize execution', () => {
  const item = buildWorkforceSlaPriority({ company_id: 'co-1', work_id: 'job-6', now_ms: 1, base_priority: 1, authorized_priority_override: 90 });
  assert.equal(item.priority.score, 90);
  assert.equal(item.priority.band, 'CRITICAL');
  assert.equal(item.execution_permitted, false);
  assert.equal(item.grants_authority, false);
});

test('queue ordering is deterministic by score, deadline then work id', () => {
  const queue = buildWorkforceSlaQueue({ company_id: 'co-1', work: [
    { company_id: 'co-1', work_id: 'b', now_ms: 0, due_at_ms: 10 * HOUR, base_priority: 20 },
    { company_id: 'co-1', work_id: 'a', now_ms: 0, due_at_ms: 8 * HOUR, base_priority: 20 },
    { company_id: 'co-1', work_id: 'critical', now_ms: 0, base_priority: 40, severity: 5, risk: 5 },
  ]});
  assert.equal(queue.items[0].work_id, 'critical');
  assert.deepEqual(queue.items.slice(1).map((x) => x.work_id), ['a', 'b']);
});

test('cross-company and legacy tenant boundaries fail closed', () => {
  assert.throws(() => buildWorkforceSlaQueue({ company_id: 'co-1', work: [{ company_id: 'co-2', work_id: 'x', now_ms: 1 }] }), /cross-company/);
  assert.throws(() => buildWorkforceSlaPriority({ company_id: 'co-1', tenant_id: 'legacy', work_id: 'x', now_ms: 1 }), /legacy tenant boundary/);
});
