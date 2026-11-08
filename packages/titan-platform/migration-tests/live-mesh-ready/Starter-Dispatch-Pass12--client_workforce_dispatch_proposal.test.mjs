import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDispatchProposal,toAssignmentDecisionDraft,summarizeDispatchProposal} from '../titan-workforce/dispatch/dispatch-proposal-runtime.mjs';

const graph={
  schema:'titan.workforce.graph.v1',company_id:'co-1',nodes:[
    {node_id:'worker:w1',company_id:'co-1',kind:'worker',label:'Alex',attributes:{actor_type:'human'}},
    {node_id:'worker:w2',company_id:'co-1',kind:'worker',label:'Bot',attributes:{actor_type:'ai'}}
  ],edges:[
    {company_id:'co-1',type:'HAS_CAPABILITY',from:'worker:w1',to:'capability:cleaning'},
    {company_id:'co-1',type:'HAS_CAPABILITY',from:'worker:w1',to:'capability:keys'},
    {company_id:'co-1',type:'HAS_CAPABILITY',from:'worker:w2',to:'capability:cleaning'}
  ]
};
const capacity={schema:'titan.workforce.workload-capacity.v1',company_id:'co-1',worker_capacity:[
  {worker_id:'w1',available_units:6,utilization:.25,state:'BALANCED'},
  {worker_id:'w2',available_units:20,utilization:.1,state:'BALANCED'}
]};

test('dispatch proposes an eligible worker without granting execution authority',()=>{
  const p=buildDispatchProposal({company_id:'co-1',work_item_id:'job-7',required_capabilities:['cleaning','keys'],required_human:true,demand_units:2},graph,capacity);
  assert.equal(p.state,'PROPOSED');assert.equal(p.selected_candidate.worker_id,'w1');assert.equal(p.execution_permitted,false);assert.equal(p.grants_authority,false);assert.equal(p.automatic_assignment,false);
  const d=toAssignmentDecisionDraft(p);assert.equal(d.worker_id,'w1');assert.equal(d.decision_state,'proposed');assert.equal(d.grants_authority,false);assert.equal(d.execution_permitted,false);
});

test('dispatch rejects cross-company graph and capacity evidence',()=>{
  assert.throws(()=>buildDispatchProposal({company_id:'co-2',work_item_id:'job-7'},graph,null),/dispatch-workforce-graph-required/);
  assert.throws(()=>buildDispatchProposal({company_id:'co-1',work_item_id:'job-7'},graph,{...capacity,company_id:'co-2'}),/dispatch-cross-company-capacity-rejected/);
});

test('dispatch fails closed when no worker satisfies required capabilities',()=>{
  const p=buildDispatchProposal({company_id:'co-1',work_item_id:'job-8',required_capabilities:['licensed-electrician'],required_human:true},graph,capacity);
  assert.equal(p.state,'NO_ELIGIBLE_CANDIDATE');assert.equal(p.selected_candidate,null);assert.equal(p.next_step,'ESCALATE_NO_ELIGIBLE_CANDIDATE');assert.equal(summarizeDispatchProposal(p).eligible_candidate_count,0);
  assert.throws(()=>toAssignmentDecisionDraft(p),/dispatch-selected-candidate-required/);
});

test('dispatch ranking is deterministic and does not mutate source graph',()=>{
  const before=JSON.stringify(graph);const a=buildDispatchProposal({company_id:'co-1',work_item_id:'job-9',required_capabilities:['cleaning'],preferred_worker_ids:['w1']},graph,capacity);const b=buildDispatchProposal({company_id:'co-1',work_item_id:'job-9',required_capabilities:['cleaning'],preferred_worker_ids:['w1']},graph,capacity);
  assert.deepEqual(a.candidates,b.candidates);assert.equal(JSON.stringify(graph),before);assert.equal(a.dispatch_proposal_id,'dispatch:co-1:job-9');
});
