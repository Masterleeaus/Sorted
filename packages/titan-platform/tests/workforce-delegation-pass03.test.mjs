import test from 'node:test';
import assert from 'node:assert/strict';
import { routeTitanDelegationTask } from '../.test-dist/workforce-delegation/index.js';

const envelope = {
  company_id:'co-1', delegation_id:'d-3', objective:'route job', authority_ceiling:'WRITE_INTERNAL',
  idempotency_key:'idem-3', causality:{correlation_id:'corr-3'}, expected_outcome:{description:'job routed'}
};
const base = { company_id:'co-1', tier:'WORKER', capabilities:['jobs.write','jobs.read'], scopes:['jobs'], authority_ceiling:'WRITE_INTERNAL', max_workload:10, available:true };

test('routes to lowest-load eligible candidate deterministically',()=>{
  const r=routeTitanDelegationTask({envelope,required_capabilities:['jobs.write'],required_scopes:['jobs'],required_authority:'WRITE_INTERNAL'},[
    {...base,candidate_id:'worker-b',active_workload:5},
    {...base,candidate_id:'worker-a',active_workload:2},
  ]);
  assert.equal(r.status,'ROUTE_SELECTED'); assert.equal(r.selected_candidate_id,'worker-a'); assert.equal(r.execution_permitted,false);
});

test('rejects cross-company and insufficient authority candidates',()=>{
  const r=routeTitanDelegationTask({envelope,required_capabilities:['jobs.write'],required_scopes:['jobs']},[
    {...base,candidate_id:'x',company_id:'co-2',active_workload:0},
    {...base,candidate_id:'y',authority_ceiling:'PROPOSE',active_workload:0},
  ]);
  assert.equal(r.status,'NO_ELIGIBLE_ROUTE');
});

test('fails closed when requested authority exceeds envelope ceiling',()=>{
  assert.throws(()=>routeTitanDelegationTask({envelope,required_authority:'FINANCIAL'},[]),/exceeds-envelope/);
});

test('requires complete capability and scope match',()=>{
  const r=routeTitanDelegationTask({envelope,required_capabilities:['jobs.write','special'],required_scopes:['jobs','region:north']},[
    {...base,candidate_id:'partial',active_workload:0}
  ]);
  assert.equal(r.status,'NO_ELIGIBLE_ROUTE');
  assert.deepEqual(r.evaluated_candidates[0].reasons,['capability_mismatch','scope_mismatch']);
});

test('stable tie prefers worker then lexical id',()=>{
  const r=routeTitanDelegationTask({envelope,required_capabilities:['jobs.write'],required_scopes:['jobs']},[
    {...base,candidate_id:'agent-a',tier:'AGENT',active_workload:1},
    {...base,candidate_id:'worker-z',tier:'WORKER',active_workload:1},
    {...base,candidate_id:'worker-a',tier:'WORKER',active_workload:1},
  ]);
  assert.equal(r.selected_candidate_id,'worker-a');
});
