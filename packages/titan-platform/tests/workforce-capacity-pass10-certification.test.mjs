import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCapacitySubjectModel,
  buildCapacityPortfolio,
  buildSupervisorBalancingPlan,
  buildWorkforceBackpressurePlan,
  buildWorkforceSlaQueue,
  buildRoutingFeedbackAdjustment,
  rankRoutingCandidatesWithFeedback,
  buildWorkforceCapacityDiagnostics,
  scoreQualityOutcome,
} from '../.test-dist/workforce-capacity/index.js';

const company_id = 'co-final';
const worker = (subject_id, opts = {}) => buildCapacitySubjectModel({
  company_id,
  subject_kind: 'worker',
  subject_id,
  concurrency_limit: opts.limit ?? 10,
  active_count: opts.active ?? 0,
  queued_count: opts.queued ?? 0,
  healthy: opts.healthy ?? true,
  available: opts.available ?? true,
});

test('integrated projection remains non-authoritative across capacity, balancing, backpressure and diagnostics', () => {
  const subjects = [
    worker('source', { limit: 10, active: 10, queued: 8 }),
    worker('a', { limit: 10, active: 1 }),
    worker('b', { limit: 10, active: 2 }),
  ];
  const supervisor = buildCapacitySubjectModel({ company_id, subject_kind: 'supervisor', subject_id: 'sup', subordinate_ids: ['source','a','b'], concurrency_limit: 50, active_count: 1 });
  const portfolio = buildCapacityPortfolio({ company_id, subjects });
  const work = Array.from({ length: 4 }, (_, i) => ({ company_id, work_id: `job-${i}`, assigned_subject_kind: 'worker', assigned_subject_id: 'source', priority_score: 100 - i }));
  const balancing = buildSupervisorBalancingPlan({ company_id, supervisor, subjects, work, max_proposals: 4 });
  const backpressure = buildWorkforceBackpressurePlan({ company_id, subjects });
  const quality = subjects.map((s, i) => scoreQualityOutcome({ company_id, subject_id: s.subject_id, task_count: 20, success_count: 18 - i, failure_count: i, rework_count: i, evidence_count: 20, validation_pass_count: 19 - i }));
  const diagnostics = buildWorkforceCapacityDiagnostics({ company_id, viewer: { role: 'manager' }, capacity: subjects, quality, backpressure: backpressure.decisions });

  for (const result of [portfolio, balancing, backpressure, diagnostics]) {
    assert.notEqual(result.execution_permitted, true);
    assert.notEqual(result.grants_authority, true);
    assert.notEqual(result.automatic_assignment, true);
    assert.notEqual(result.automatic_reassignment, true);
  }
  assert.ok(balancing.proposals.every((p) => p.proposal_only && p.requires_approval && p.execution_permitted === false && p.grants_authority === false));
  assert.ok(backpressure.decisions.every((d) => d.automatic_execution === false && d.automatic_assignment === false && d.automatic_reassignment === false));
  assert.equal(diagnostics.read_only, true);
  assert.equal(diagnostics.mutation_permitted, false);
});

test('metrics cannot manufacture eligibility or business truth', () => {
  const good = buildRoutingFeedbackAdjustment({ company_id, subject_kind: 'worker', subject_id: 'blocked', observation_window_id: 'w1', verified_outcome_count: 100, quality_score: 1, failure_rate: 0, rework_rate: 0, sla_breach_rate: 0, previous_adjustment: 15, capacity_state: 'AVAILABLE' });
  assert.ok(good.routing_adjustment <= 15);
  const ranked = rankRoutingCandidatesWithFeedback({ company_id, candidates: [
    { company_id, subject_kind: 'worker', subject_id: 'blocked', eligible: false, base_routing_score: 1000, feedback_adjustment: 15 },
    { company_id, subject_kind: 'worker', subject_id: 'eligible', eligible: true, base_routing_score: 1, feedback_adjustment: -15 },
  ]});
  assert.deepEqual(ranked.ranked.map((x) => x.subject_id), ['eligible']);
  assert.equal(ranked.feedback_cannot_create_eligibility, true);
  assert.equal(ranked.grants_authority, false);
});

test('SLA and quality evidence only affect deterministic prioritisation/projection', () => {
  const queue = buildWorkforceSlaQueue({ company_id, work: [
    { company_id, work_id: 'late', now_ms: 1000, due_at_ms: 900, base_priority: 10 },
    { company_id, work_id: 'later', now_ms: 1000, due_at_ms: 100000, base_priority: 90 },
  ]});
  const late = queue.items.find((x) => x.work_id === 'late');
  assert.equal(late.sla_state, 'BREACHED');
  assert.equal(late.escalation.required, true);
  assert.ok(late.priority.deadline_urgency > 0);
  assert.notEqual(queue.execution_permitted, true);
  assert.notEqual(queue.grants_authority, true);
  const q = scoreQualityOutcome({ company_id, subject_id: 'w1', task_count: 10, success_count: 10, failure_count: 0, rework_count: 0, evidence_count: 10, validation_pass_count: 10 });
  assert.notEqual(q.grants_authority, true);
  assert.notEqual(q.execution_permitted, true);
});

test('offline/degraded states remain fail-closed and preserve pending work', () => {
  const subjects = [worker('w1', { active: 1, queued: 8 })];
  const offline = buildWorkforceBackpressurePlan({ company_id, operating_mode: 'OFFLINE', subjects });
  assert.equal(offline.decisions[0].recommendation, 'DEFER');
  assert.equal(offline.decisions[0].requires_reconnect_review, true);
  assert.equal(offline.automatic_retry, false);
  assert.equal(offline.preserves_pending_work, true);
});

test('company boundary rejects cross-company integrated inputs', () => {
  const foreign = buildCapacitySubjectModel({ company_id: 'co-other', subject_kind: 'worker', subject_id: 'foreign', concurrency_limit: 2 });
  assert.throws(() => buildCapacityPortfolio({ company_id, subjects: [foreign] }), /cross-company/);
  assert.throws(() => buildWorkforceBackpressurePlan({ company_id, subjects: [foreign] }), /cross-company/);
});

test('source tree contains no positive authority/execution flags or direct persistence/network mutation seams', () => {
  const root = path.resolve('src/workforce-capacity');
  const files = fs.readdirSync(root).filter((name) => name.endsWith('.ts'));
  const joined = files.map((name) => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
  const forbidden = [
    /grants_authority\s*:\s*true/g,
    /execution_permitted\s*:\s*true/g,
    /automatic_assignment\s*:\s*true/g,
    /automatic_reassignment\s*:\s*true/g,
    /automatic_execution\s*:\s*true/g,
    /\bfetch\s*\(/g,
    /\bXMLHttpRequest\b/g,
    /\bINSERT\s+INTO\b/gi,
    /\bUPDATE\s+[A-Za-z_]/gi,
    /\bDELETE\s+FROM\b/gi,
  ];
  for (const pattern of forbidden) assert.equal(pattern.test(joined), false, String(pattern));
});

test('large integrated projection completes deterministically without mutating inputs', () => {
  const subjectInputs = Array.from({ length: 2000 }, (_, i) => ({ company_id, subject_kind: 'worker', subject_id: `w${i}`, concurrency_limit: 8, active_count: i % 9, queued_count: i % 6 }));
  const snapshot = JSON.stringify(subjectInputs);
  const a = buildCapacityPortfolio({ company_id, subjects: subjectInputs });
  const b = buildCapacityPortfolio({ company_id, subjects: subjectInputs });
  assert.equal(a.summary.total, 2000);
  assert.deepEqual(a.summary, b.summary);
  assert.equal(JSON.stringify(subjectInputs), snapshot);
});
