import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetrieverNativeExecutor,
  createRetrieverNativeLifecycle,
  createRetrieverRecoverySession,
  classifyRetrieverRecoverySession,
  recoverRetrieverSession,
  createRetrieverReconnectPlan,
} from '../.test-dist/retriever/index.js';

const gate=(company_id='company-a')=>({
  company_id,
  execution_allowed:true,
  decision_id:'decision-1',
  authority_source:'policy',
  policy_version:'v1',
  approval_state:'approved',
});

function executor(){
  return createRetrieverNativeExecutor({handlers:{
    work_submission:async()=>({accepted:true}),
    progress_observation:async()=>({observed:true}),
    result_delivery:async()=>({delivered:true}),
    cancellation:async()=>({cancelled:true}),
  }});
}

test('lifecycle checkpoint restores company-scoped work after restart without restoring authority',async()=>{
  const before=createRetrieverNativeLifecycle({executor:executor(),now:()=>1000,defaultTimeoutMs:500});
  await before.submit({company_id:'company-a',work_id:'work-1',idempotency_key:'idem-1',execution_gate:gate(),payload:{outcome:'x'}});
  await before.progress({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{percent:40}});
  const checkpoint=before.checkpoint({company_id:'company-a'});

  const after=createRetrieverNativeLifecycle({executor:executor(),now:()=>1200,defaultTimeoutMs:500});
  const restored=after.restore(checkpoint);
  assert.equal(restored.restored,1);
  const record=after.get({company_id:'company-a',work_id:'work-1'});
  assert.equal(record.state,'running');
  assert.equal(record.execution_authority,false);

  await assert.rejects(()=>after.complete({
    company_id:'company-a',work_id:'work-1',
    execution_gate:{...gate(),execution_allowed:false},
    payload:{result:'done'}
  }),/explicitly allow execution/i);
});

test('restore rejects cross-company or legacy boundary checkpoints',()=>{
  const lifecycle=createRetrieverNativeLifecycle({executor:executor()});
  assert.throws(()=>lifecycle.restore({
    schema:'titan-zero-retriever-lifecycle-checkpoint/v1',
    company_id:'company-b',
    records:[],
    identity_grants_authority:false,
    execution_authority:false,
  },{company_id:'company-a'}),/company_id/i);
  assert.throws(()=>lifecycle.restore({
    schema:'titan-zero-retriever-lifecycle-checkpoint/v1',
    company_id:'company-a',
    tenant_id:'legacy',
    records:[],
    identity_grants_authority:false,
    execution_authority:false,
  }),/legacy tenant/i);
});

test('stale resumable recovery increments epoch and requires fresh negotiation and authority',()=>{
  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'device-1',
    created_at:100,last_seen_at:100,epoch:2,resumable:true,
  });
  const classification=classifyRetrieverRecoverySession(session,{
    company_id:'company-a',connection_key:'device-1',now:1000,stale_after_ms:100,
  });
  assert.equal(classification.status,'stale_resumable');
  const recovery=recoverRetrieverSession(session,{
    company_id:'company-a',connection_key:'device-1',now:1000,stale_after_ms:100,
  });
  assert.equal(recovery.recovered,true);
  assert.equal(recovery.session.epoch,3);
  assert.equal(recovery.requires_new_negotiation,true);
  assert.equal(recovery.requires_fresh_authority_evaluation,true);
  assert.equal(recovery.execution_authority,false);
});

test('connection change and cross-company recovery fail closed',()=>{
  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'device-1',
    created_at:100,last_seen_at:100,resumable:false,
  });
  const changed=recoverRetrieverSession(session,{
    company_id:'company-a',connection_key:'device-2',now:110,
  });
  assert.equal(changed.recovered,false);
  assert.equal(changed.requires_fresh_authority_evaluation,true);
  assert.throws(()=>recoverRetrieverSession(session,{
    company_id:'company-b',connection_key:'device-1',now:110,
  }),/company_id/i);
});

test('reconnect plan never auto-executes and restart forces renegotiation when recovered',()=>{
  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'device-1',
    created_at:100,last_seen_at:100,resumable:true,
  });
  const recovery=recoverRetrieverSession(session,{
    company_id:'company-a',connection_key:'device-1',now:1000,stale_after_ms:100,
  });
  const plan=createRetrieverReconnectPlan({company_id:'company-a',trigger:'restart',recovery});
  assert.ok(plan.actions.includes('restore_lifecycle_checkpoint'));
  assert.ok(plan.actions.includes('renegotiate_retriever'));
  assert.ok(plan.actions.includes('reevaluate_execution_authority'));
  assert.equal(plan.auto_execute_after_reconnect,false);
  assert.equal(plan.execution_authority,false);
});

test('current connection resumes without silently refreshing authority',()=>{
  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'device-1',
    created_at:100,last_seen_at:1000,resumable:true,
  });
  const recovery=recoverRetrieverSession(session,{
    company_id:'company-a',connection_key:'device-1',now:1010,stale_after_ms:100,
  });
  assert.equal(recovery.recovered,true);
  assert.equal(recovery.requires_new_negotiation,false);
  assert.equal(recovery.requires_fresh_authority_evaluation,false);
  const plan=createRetrieverReconnectPlan({company_id:'company-a',trigger:'transport_disconnect',recovery});
  assert.deepEqual(plan.actions,['resume_existing_session']);
  assert.equal(plan.auto_execute_after_reconnect,false);
});
