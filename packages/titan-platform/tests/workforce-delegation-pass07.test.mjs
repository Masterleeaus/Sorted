import test from 'node:test';
import assert from 'node:assert/strict';
import { planTitanDelegationRecovery } from '../.test-dist/workforce-delegation/index.js';
import { createWorkforceRetryEvaluator } from '../.test-dist/ported/titan-workforce/gateway/failure-retry.js';

const envelope = {
  company_id: 'co-1', delegation_id: 'd-7', objective: 'finish workflow', inputs: {},
  authority_ceiling: 'WRITE_INTERNAL', priority: 'HIGH', idempotency_key: 'idem-root',
  causality: { correlation_id: 'corr-7' }, expected_outcome: { description: 'done', evidence_required: ['receipt'] },
};
const step = (overrides={}) => ({
  step_id: 's1', operation_kind: 'write', status: 'FAILED', dispatch_proven: false,
  retry_count: 0, idempotency_key: 'idem-s1', compensatable: false, compensation_command: null, ...overrides,
});
const evaluator = createWorkforceRetryEvaluator({ clock: () => 1000, base_delay_ms: 1000, max_delay_ms: 5000, max_retries: 3 });

test('safe pre-dispatch transient failure reuses workforce retry policy', async () => {
  const plan = await planTitanDelegationRecovery({ envelope, steps: [step()], failed_step_id: 's1', failure: { http_status: 503 }, retry_policy: evaluator });
  assert.equal(plan.action, 'RETRY');
  assert.equal(plan.retry_allowed, true);
  assert.equal(plan.execution_permitted, false);
  assert.equal(plan.grants_authority, false);
});

test('uncertain dispatched effect is never blindly replayed', async () => {
  const plan = await planTitanDelegationRecovery({ envelope, steps: [step({ dispatch_proven: true })], failed_step_id: 's1', failure: { http_status: 503 }, retry_policy: evaluator });
  assert.equal(plan.action, 'RECONCILE');
  assert.equal(plan.retry_allowed, false);
  assert.equal(plan.uncertain_effect, true);
  assert.equal(plan.approval_required, true);
});

test('partial failure proposes reverse-order compensation without executing it', async () => {
  const steps = [
    step({ step_id: 's1', status: 'SUCCEEDED', idempotency_key: 'i1', compensatable: true, compensation_command: 'undo-one' }),
    step({ step_id: 's2', status: 'SUCCEEDED', idempotency_key: 'i2', compensatable: true, compensation_command: 'undo-two' }),
    step({ step_id: 's3', status: 'FAILED', idempotency_key: 'i3', dispatch_proven: false }),
  ];
  const plan = await planTitanDelegationRecovery({ envelope, steps, failed_step_id: 's3', failure: { http_status: 422 }, retry_policy: evaluator });
  assert.equal(plan.partial_failure, true);
  assert.equal(plan.action, 'COMPENSATE');
  assert.deepEqual(plan.compensation_steps.map(x => x.compensation_command), ['undo-two', 'undo-one']);
  assert.deepEqual(plan.compensation_steps.map(x => x.idempotency_key), ['compensate:i2', 'compensate:i1']);
  assert.equal(plan.execution_permitted, false);
});

test('cancel before effects can cancel directly', async () => {
  const plan = await planTitanDelegationRecovery({ envelope, steps: [step({ status: 'PENDING' })], cancel_requested: true });
  assert.equal(plan.action, 'CANCEL');
  assert.equal(plan.approval_required, false);
});

test('cancel after successful effect requires compensation when available', async () => {
  const plan = await planTitanDelegationRecovery({ envelope, steps: [step({ status: 'SUCCEEDED', compensatable: true, compensation_command: 'undo-one' })], cancel_requested: true });
  assert.equal(plan.action, 'COMPENSATE');
  assert.equal(plan.approval_required, true);
});

test('duplicate workflow step ids fail closed', async () => {
  await assert.rejects(() => planTitanDelegationRecovery({ envelope, steps: [step(), step()] }), /delegation-step-duplicate:s1/);
});

test('failed step must exist in supplied workflow history', async () => {
  await assert.rejects(() => planTitanDelegationRecovery({ envelope, steps: [step()], failed_step_id: 'missing', failure: {}, retry_policy: evaluator }), /delegation-failed-step-not-found/);
});

test('recovery remains company-bound through authoritative retry evaluator', async () => {
  const plan = await planTitanDelegationRecovery({ envelope, steps: [step()], failed_step_id: 's1', failure: { company_id: 'evil', http_status: 503 }, retry_policy: evaluator });
  assert.equal(plan.company_id, 'co-1');
  assert.equal(plan.action, 'RETRY');
});
