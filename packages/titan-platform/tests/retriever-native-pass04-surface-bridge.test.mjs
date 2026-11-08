import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetrieverNativeExecutor,
  createRetrieverNativeLifecycle,
  createRetrieverNativeSurfaceBridge,
} from '../.test-dist/retriever/index.js';

const gate=(company_id='company-a')=>({
  company_id,
  execution_allowed:true,
  decision_id:'decision-1',
  authority_source:'policy',
  policy_version:'v1',
  approval_state:'approved',
});

function fixture(){
  const calls=[];
  const executor=createRetrieverNativeExecutor({
    handlers:{
      work_submission:async input=>{calls.push(['submit',input]);return {accepted:true}},
      progress_observation:async input=>{calls.push(['progress',input]);return {observed:true}},
      result_delivery:async input=>{calls.push(['complete',input]);return {delivered:true}},
      cancellation:async input=>{calls.push(['cancel',input]);return {cancelled:true}},
    },
  });
  const lifecycle=createRetrieverNativeLifecycle({executor,now:()=>1000,defaultTimeoutMs:500});
  return {calls,bridge:createRetrieverNativeSurfaceBridge({lifecycle})};
}

test('chat submit maps to native work submission without browser APIs',async()=>{
  const {calls,bridge}=fixture();
  const result=await bridge.handle({
    type:'retriever.chat.submit',
    company_id:'company-a',
    work_id:'work-1',
    execution_gate:gate(),
    payload:{message:'prepare quote'},
  });
  assert.equal(result.surface,'chat');
  assert.equal(result.state,'submitted');
  assert.equal(result.execution_authority,false);
  assert.equal(calls[0][0],'submit');
});

test('workflow progress and completion preserve company-scoped lifecycle',async()=>{
  const {bridge}=fixture();
  await bridge.handle({type:'retriever.chat.submit',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{message:'x'}});
  const p=await bridge.handle({type:'retriever.workflow.progress',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{percent:30}});
  assert.equal(p.surface,'workflow');
  assert.equal(p.state,'running');
  const c=await bridge.handle({type:'retriever.workflow.complete',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{result:'done'}});
  assert.equal(c.state,'completed');
});

test('surface snapshot is read-only and does not require execution authority',async()=>{
  const {bridge}=fixture();
  await bridge.handle({type:'retriever.chat.submit',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{message:'x'}});
  const snap=await bridge.handle({type:'retriever.surface.snapshot',company_id:'company-a',work_id:'work-1'});
  assert.equal(snap.state,'submitted');
  assert.equal(snap.execution_authority,false);
  assert.equal(snap.authority_required,false);
});

test('workflow cancel and timeout remain native and authority gated',async()=>{
  const {calls,bridge}=fixture();
  await bridge.handle({type:'retriever.chat.submit',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{message:'x'}});
  const cancelled=await bridge.handle({type:'retriever.workflow.cancel',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{reason:'user'}});
  assert.equal(cancelled.state,'cancelled');
  assert.equal(calls.at(-1)[0],'cancel');
});

test('bridge rejects legacy tenant boundary, unsupported message types, and cross-company reads',async()=>{
  const {bridge}=fixture();
  await assert.rejects(()=>bridge.handle({type:'retriever.chat.submit',company_id:'company-a',tenant_id:'legacy',work_id:'work-1',execution_gate:gate(),payload:{message:'x'}}),/legacy tenant/i);
  await assert.rejects(()=>bridge.handle({type:'retriever.unknown',company_id:'company-a',work_id:'work-1'}),/unsupported/i);
  await bridge.handle({type:'retriever.chat.submit',company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{message:'x'}});
  await assert.rejects(()=>bridge.handle({type:'retriever.surface.snapshot',company_id:'company-b',work_id:'work-1'}),/not found/i);
});

test('bridge descriptor is UI-neutral and explicitly donor independent',()=>{
  const {bridge}=fixture();
  const d=bridge.descriptor();
  assert.equal(d.browser_extension_required,false);
  assert.equal(d.donor_runtime_required,false);
  assert.equal(d.company_boundary,'company_id');
  assert.equal(d.identity_grants_authority,false);
  assert.deepEqual(d.supported_surfaces,['chat','workflow','side-panel-compatible']);
});
