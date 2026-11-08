import test from 'node:test';
import assert from 'node:assert/strict';
import {runDispatchGoldenEvaluation,summarizeDispatchGoldenEvaluation} from '../titan-workforce/dispatch/dispatch-golden-evaluation-runtime.mjs';

const company_id='co-gold';
const graph={schema:'titan.workforce.graph.v1',company_id,nodes:[
 {node_id:'worker:w1',company_id,kind:'worker',label:'Worker 1',attributes:{actor_type:'human'}},
 {node_id:'worker:w2',company_id,kind:'worker',label:'Worker 2',attributes:{actor_type:'human'}}
],edges:[
 {company_id,type:'HAS_CAPABILITY',from:'worker:w1',to:'capability:cleaning'},
 {company_id,type:'HAS_CAPABILITY',from:'worker:w2',to:'capability:cleaning'}
]};
const capacity={schema:'titan.workforce.workload-capacity.v1',company_id,worker_capacity:[{worker_id:'w1',available_units:4,utilization:.2,state:'BALANCED'},{worker_id:'w2',available_units:2,utilization:.4,state:'BALANCED'}]};
const work={company_id,work_item_id:'job-1',state:'ready',priority:5,required_capabilities:['cleaning'],required_human:true,demand_units:1,service_window_start_ms:1700000000000,service_window_end_ms:1700003600000,location:{lat:-37.81,lng:144.96}};
const base={company_id,graph,capacity_snapshot:capacity,work_item:work,worker_availability:[{company_id,worker_id:'w1',start_ms:1699999000000,end_ms:1700007200000,available:true}],worker_locations:[{company_id,worker_id:'w1',lat:-37.82,lng:144.97}],origin:{company_id,lat:-37.82,lng:144.97},destination:{company_id,lat:-37.81,lng:144.96},now:1700000000000,now_ms:1699999900000,canonical_job_revision:3};

test('golden happy path remains governed, local-first and authority neutral',()=>{const r=runDispatchGoldenEvaluation({...base,confirmed:true,confirmation_refs:['human-confirm-1'],actor_id:'owner-1',authority_context:{company_id,worker:{worker_id:'owner-1'}},events:[{company_id,event_id:'evt-1',source_revision:3,idempotency_key:'evt-1',payload:{status:'ready'}}]});assert.equal(r.status,'PASS');assert.equal(r.recommendation.selected_candidate.worker_id,'w1');assert.equal(r.action_intent.state,'READY_FOR_GOVERNED_SUBMISSION');assert.equal(r.governed_submission.direct_mutation,false);assert.equal(r.travel.provider_mode,'LOCAL_GEOMETRY');assert.equal(r.travel.duration_ms,null);assert.equal(r.execution_permitted,false);});

test('missing confirmation forces review and never submits',()=>{const r=runDispatchGoldenEvaluation({...base,confirmed:false});assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.action_intent.state,'AWAITING_CONFIRMATION');assert.equal(r.governed_submission,null);});

test('duplicate event suppresses downstream confidence and never replays',()=>{const e={company_id,event_id:'dup',source_revision:3,idempotency_key:'dup',payload:{x:1}};const r=runDispatchGoldenEvaluation({...base,events:[e,{...e}]});assert.equal(r.recovery.duplicate_event_ids.includes('dup'),true);assert.equal(r.recovery.auto_replay,false);assert.equal(r.status,'REVIEW_REQUIRED');});

test('stale job event requires authoritative Jobs refresh',()=>{const r=runDispatchGoldenEvaluation({...base,events:[{company_id,event_id:'stale',source_revision:2,idempotency_key:'stale'}]});assert.equal(r.recovery.requires_authoritative_refresh,true);assert.equal(r.canonical_jobs_owned_elsewhere,true);assert.equal(r.status,'REVIEW_REQUIRED');});

test('settings cannot turn on automatic dispatch, send or replay',()=>{const r=runDispatchGoldenEvaluation({...base,dispatchSettings:{automatic_assignment:true,automatic_reassignment:true,automatic_customer_contact:true,automatic_effect_replay:true,execution_permitted:true,grants_authority:true}});assert.equal(r.policy.automatic_assignment,false);assert.equal(r.policy.automatic_reassignment,false);assert.equal(r.policy.automatic_customer_contact,false);assert.equal(r.policy.automatic_effect_replay,false);assert.equal(r.policy.execution_permitted,false);});

test('same-day change is projected only after clean recovery and still sends nothing',()=>{const r=runDispatchGoldenEvaluation({...base,events:[{company_id,event_id:'evt-2',source_revision:3,idempotency_key:'evt-2'}],change_event:{company_id,event_id:'evt-2'},change_kind:'STATUS_CHANGED',change_at:1700000000000,service_at:1700000000000,assignment:{company_id,worker_id:'w1'},customer:{company_id,customer_id:'c1'},worker_refs:['w1'],customer_refs:['c1']});assert.equal(r.propagation.state,'PROJECTED');assert.equal(r.propagation.automatic_send,false);assert.equal(r.propagation.customer_projection.outbound_send_requested,false);});

test('BYO settings never authorize Titan-funded travel provider',()=>{const r=runDispatchGoldenEvaluation({...base,dispatchSettings:{travel_mode:'BYO_PROVIDER',allow_external_provider:true},provider_id:'p1',providers:[{provider_id:'p1',company_id,billing_owner:'TITAN',billable_to_titan:true,credential_ref:'vault:p1'}],cost_acknowledged:true});const c=r.checks.find(x=>x.name==='travel-cost-sovereignty');assert.equal(c.status,'REVIEW');assert.match(c.evidence.error,/titan-funded-provider-forbidden/);assert.equal(r.execution_permitted,false);assert.equal(r.grants_authority,false);});

test('cross-company evidence fails closed',()=>{assert.throws(()=>runDispatchGoldenEvaluation({...base,work_item:{...work,company_id:'other'}}),/cross-company-work-item/);assert.throws(()=>runDispatchGoldenEvaluation({...base,events:[{company_id:'other',event_id:'x'}]}),/cross-company/);});

test('legacy tenant boundary fails closed recursively',()=>{assert.throws(()=>runDispatchGoldenEvaluation({...base,dispatchSettings:{nested:{tenant_company_id:'legacy'}}}),/legacy-company-boundary/);});

test('summary exposes certification state without authority',()=>{const s=summarizeDispatchGoldenEvaluation(runDispatchGoldenEvaluation(base));assert.equal(s.company_id,company_id);assert.equal(s.execution_permitted,false);assert.equal(s.grants_authority,false);assert.equal(s.automatic_assignment,false);});
