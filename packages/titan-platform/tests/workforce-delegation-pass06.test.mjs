import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTitanDelegationEscalation,
  assertTitanDelegationEscalationBinding,
  resolveTitanDelegationEscalationApproval,
} from '../.test-dist/workforce-delegation/index.js';

const envelope={
  company_id:'co-1', delegation_id:'d-root', objective:'serve customer', inputs:{},
  authority_ceiling:'FINANCIAL', priority:'HIGH', due_at:'2026-09-13T03:00:00Z', idempotency_key:'idem-root',
  causality:{correlation_id:'corr-1',root_delegation_id:'d-root',source_event_id:'evt-1'},
  expected_outcome:{description:'resolved',evidence_required:['receipt']}
};

test('risky escalation requires manager and human by default and grants no authority',()=>{
  const e=createTitanDelegationEscalation({envelope,escalation_id:'esc-1',reason:'RISKY',summary:'high risk',requested_resolution:'review',idempotency_key:'esc-idem'});
  assert.equal(e.approval_required,'MANAGER_AND_HUMAN');
  assert.equal(e.manager_approval_required,true); assert.equal(e.human_approval_required,true);
  assert.equal(e.authority_ceiling,'FINANCIAL'); assert.equal(e.execution_permitted,false); assert.equal(e.grants_authority,false);
});

test('ambiguous escalation defaults to human review and preserves binding',()=>{
  const e=createTitanDelegationEscalation({envelope,escalation_id:'esc-2',reason:'AMBIGUOUS',summary:'unclear intent',requested_resolution:'clarify',idempotency_key:'esc-idem-2'});
  assert.equal(e.approval_required,'HUMAN');
  assert.equal(assertTitanDelegationEscalationBinding(envelope,e),true);
});

test('time-sensitive escalation requires a deadline from escalation or envelope',()=>{
  const noDue={...envelope,due_at:null};
  assert.throws(()=>createTitanDelegationEscalation({envelope:noDue,escalation_id:'esc-3',reason:'TIME_SENSITIVE',summary:'urgent',requested_resolution:'decide',idempotency_key:'x'}),/deadline-required/);
  const e=createTitanDelegationEscalation({envelope:noDue,escalation_id:'esc-4',reason:'TIME_SENSITIVE',summary:'urgent',requested_resolution:'decide',deadline_at:'2026-09-13T04:00:00Z',idempotency_key:'y'});
  assert.equal(e.deadline_at,'2026-09-13T04:00:00.000Z');
});

test('approval resolution remains non-executing and waits for all required approvers',()=>{
  const e=createTitanDelegationEscalation({envelope,escalation_id:'esc-5',reason:'RISKY',summary:'risk',requested_resolution:'approve',idempotency_key:'z'});
  const one=resolveTitanDelegationEscalationApproval({escalation:e,manager_approved:true,human_approved:false});
  assert.equal(one.approved,false); assert.equal(one.execution_permitted,false);
  const both=resolveTitanDelegationEscalationApproval({escalation:e,manager_approved:true,human_approved:true});
  assert.equal(both.approved,true); assert.equal(both.execution_permitted,false); assert.equal(both.grants_authority,false);
});

test('binding rejects company and causality tampering',()=>{
  const e=createTitanDelegationEscalation({envelope,escalation_id:'esc-6',reason:'FAILED',summary:'failed',requested_resolution:'repair',idempotency_key:'f'});
  assert.throws(()=>assertTitanDelegationEscalationBinding(envelope,{...e,company_id:'co-2'}),/company-mismatch/);
  assert.throws(()=>assertTitanDelegationEscalationBinding(envelope,{...e,correlation_id:'other'}),/correlation-mismatch/);
});
