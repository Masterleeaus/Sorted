import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDelegationChain,
  extractCallLeadQualification,
  planQualifiedLeadHandoff,
  planCallerRevenueCapture,
} from '../.test-dist/workforce.js';

test('native platform exposes 70-worker five-tier delegation including voice worker',()=>{
  const r=resolveDelegationChain({company_id:'company-a',orchestrator_key:'reception',worker_id:'titan.worker.place_call_agent',task:'place customer call'});
  assert.equal(r.route_status,'READY_FOR_GOVERNED_HANDOFF');
  assert.equal(r.worker.worker_id,'titan.worker.place_call_agent');
  assert.equal(r.grants_authority,false);
});

test('call transcript qualification remains evidence, not CRM truth',()=>{
  const q=extractCallLeadQualification({company_id:'company-a',call_ref:'call-1',evidence_ref:'transcript-1',idempotency_key:'idem-1',transcript_text:'I need carpet cleaning in Thornbury tomorrow and would like a quote'});
  assert.equal(q.qualification.requested_action,'quote');
  assert.equal(q.transcript_is_evidence_not_truth,true);
  assert.equal(q.persistence_performed,false);
  assert.equal(q.execution_permitted,false);
});

test('qualified quote call produces governed quote handoff only',()=>{
  const p=planQualifiedLeadHandoff({company_id:'company-a',call_ref:'call-1',evidence_ref:'transcript-1',idempotency_key:'idem-2',service_need:'carpet cleaning',location_text:'Thornbury',timing:'tomorrow',requested_action:'quote'});
  assert.equal(p.status,'QUOTE_HANDOFF_RECOMMENDED');
  assert.equal(p.recommended_orchestrator,'quote');
  assert.equal(p.downstream_creation_performed,false);
  assert.equal(p.handoffs.at(-1).target_worker,'titan.worker.create_quote_agent');
});

test('unknown caller creates lead proposal but does not persist',()=>{
  const p=planCallerRevenueCapture({company_id:'company-a',call_ref:'call-2',idempotency_key:'idem-3',phone:'+61400000000',candidate_customers:[]});
  assert.equal(p.status,'UNKNOWN_CALLER_LEAD_PROPOSED');
  assert.equal(p.lead_creation_is_proposal,true);
  assert.equal(p.customer_creation_permitted,false);
  assert.equal(p.execution_permitted,false);
});
