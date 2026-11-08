import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutingFeedbackAdjustment, rankRoutingCandidatesWithFeedback } from '../.test-dist/workforce-capacity/index.js';

test('strong verified outcomes raise routing recommendation only by bounded deterministic step', () => {
  const result = buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', observation_window_id: 'week-1', verified_outcome_count: 10, quality_score: 0.95, sla_breach_rate: 0, failure_rate: 0, rework_rate: 0, capacity_state: 'AVAILABLE' });
  assert.equal(result.applied_delta, 5);
  assert.equal(result.routing_adjustment, 5);
  assert.equal(result.max_step_change, 5);
  assert.equal(result.execution_permitted, false);
  assert.equal(result.grants_authority, false);
});

test('poor verified outcomes reduce routing recommendation and remain bounded', () => {
  const result = buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'agent', subject_id: 'a1', observation_window_id: 'week-2', verified_outcome_count: 20, quality_score: 0.4, sla_breach_rate: 0.5, failure_rate: 0.3, rework_rate: 0.2, capacity_state: 'DEGRADED', previous_adjustment: -12 });
  assert.equal(result.applied_delta, -5);
  assert.equal(result.routing_adjustment, -15);
  assert.ok(result.reasons.includes('LOW_QUALITY'));
  assert.ok(result.reasons.includes('CAPACITY_DEGRADED'));
  assert.equal(result.policy_mutation_permitted, false);
});

test('insufficient verified sample records evidence but does not steer routing', () => {
  const result = buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', observation_window_id: 'tiny', verified_outcome_count: 2, quality_score: 1, previous_adjustment: 4 });
  assert.equal(result.applied_delta, 0);
  assert.equal(result.routing_adjustment, 4);
  assert.deepEqual(result.reasons, ['INSUFFICIENT_VERIFIED_SAMPLE']);
});

test('saturated capacity suppresses positive feedback within same auditable policy', () => {
  const result = buildRoutingFeedbackAdjustment({ company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', observation_window_id: 'week-3', verified_outcome_count: 10, quality_score: 0.95, failure_rate: 0, sla_breach_rate: 0, capacity_state: 'SATURATED' });
  assert.ok(result.raw_delta <= 0);
  assert.ok(result.reasons.includes('CAPACITY_SATURATED'));
});

test('feedback ranking adjusts only externally eligible candidates', () => {
  const ranked = rankRoutingCandidatesWithFeedback({ company_id: 'co-1', candidates: [
    { company_id: 'co-1', subject_kind: 'worker', subject_id: 'w1', eligible: true, base_routing_score: 70, feedback_adjustment: -10 },
    { company_id: 'co-1', subject_kind: 'worker', subject_id: 'w2', eligible: true, base_routing_score: 65, feedback_adjustment: 10 },
    { company_id: 'co-1', subject_kind: 'worker', subject_id: 'w3', eligible: false, base_routing_score: 100, feedback_adjustment: 15 },
  ] });
  assert.deepEqual(ranked.ranked.map((r) => r.subject_id), ['w2', 'w1']);
  assert.deepEqual(ranked.ineligible.map((r) => r.subject_id), ['w3']);
  assert.equal(ranked.feedback_cannot_create_eligibility, true);
  assert.equal(ranked.feedback_cannot_grant_authority, true);
});

test('candidate ordering is deterministic for identical scores', () => {
  const ranked = rankRoutingCandidatesWithFeedback({ company_id: 'co-1', candidates: [
    { company_id: 'co-1', subject_kind: 'worker', subject_id: 'w-b', eligible: true, base_routing_score: 50 },
    { company_id: 'co-1', subject_kind: 'worker', subject_id: 'w-a', eligible: true, base_routing_score: 50 },
  ] });
  assert.deepEqual(ranked.ranked.map((r) => r.subject_id), ['w-a', 'w-b']);
});

test('feedback rejects cross-company and legacy tenant boundaries', () => {
  assert.throws(() => buildRoutingFeedbackAdjustment({ company_id: 'co-1', tenant_id: 'legacy', subject_kind: 'worker', subject_id: 'w1', observation_window_id: 'x' }), /legacy tenant boundary/);
  assert.throws(() => rankRoutingCandidatesWithFeedback({ company_id: 'co-1', candidates: [{ company_id: 'co-2', subject_kind: 'worker', subject_id: 'w2', eligible: true, base_routing_score: 10 }] }), /cross-company/);
});
