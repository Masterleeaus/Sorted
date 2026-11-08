import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetrieverNativeExecutor,
  createRetrieverNativeLifecycle,
  createRetrieverNativeSurfaceBridge,
  createRetrieverRecoverySession,
  recoverRetrieverSession,
  createRetrieverReconnectPlan,
  buildRetrieverSemanticRetirementLedger,
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
} from '../.test-dist/retriever/index.js';

const gate=(company_id='company-a')=>({
  company_id,
  execution_allowed:true,
  decision_id:'decision-1',
  authority_source:'policy',
  policy_version:'v1',
  approval_state:'approved',
});

function harness(nowRef={value:1000}){
  const calls=[];
  const executor=createRetrieverNativeExecutor({
    handlers:{
      work_submission:async input=>{calls.push(['submit',input]);return {accepted:true}},
      progress_observation:async input=>{calls.push(['progress',input]);return {observed:true}},
      result_delivery:async input=>{calls.push(['complete',input]);return {delivered:true}},
      cancellation:async input=>{calls.push(['cancel',input]);return {cancelled:true}},
    },
  });
  const lifecycle=createRetrieverNativeLifecycle({
    executor, now:()=>nowRef.value, defaultTimeoutMs:500,
  });
  const bridge=createRetrieverNativeSurfaceBridge({lifecycle});
  return {calls,executor,lifecycle,bridge};
}

test('certification: company isolation blocks cross-company read, mutation, restore, and recovery',async()=>{
  const {lifecycle,bridge}=harness();
  await bridge.handle({
    type:'retriever.chat.submit',company_id:'company-a',work_id:'w1',
    execution_gate:gate('company-a'),payload:{message:'x'}
  });
  await assert.rejects(()=>bridge.handle({
    type:'retriever.workflow.progress',company_id:'company-b',work_id:'w1',
    execution_gate:gate('company-b'),payload:{percent:1}
  }),/not found/i);
  await assert.rejects(()=>bridge.handle({
    type:'retriever.surface.snapshot',company_id:'company-b',work_id:'w1'
  }),/not found/i);

  const checkpoint=lifecycle.checkpoint({company_id:'company-a'});
  const target=harness().lifecycle;
  assert.throws(()=>target.restore(checkpoint,{company_id:'company-b'}),/company_id/i);

  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'d1',last_seen_at:1
  });
  assert.throws(()=>recoverRetrieverSession(session,{
    company_id:'company-b',connection_key:'d1',now:2
  }),/company_id/i);
});

test('certification: identity never grants execution authority across submit, retry, recovery or reconnect',async()=>{
  const now={value:1000};
  const {lifecycle}=harness(now);
  await lifecycle.submit({
    company_id:'company-a',work_id:'w1',idempotency_key:'idem',
    execution_gate:gate(),payload:{outcome:'x'}
  });
  await assert.rejects(()=>lifecycle.submit({
    company_id:'company-a',work_id:'w1',idempotency_key:'idem',
    execution_gate:{...gate(),identity_only:true},payload:{outcome:'x'}
  }),/identity/i);

  const checkpoint=lifecycle.checkpoint({company_id:'company-a'});
  assert.equal(checkpoint.execution_authority,false);
  assert.equal(checkpoint.identity_grants_authority,false);

  const session=createRetrieverRecoverySession({
    company_id:'company-a',session_id:'s1',connection_key:'d1',
    last_seen_at:1,resumable:true
  });
  const recovery=recoverRetrieverSession(session,{
    company_id:'company-a',connection_key:'d1',now:1000,stale_after_ms:10
  });
  assert.equal(recovery.execution_authority,false);
  assert.equal(recovery.requires_fresh_authority_evaluation,true);
  const plan=createRetrieverReconnectPlan({
    company_id:'company-a',trigger:'restart',recovery
  });
  assert.equal(plan.auto_execute_after_reconnect,false);
  assert.equal(plan.execution_authority,false);
});

test('certification: restart checkpoint roundtrip preserves idempotency but not authority',async()=>{
  const now={value:1000};
  const before=harness(now);
  await before.lifecycle.submit({
    company_id:'company-a',work_id:'w1',idempotency_key:'idem',
    execution_gate:gate(),payload:{outcome:'x'}
  });
  await before.lifecycle.progress({
    company_id:'company-a',work_id:'w1',
    execution_gate:gate(),payload:{percent:50}
  });
  const checkpoint=before.lifecycle.checkpoint({company_id:'company-a'});

  now.value=1200;
  const after=harness(now);
  after.lifecycle.restore(checkpoint,{company_id:'company-a'});
  const restored=after.lifecycle.get({company_id:'company-a',work_id:'w1'});
  assert.equal(restored.state,'running');
  assert.equal(restored.idempotency_key,'idem');
  assert.equal(restored.execution_authority,false);

  await assert.rejects(()=>after.lifecycle.complete({
    company_id:'company-a',work_id:'w1',
    execution_gate:{...gate(),execution_allowed:false},
    payload:{result:'done'}
  }),/explicitly allow execution/i);

  const done=await after.lifecycle.complete({
    company_id:'company-a',work_id:'w1',
    execution_gate:gate(),payload:{result:'done'}
  });
  assert.equal(done.state,'completed');
});

test('certification: compatibility negotiation fails closed for incompatible major and unsupported capability',async()=>{
  const {executor}=harness();
  const incompatible=executor.negotiate({
    runtime:'Retriever',version:'2.0',capabilities:['work_submission']
  });
  assert.equal(incompatible.compatible,false);
  assert.equal(incompatible.fail_closed,true);
  await assert.rejects(()=>executor.execute({
    company_id:'company-a',
    capability:'unknown_capability',
    work_id:'w1',
    execution_gate:gate(),
  }),/unsupported native Retriever capability/i);
});

test('certification: timeout/cancellation terminal semantics survive reconnect model',async()=>{
  const now={value:1000};
  const {lifecycle}=harness(now);
  await lifecycle.submit({
    company_id:'company-a',work_id:'w1',execution_gate:gate(),
    timeout_ms:50,payload:{outcome:'x'}
  });
  now.value=1060;
  const timed=await lifecycle.timeout({
    company_id:'company-a',work_id:'w1',execution_gate:gate()
  });
  assert.equal(timed.state,'timed_out');
  await assert.rejects(()=>lifecycle.progress({
    company_id:'company-a',work_id:'w1',execution_gate:gate(),payload:{percent:90}
  }),/terminal/i);
});

test('certification: semantic retirement ledger unlocks Pass 9 only after this regression gate',()=>{
  const ledger=buildRetrieverSemanticRetirementLedger({
    native_protocol:'titan.retriever.native',
    native_version:'1.0',
    native_capabilities:[...RETRIEVER_NATIVE_DEFAULT_CAPABILITIES],
    lifecycle_paths:['work_submission','progress_observation','result_delivery','timeout','cancellation'],
    surface_paths:['chat','workflow','side-panel-compatible'],
    recovery_paths:['checkpoint','restore','restart','reconnect','stale_session'],
    company_boundary:'company_id',
    identity_grants_authority:false,
    live_donor_reference_count:0,
    live_donor_import_count:0,
    protected_hashes_present:true,
    pass8_regressions_complete:true,
  });
  assert.equal(ledger.semantic_contracts_satisfied,true);
  assert.equal(ledger.pass8_regressions_complete,true);
  assert.equal(ledger.physical_removal_allowed,true);
  assert.equal(ledger.next_gate,'PASS9_ZERO_REFERENCE_AND_ROLLBACK_GATE');
});
