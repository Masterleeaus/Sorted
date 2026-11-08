import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDispatchChangePropagation, summarizeDispatchChangePropagation } from '../titan-workforce/dispatch/dispatch-change-propagation-runtime.mjs';

const base = () => ({
  company_id:'c1',
  work_item:{company_id:'c1',work_item_id:'w1',job_id:'j1',service_start_at:1725760800000},
  assignment:{company_id:'c1',assignment_id:'a1',worker_id:'worker:1'},
  customer:{company_id:'c1',customer_id:'customer:1'},
  change_kind:'SCHEDULE_CHANGED',
  change_at:1725757200000,
  service_at:1725760800000,
  timezone_offset_minutes:600,
  event_id:'evt-1',
  correlation_id:'corr-1',
  summary:'Service moved to a later time today.'
});

test('same-day change projects worker feed and customer update without sending',()=>{
  const x=buildDispatchChangePropagation(base());
  assert.equal(x.state,'PROJECTED');
  assert.equal(x.worker_projection.routing.destination,'feed');
  assert.equal(x.customer_projection.communication_owner,'existing_customer_communication_runtime');
  assert.equal(x.customer_projection.outbound_send_requested,false);
  assert.equal(x.automatic_send,false);
  assert.equal(x.execution_permitted,false);
  assert.equal(x.grants_authority,false);
});

test('worker notification draft uses existing workforce notification lifecycle',()=>{
  const x=buildDispatchChangePropagation(base());
  assert.equal(x.notification_draft.schema,'titan.workforce.notification-escalation.v1');
  assert.equal(x.notification_draft.notifications.length,1);
  assert.deepEqual(x.notification_draft.notifications[0].recipient_refs,['worker:1']);
  assert.equal(x.notification_draft.notifications[0].notification_is_not_command,true);
});

test('customer projection does not masquerade as external message lifecycle or auto-send',()=>{
  const x=buildDispatchChangePropagation(base());
  assert.equal(x.customer_projection.projection_only,true);
  assert.equal(x.customer_projection.automatic_send,false);
  assert.equal(x.customer_projection.consent_and_channel_policy_required,true);
  assert.equal(x.customer_projection.execution_permitted,false);
});

test('non-same-day change is suppressed when same-day-only policy applies',()=>{
  const input=base(); input.service_at=input.change_at+86400000;
  const x=buildDispatchChangePropagation(input);
  assert.equal(x.state,'NOT_SAME_DAY');
  assert.equal(x.propagation_required,false);
  assert.equal(x.worker_projection,null);
  assert.equal(x.customer_projection,null);
});

test('cross-company work assignment customer and event evidence fail closed',()=>{
  for (const key of ['work_item','assignment','customer']) {
    const input=base(); input[key]={...input[key],company_id:'c2'};
    assert.throws(()=>buildDispatchChangePropagation(input),/cross-company/);
  }
  const input=base(); input.change_event={company_id:'c2',event_id:'evt-x'};
  assert.throws(()=>buildDispatchChangePropagation(input),/cross-company/);
});

test('legacy tenant authority fields are rejected',()=>{
  assert.throws(()=>buildDispatchChangePropagation({...base(),tenant_company_id:'bad'}),/legacy-company-boundary/);
});

test('cancellation raises worker notification urgency but still does not execute',()=>{
  const x=buildDispatchChangePropagation({...base(),change_kind:'CANCELLATION'});
  assert.equal(x.notification_draft.notifications[0].urgency,'HIGH');
  assert.equal(x.automatic_send,false);
  assert.equal(x.direct_mutation,false);
});

test('summary remains authority neutral',()=>{
  const s=summarizeDispatchChangePropagation(buildDispatchChangePropagation(base()));
  assert.equal(s.worker_projected,true);
  assert.equal(s.customer_projected,true);
  assert.equal(s.automatic_send,false);
  assert.equal(s.grants_authority,false);
});
