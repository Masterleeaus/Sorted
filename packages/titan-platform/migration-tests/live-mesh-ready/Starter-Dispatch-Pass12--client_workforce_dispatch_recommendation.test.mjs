import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDispatchRecommendation,toRecommendedAssignmentDecisionDraft,summarizeDispatchRecommendation} from '../titan-workforce/dispatch/dispatch-recommendation-runtime.mjs';
import {buildDispatchQueueProjection} from '../titan-workforce/dispatch/dispatch-queue-runtime.mjs';

const graph={schema:'titan.workforce.graph.v1',company_id:'co-r',nodes:[
 {node_id:'worker:w-near',company_id:'co-r',kind:'worker',label:'Near',attributes:{actor_type:'human'}},
 {node_id:'worker:w-far',company_id:'co-r',kind:'worker',label:'Far',attributes:{actor_type:'human'}},
 {node_id:'worker:w-ai',company_id:'co-r',kind:'worker',label:'AI',attributes:{actor_type:'ai'}}
],edges:[
 {company_id:'co-r',type:'HAS_CAPABILITY',from:'worker:w-near',to:'capability:cleaning'},
 {company_id:'co-r',type:'HAS_CAPABILITY',from:'worker:w-far',to:'capability:cleaning'},
 {company_id:'co-r',type:'HAS_CAPABILITY',from:'worker:w-ai',to:'capability:cleaning'}
]};
const capacity={schema:'titan.workforce.workload-capacity.v1',company_id:'co-r',worker_capacity:[
 {worker_id:'w-near',available_units:4,utilization:.3,state:'BALANCED'},
 {worker_id:'w-far',available_units:8,utilization:.2,state:'BALANCED'},
 {worker_id:'w-ai',available_units:50,utilization:.01,state:'BALANCED'}
]};
const job={company_id:'co-r',work_item_id:'j1',state:'ready',priority:8,required_capabilities:['cleaning'],required_human:true,demand_units:1,service_window_start_ms:1000,service_window_end_ms:2000,location:{lat:-37.81,lng:144.96}};
const queue=buildDispatchQueueProjection({company_id:'co-r',now_ms:900,work_items:[job],assignments:[]});

test('recommendation combines capability capacity availability time window and optional geography without assigning',()=>{
 const r=buildDispatchRecommendation({company_id:'co-r',work_item:job,queue,worker_availability:[
  {company_id:'co-r',worker_id:'w-near',start_ms:500,end_ms:3000,available:true},
  {company_id:'co-r',worker_id:'w-far',start_ms:500,end_ms:900,available:true}
 ],worker_locations:[
  {company_id:'co-r',worker_id:'w-near',lat:-37.82,lng:144.97},
  {company_id:'co-r',worker_id:'w-far',lat:-38.5,lng:145.6}
 ]},graph,capacity);
 assert.equal(r.state,'RECOMMENDED');assert.equal(r.selected_candidate.worker_id,'w-near');assert.equal(r.selected_candidate.available_for_service_window,true);
 assert.ok(r.selected_candidate.distance_km>0);assert.equal(r.automatic_assignment,false);assert.equal(r.execution_permitted,false);assert.equal(r.grants_authority,false);
 const d=toRecommendedAssignmentDecisionDraft(r);assert.equal(d.worker_id,'w-near');assert.equal(d.decision_state,'proposed');assert.equal(d.requires_approval,true);assert.equal(d.execution_permitted,false);
});

test('missing geography is neutral and deterministic rather than disqualifying',()=>{
 const input={company_id:'co-r',work_item:{...job,location:undefined},queue,worker_availability:[]};
 const a=buildDispatchRecommendation(input,graph,capacity),b=buildDispatchRecommendation(input,graph,capacity);
 assert.deepEqual(a.candidates,b.candidates);assert.equal(a.selected_candidate.worker_id,'w-far');assert.equal(a.selected_candidate.distance_km,null);
});

test('availability can fail a candidate closed for the service window without becoming scheduling authority',()=>{
 const r=buildDispatchRecommendation({company_id:'co-r',work_item:job,queue,worker_availability:[
  {company_id:'co-r',worker_id:'w-near',start_ms:0,end_ms:900,available:true},
  {company_id:'co-r',worker_id:'w-far',start_ms:0,end_ms:900,available:true}
 ]},graph,capacity);
 assert.equal(r.state,'NO_ELIGIBLE_CANDIDATE');assert.equal(r.selected_candidate,null);assert.equal(r.next_step,'ESCALATE_NO_ELIGIBLE_CANDIDATE');assert.equal(summarizeDispatchRecommendation(r).eligible_candidate_count,0);
 assert.throws(()=>toRecommendedAssignmentDecisionDraft(r),/selected-candidate-required/);
});

test('blocked queue item stays non-dispatchable even if an eligible worker exists',()=>{
 const blocked={...job,work_item_id:'j-block',dependencies:['j-missing']};
 const q=buildDispatchQueueProjection({company_id:'co-r',now_ms:900,work_items:[blocked],assignments:[]});
 const r=buildDispatchRecommendation({company_id:'co-r',work_item:blocked,queue:q},graph,capacity);
 assert.equal(r.state,'NOT_DISPATCHABLE');assert.equal(r.selected_candidate,null);assert.equal(r.next_step,'KEEP_IN_DISPATCH_QUEUE');
});

test('recommendation rejects cross-company availability, location, work and queue evidence',()=>{
 assert.throws(()=>buildDispatchRecommendation({company_id:'co-r',work_item:job,queue,worker_availability:[{company_id:'evil',worker_id:'w-near'}]},graph,capacity),/cross-company-availability/);
 assert.throws(()=>buildDispatchRecommendation({company_id:'co-r',work_item:job,queue,worker_locations:[{company_id:'evil',worker_id:'w-near'}]},graph,capacity),/cross-company-worker-location/);
 assert.throws(()=>buildDispatchRecommendation({company_id:'co-r',work_item:{...job,company_id:'evil'},queue},graph,capacity),/cross-company-work-item/);
 assert.throws(()=>buildDispatchRecommendation({company_id:'co-r',work_item:job,queue:{...queue,company_id:'evil'}},graph,capacity),/cross-company-queue/);
});
