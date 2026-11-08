import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createRetrieverNativeExecutor,
  RETRIEVER_NATIVE_DEFAULT_CAPABILITIES,
} from '../.test-dist/retriever/index.js';

const gate = {
  company_id: 'company-a',
  execution_allowed: true,
  decision_id: 'decision-1',
  authority_source: 'policy',
  policy_version: 'v1',
  approval_state: 'approved',
};

test('native Retriever negotiates version and capability intersection without granting authority', () => {
  const executor=createRetrieverNativeExecutor({
    handlers:{
      work_submission: async () => ({ accepted:true }),
      cancellation: async () => ({ cancelled:true }),
    },
  });
  const result=executor.negotiate({
    runtime:'Retriever',
    version:'1.2',
    capabilities:['work_submission','cancellation','unknown_remote_capability'],
  });
  assert.equal(result.compatible,true);
  assert.equal(result.selected_version,'1.0');
  assert.deepEqual(result.capabilities,['cancellation','work_submission']);
  assert.equal(result.execution_authority,false);
  assert.equal(result.capability_negotiation_grants_authority,false);
});

test('native Retriever fails closed on incompatible adapter major version', () => {
  const executor=createRetrieverNativeExecutor({handlers:{}});
  const result=executor.negotiate({runtime:'Retriever',version:'2.0',capabilities:['work_submission']});
  assert.equal(result.compatible,false);
  assert.equal(result.selected_version,null);
  assert.equal(result.fail_closed,true);
});

test('prepare enforces canonical company_id and external execution authority', () => {
  const executor=createRetrieverNativeExecutor({
    handlers:{work_submission: async () => ({accepted:true})},
  });
  assert.throws(()=>executor.prepare({
    tenant_id:'legacy',
    company_id:'company-a',
    capability:'work_submission',
    work_id:'work-1',
    execution_gate:gate,
    payload:{outcome:'x'},
  }),/legacy tenant/i);
  assert.throws(()=>executor.prepare({
    company_id:'company-a',
    capability:'work_submission',
    work_id:'work-1',
    execution_gate:{...gate,company_id:'company-b'},
    payload:{outcome:'x'},
  }),/company_id/i);
  assert.throws(()=>executor.prepare({
    company_id:'company-a',
    capability:'work_submission',
    work_id:'work-1',
    execution_gate:{...gate,identity_only:true},
    payload:{outcome:'x'},
  }),/identity/i);
});

test('execute invokes only a negotiated native handler and preserves authority neutrality', async () => {
  const calls=[];
  const executor=createRetrieverNativeExecutor({
    handlers:{
      work_submission: async input => {
        calls.push(input);
        return {accepted:true,native_id:'native-1'};
      },
    },
  });
  const result=await executor.execute({
    company_id:'company-a',
    capability:'work_submission',
    work_id:'work-1',
    correlation_id:'corr-1',
    operation_id:'op-1',
    idempotency_key:'idem-1',
    execution_gate:gate,
    payload:{outcome:'prepare quote'},
  });
  assert.equal(calls.length,1);
  assert.equal(calls[0].context.company_id,'company-a');
  assert.equal(calls[0].gate.company_id,'company-a');
  assert.equal(calls[0].capability,'work_submission');
  assert.equal(result.receipt.native_id,'native-1');
  assert.equal(result.transport_mode,'native_retriever');
  assert.equal(result.external_authority_consumed,true);
  assert.equal(result.executor_granted_authority,false);
  assert.equal(result.execution_authority,false);
});

test('unsupported native capability is rejected before handler execution', async () => {
  const executor=createRetrieverNativeExecutor({handlers:{}});
  await assert.rejects(()=>executor.execute({
    company_id:'company-a',
    capability:'work_submission',
    work_id:'work-1',
    execution_gate:gate,
  }),/native handler/i);
  assert.ok(RETRIEVER_NATIVE_DEFAULT_CAPABILITIES.includes('work_submission'));
});
