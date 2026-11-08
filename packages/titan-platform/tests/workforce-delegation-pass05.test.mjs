import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitanDelegationHandoff, assertTitanDelegationHandoffChain } from '../.test-dist/workforce-delegation/index.js';

const parent={
  company_id:'co-1', delegation_id:'d-root', objective:'service customer', inputs:{customer_id:'c-1'},
  authority_ceiling:'FINANCIAL', priority:'HIGH', due_at:'2026-09-13T03:00:00Z', idempotency_key:'idem-root',
  causality:{correlation_id:'corr-1',root_delegation_id:'d-root',source_event_id:'evt-1'},
  expected_outcome:{description:'customer served',evidence_required:['receipt']}
};

test('handoff creates child envelope preserving company/root/correlation and contracting authority',()=>{
  const {handoff,child_envelope}=createTitanDelegationHandoff({
    parent_envelope:parent,from_candidate_id:'agent-sales',to_candidate_id:'worker-quote',to_tier:'WORKER',
    child_delegation_id:'d-child',child_objective:'prepare quote',child_idempotency_key:'idem-child',requested_authority:'PROPOSE'
  });
  assert.equal(child_envelope.company_id,'co-1');
  assert.equal(child_envelope.causality.parent_delegation_id,'d-root');
  assert.equal(child_envelope.causality.root_delegation_id,'d-root');
  assert.equal(child_envelope.causality.correlation_id,'corr-1');
  assert.equal(child_envelope.authority_ceiling,'PROPOSE');
  assert.equal(handoff.execution_permitted,false);
  assert.equal(assertTitanDelegationHandoffChain(parent,child_envelope),true);
});

test('handoff cannot widen parent authority ceiling',()=>{
  assert.throws(()=>createTitanDelegationHandoff({
    parent_envelope:{...parent,authority_ceiling:'WRITE_INTERNAL'},from_candidate_id:'a',to_candidate_id:'b',to_tier:'AGENT',
    child_delegation_id:'child-2',child_objective:'send money',child_idempotency_key:'idem-2',requested_authority:'FINANCIAL'
  }),/authority-exceeds-parent/);
});

test('chain rejects company/correlation/root tampering',()=>{
  const {child_envelope}=createTitanDelegationHandoff({
    parent_envelope:parent,from_candidate_id:'a',to_candidate_id:'b',to_tier:'AGENT',
    child_delegation_id:'child-3',child_objective:'follow up',child_idempotency_key:'idem-3',requested_authority:'PROPOSE'
  });
  assert.throws(()=>assertTitanDelegationHandoffChain(parent,{...child_envelope,company_id:'co-2'}),/company-mismatch/);
  assert.throws(()=>assertTitanDelegationHandoffChain(parent,{...child_envelope,causality:{...child_envelope.causality,correlation_id:'other'}}),/correlation-mismatch/);
  assert.throws(()=>assertTitanDelegationHandoffChain(parent,{...child_envelope,causality:{...child_envelope.causality,root_delegation_id:'other'}}),/root-mismatch/);
});

test('handoff rejects self-target and self child identity',()=>{
  assert.throws(()=>createTitanDelegationHandoff({parent_envelope:parent,from_candidate_id:'same',to_candidate_id:'same',to_tier:'AGENT',child_delegation_id:'x',child_objective:'x',child_idempotency_key:'x'}),/self-target/);
  assert.throws(()=>createTitanDelegationHandoff({parent_envelope:parent,from_candidate_id:'a',to_candidate_id:'b',to_tier:'AGENT',child_delegation_id:'d-root',child_objective:'x',child_idempotency_key:'x'}),/child-must-differ/);
});

test('handoff identity grants no authority',()=>{
  const {handoff,child_envelope}=createTitanDelegationHandoff({parent_envelope:parent,from_candidate_id:'a',to_candidate_id:'b',to_tier:'WORKER',child_delegation_id:'c5',child_objective:'x',child_idempotency_key:'i5'});
  assert.equal(handoff.grants_authority,false); assert.equal(handoff.authority_effect,false); assert.equal(handoff.execution_permitted,false);
  assert.equal(child_envelope.grants_authority,false); assert.equal(child_envelope.execution_permitted,false);
});
