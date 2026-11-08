import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITAN_WORKFORCE_LIFECYCLE_TRANSITION_CONTRACT,
  createTitanWorkforceLifecycleRuntime,
  transitionTitanWorkforceLifecycle,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const runtime = (overrides={}) => createTitanWorkforceLifecycleRuntime({
  company_id:'company-1', agent_key:'booking', lifecycle_state:'REGISTERED', health_state:'READY', active_work_count:0, ...overrides,
});

const step = (r, action, overrides={}) => transitionTitanWorkforceLifecycle(r, action, {company_id:'company-1', ...overrides});

test('transition contract is company scoped and authority neutral', () => {
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_TRANSITION_CONTRACT.companyBoundary,'company_id');
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_TRANSITION_CONTRACT.transitionGrantsAuthority,false);
  assert.equal(TITAN_WORKFORCE_LIFECYCLE_TRANSITION_CONTRACT.activeWorkCancellationOnDisable,false);
});

test('enable requires ready health and never grants execution authority', () => {
  const enabled=step(runtime(),'ENABLE');
  assert.equal(enabled.runtime.lifecycle_state,'ENABLED');
  assert.equal(enabled.runtime.accepts_new_assignments,true);
  assert.equal(enabled.runtime.execution_permitted,false);
  assert.equal(enabled.transition.transition_grants_authority,false);
  assert.throws(() => step(runtime({health_state:'DEGRADED'}),'ENABLE'), /health-not-ready/);
  assert.throws(() => step(runtime({health_state:'UNAVAILABLE'}),'ENABLE'), /health-not-ready/);
});

test('pause blocks new assignments but preserves active work', () => {
  const paused=step(runtime({lifecycle_state:'ENABLED',active_work_count:3}),'PAUSE',{active_work_count:3});
  assert.equal(paused.runtime.lifecycle_state,'PAUSED');
  assert.equal(paused.runtime.active_work_count,3);
  assert.equal(paused.runtime.accepts_new_assignments,false);
});

test('resume requires paused + ready and preserves in-flight count', () => {
  const resumed=step(runtime({lifecycle_state:'PAUSED',active_work_count:2}),'RESUME',{active_work_count:2});
  assert.equal(resumed.runtime.lifecycle_state,'ENABLED');
  assert.equal(resumed.runtime.active_work_count,2);
  assert.equal(resumed.runtime.accepts_new_assignments,true);
  assert.throws(() => step(runtime({lifecycle_state:'PAUSED',health_state:'DEGRADED'}),'RESUME'), /health-not-ready/);
});

test('disable with active work enters draining and cannot accept new work', () => {
  const result=step(runtime({lifecycle_state:'ENABLED',active_work_count:4}),'DISABLE',{active_work_count:4,reason:'operator-disable'});
  assert.equal(result.runtime.lifecycle_state,'DRAINING');
  assert.equal(result.runtime.active_work_count,4);
  assert.equal(result.runtime.accepts_new_assignments,false);
  assert.equal(result.runtime.drain_reason,'operator-disable');
});

test('drain monotonically decreases and disables only at zero', () => {
  const start=runtime({lifecycle_state:'DRAINING',active_work_count:3,drain_reason:'operator-disable'});
  const two=step(start,'DRAIN_TICK',{active_work_count:2});
  assert.equal(two.runtime.lifecycle_state,'DRAINING');
  assert.equal(two.runtime.active_work_count,2);
  const zero=step(two.runtime,'DRAIN_TICK',{active_work_count:0});
  assert.equal(zero.runtime.lifecycle_state,'DISABLED');
  assert.equal(zero.runtime.active_work_count,0);
  assert.throws(() => step(start,'DRAIN_TICK',{active_work_count:4}), /cannot-increase/);
});

test('disable without active work is immediate and cross-company transitions fail closed', () => {
  const disabled=step(runtime({lifecycle_state:'PAUSED'}),'DISABLE');
  assert.equal(disabled.runtime.lifecycle_state,'DISABLED');
  assert.throws(() => transitionTitanWorkforceLifecycle(runtime({lifecycle_state:'ENABLED'}),'PAUSE',{company_id:'company-2'}), /cross-company/);
});

test('invalid lifecycle shortcuts are rejected', () => {
  assert.throws(() => step(runtime(),'PAUSE'), /pause-invalid-from/);
  assert.throws(() => step(runtime({lifecycle_state:'ENABLED'}),'ENABLE'), /enable-invalid-from/);
  assert.throws(() => step(runtime({lifecycle_state:'DISABLED'}),'RESUME'), /resume-invalid-from/);
});
