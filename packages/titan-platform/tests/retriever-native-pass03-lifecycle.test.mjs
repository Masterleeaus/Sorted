import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetrieverNativeExecutor,
  createRetrieverNativeLifecycle,
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
      work_submission: async input => { calls.push(['submit',input]); return {accepted:true}; },
      progress_observation: async input => { calls.push(['progress',input]); return {observed:true}; },
      result_delivery: async input => { calls.push(['complete',input]); return {delivered:true}; },
      cancellation: async input => { calls.push(['cancel',input]); return {cancelled:true}; },
    },
  });
  return {calls,lifecycle:createRetrieverNativeLifecycle({executor,now:()=>1_000,defaultTimeoutMs:500})};
}

test('submission creates a company-scoped native lifecycle record and never grants authority',async()=>{
  const {calls,lifecycle}=fixture();
  const result=await lifecycle.submit({
    company_id:'company-a',work_id:'work-1',correlation_id:'corr-1',operation_id:'op-1',
    idempotency_key:'idem-1',execution_gate:gate(),payload:{outcome:'prepare quote'}
  });
  assert.equal(result.state,'submitted');
  assert.equal(result.company_id,'company-a');
  assert.equal(result.deadline_at,1500);
  assert.equal(result.execution_authority,false);
  assert.equal(calls[0][0],'submit');
});

test('duplicate submission is idempotent and does not execute twice',async()=>{
  const {calls,lifecycle}=fixture();
  const req={company_id:'company-a',work_id:'work-1',idempotency_key:'idem-1',execution_gate:gate(),payload:{outcome:'x'}};
  const a=await lifecycle.submit(req);
  const b=await lifecycle.submit(req);
  assert.equal(a.revision,b.revision);
  assert.equal(calls.filter(x=>x[0]==='submit').length,1);
});

test('progress and completion migrate through native handlers and terminal state blocks further mutation',async()=>{
  const {calls,lifecycle}=fixture();
  await lifecycle.submit({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{outcome:'x'}});
  const progress=await lifecycle.progress({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{percent:50}});
  assert.equal(progress.state,'running');
  const complete=await lifecycle.complete({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{result:'done'}});
  assert.equal(complete.state,'completed');
  await assert.rejects(()=>lifecycle.cancel({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{reason:'late'}}),/terminal/i);
  assert.deepEqual(calls.map(x=>x[0]),['submit','progress','complete']);
});

test('cancellation is native, company isolated, and idempotent',async()=>{
  const {calls,lifecycle}=fixture();
  await lifecycle.submit({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{outcome:'x'}});
  const cancelled=await lifecycle.cancel({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{reason:'user'}});
  assert.equal(cancelled.state,'cancelled');
  const again=await lifecycle.cancel({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{reason:'user'}});
  assert.equal(again.revision,cancelled.revision);
  assert.equal(calls.filter(x=>x[0]==='cancel').length,1);
  assert.throws(()=>lifecycle.get({company_id:'company-b',work_id:'work-1'}),/not found/i);
});

test('timeout uses native cancellation only after deadline and is terminal/idempotent',async()=>{
  let now=1_000;
  const calls=[];
  const executor=createRetrieverNativeExecutor({handlers:{
    work_submission:async()=>({accepted:true}),
    cancellation:async input=>{calls.push(input);return {cancelled:true}},
  }});
  const lifecycle=createRetrieverNativeLifecycle({executor,now:()=>now,defaultTimeoutMs:100});
  await lifecycle.submit({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{outcome:'x'}});
  await assert.rejects(()=>lifecycle.timeout({company_id:'company-a',work_id:'work-1',execution_gate:gate()}),/deadline/i);
  now=1_101;
  const timed=await lifecycle.timeout({company_id:'company-a',work_id:'work-1',execution_gate:gate()});
  assert.equal(timed.state,'timed_out');
  const again=await lifecycle.timeout({company_id:'company-a',work_id:'work-1',execution_gate:gate()});
  assert.equal(again.revision,timed.revision);
  assert.equal(calls.length,1);
});

test('lifecycle rejects legacy tenant boundaries and cross-company mutation',async()=>{
  const {lifecycle}=fixture();
  await assert.rejects(()=>lifecycle.submit({
    company_id:'company-a',tenant_id:'legacy',work_id:'work-1',execution_gate:gate(),payload:{outcome:'x'}
  }),/legacy tenant/i);
  await lifecycle.submit({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{outcome:'x'}});
  await assert.rejects(()=>lifecycle.progress({
    company_id:'company-b',work_id:'work-1',execution_gate:gate('company-b'),payload:{percent:5}
  }),/not found/i);
});

test('idempotent retries still validate the external authority gate',async()=>{
  const {lifecycle}=fixture();
  const req={company_id:'company-a',work_id:'work-1',idempotency_key:'idem-1',execution_gate:gate(),payload:{outcome:'x'}};
  await lifecycle.submit(req);
  await assert.rejects(()=>lifecycle.submit({...req,execution_gate:{...gate(),execution_allowed:false}}),/explicitly allow execution/i);
  await lifecycle.cancel({company_id:'company-a',work_id:'work-1',execution_gate:gate(),payload:{reason:'user'}});
  await assert.rejects(()=>lifecycle.cancel({
    company_id:'company-a',work_id:'work-1',execution_gate:{...gate(),company_id:'company-b'},payload:{reason:'user'}
  }),/company_id/i);
});
