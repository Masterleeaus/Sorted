import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTitanDelegationTelemetryEvent,
  toTitanEventLedgerInput,
  buildTitanDelegationTaskHistory,
  explainTitanDelegationTrace,
} from '../.test-dist/workforce-delegation/index.js';

const envelope={company_id:'co-1',delegation_id:'d1',objective:'coordinate',inputs:{},authority_ceiling:'WRITE_INTERNAL',priority:'HIGH',idempotency_key:'idem-1',causality:{correlation_id:'corr-1',root_delegation_id:'root-1'},expected_outcome:{description:'done'}};
const ev=(over={})=>createTitanDelegationTelemetryEvent({envelope,event_id:'e1',event_type:'ROUTE_EVALUATED',occurred_at:'2026-09-13T00:00:00Z',summary:'route selected',reason_codes:['capability_match'],...over});

test('telemetry event preserves company/causal/authority bindings without granting authority',()=>{
  const e=ev();
  assert.equal(e.company_id,'co-1');
  assert.equal(e.root_delegation_id,'root-1');
  assert.equal(e.correlation_id,'corr-1');
  assert.equal(e.authority_ceiling,'WRITE_INTERNAL');
  assert.equal(e.grants_authority,false);
  assert.equal(e.execution_permitted,false);
});

test('telemetry rejects private reasoning fields and invalid event types',()=>{
  assert.throws(()=>ev({event_type:'NOPE'}),/event-type-invalid/);
  assert.throws(()=>createTitanDelegationTelemetryEvent({envelope,event_id:'x',event_type:'ROUTE_EVALUATED',occurred_at:'2026-09-13T00:00:00Z',summary:'x',chain_of_thought:'secret'}),/private-field-forbidden/);
});

test('event ledger adapter reuses canonical correlation and operation fields',()=>{
  const ledger=toTitanEventLedgerInput(ev({event_id:'ledger-1',evidence_refs:['receipt:1']}));
  assert.equal(ledger.company_id,'co-1');
  assert.equal(ledger.operation_id,'d1');
  assert.equal(ledger.correlation_id,'corr-1');
  assert.equal(ledger.source,'titan.workforce.delegation');
  assert.deepEqual(ledger.evidence_refs,['receipt:1']);
  assert.equal(ledger.payload.authority_effect,false);
});

test('task history is deterministic and derives current lifecycle state',()=>{
  const later=ev({event_id:'e2',event_type:'STATE_TRANSITION',occurred_at:'2026-09-13T00:02:00Z',state_before:'ROUTED',state_after:'CLAIMED',summary:'claimed'});
  const earlier=ev({event_id:'e0',event_type:'STATE_TRANSITION',occurred_at:'2026-09-13T00:01:00Z',state_before:'PROPOSED',state_after:'ROUTED',summary:'routed'});
  const history=buildTitanDelegationTaskHistory({envelope,events:[later,earlier]});
  assert.deepEqual(history.events.map(x=>x.event_id),['e0','e2']);
  assert.equal(history.current_state,'CLAIMED');
  assert.equal(history.read_only,true);
});

test('history fails closed on cross-company or cross-trace events',()=>{
  const foreign={...ev(),company_id:'co-2'};
  assert.throws(()=>buildTitanDelegationTaskHistory({envelope,events:[foreign]}),/company-mismatch/);
  const wrongTrace={...ev(),correlation_id:'corr-other'};
  assert.throws(()=>buildTitanDelegationTaskHistory({envelope,events:[wrongTrace]}),/correlation-mismatch/);
});

test('diagnostic explanation aggregates reason codes without hidden reasoning',()=>{
  const events=[
    ev({event_id:'e1',event_type:'ROUTE_EVALUATED',summary:'route selected',reason_codes:['capability_match']}),
    ev({event_id:'e2',event_type:'ESCALATION_CREATED',occurred_at:'2026-09-13T00:03:00Z',summary:'manager review required',reason_codes:['risky','approval_required']}),
  ];
  const diag=explainTitanDelegationTrace({envelope,events});
  assert.equal(diag.event_counts.ROUTE_EVALUATED,1);
  assert.equal(diag.event_counts.ESCALATION_CREATED,1);
  assert.deepEqual(diag.reason_codes,['approval_required','capability_match','risky']);
  assert.equal(diag.private_reasoning_persisted,false);
  assert.equal(diag.execution_permitted,false);
});
