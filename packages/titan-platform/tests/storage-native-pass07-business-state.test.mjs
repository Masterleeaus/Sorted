import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  createBusinessStateAuthority,
} from '../.test-dist/storage/index.js';

const ctx=(company_id='company-a', idempotency_key=null)=>({
  company_id,actor_id:'actor-1',operation_id:'op-1',idempotency_key
});

function authority(clock=()=>1000){
  return createBusinessStateAuthority({
    repository:createCompanyRepository({adapter:createMemoryStorageAdapter(),clock}),
    clock,
  });
}

test('commit creates monotonic revisions and durable committed receipts',async()=>{
  const a=authority();
  const one=await a.commit(ctx('company-a','idem-1'),'activity',{id:'a1',value:1},{entity_id:'a1'});
  const two=await a.commit(ctx('company-a','idem-2'),'activity',{id:'a1',value:2},{entity_id:'a1',expected_revision:1});
  assert.equal(one.committed,true);
  assert.equal(one.revision,1);
  assert.equal(two.revision,2);
  assert.equal((await a.read(ctx(),'activity','a1')).revision,2);
  assert.equal((await a.listReceipts(ctx())).length,2);
});

test('same idempotency key and same payload returns idempotent result',async()=>{
  const a=authority();
  const c=ctx('company-a','same-key');
  const one=await a.commit(c,'outcome',{id:'o1',value:1},{entity_id:'o1'});
  const two=await a.commit(c,'outcome',{id:'o1',value:1},{entity_id:'o1'});
  assert.equal(one.committed,true);
  assert.equal(two.idempotent,true);
  assert.equal(two.committed,false);
  assert.equal(two.revision,1);
});

test('idempotency key reuse with different payload creates durable conflict receipt',async()=>{
  const a=authority();
  const c=ctx('company-a','reuse-key');
  await a.commit(c,'activity',{id:'a1',value:1},{entity_id:'a1'});
  const conflict=await a.commit(c,'activity',{id:'a1',value:2},{entity_id:'a1'});
  assert.equal(conflict.conflict,true);
  assert.equal(conflict.reason,'idempotency_key_reused');
  assert.equal((await a.listConflicts(ctx())).length,1);
  assert.equal((await a.read(ctx(),'activity','a1')).record.value,1);
});

test('expected revision mismatch creates conflict and preserves current state',async()=>{
  const a=authority();
  await a.commit(ctx('company-a','r1'),'activity',{id:'a1',value:1},{entity_id:'a1'});
  const conflict=await a.commit(ctx('company-a','r2'),'activity',{id:'a1',value:2},{
    entity_id:'a1',expected_revision:0
  });
  assert.equal(conflict.reason,'revision_mismatch');
  assert.equal(conflict.actual_revision,1);
  assert.equal((await a.read(ctx(),'activity','a1')).revision,1);
});

test('business state is company isolated',async()=>{
  const a=authority();
  await a.commit(ctx('company-a','a'),'activity',{id:'same',value:'A'},{entity_id:'same'});
  await a.commit(ctx('company-b','b'),'activity',{id:'same',value:'B'},{entity_id:'same'});
  assert.equal((await a.read(ctx('company-a'),'activity','same')).record.value,'A');
  assert.equal((await a.read(ctx('company-b'),'activity','same')).record.value,'B');
});

test('transaction rollback prevents partial entity/receipt/summary state',async()=>{
  let n=0;
  const base=createMemoryStorageAdapter();
  const failing={
    get:base.get.bind(base),
    listByCompany:base.listByCompany.bind(base),
    getIdempotency:base.getIdempotency.bind(base),
    putIdempotency:base.putIdempotency.bind(base),
    delete:base.delete.bind(base),
    async put(record){
      n+=1;
      if(n===2) throw new Error('simulated write failure');
      return base.put(record);
    },
    async transaction(work){
      return base.transaction(async()=>{
        const tx={
          get:base.get.bind(base),
          listByCompany:base.listByCompany.bind(base),
          getIdempotency:base.getIdempotency.bind(base),
          putIdempotency:base.putIdempotency.bind(base),
          delete:base.delete.bind(base),
          put:failing.put.bind(failing),
        };
        return work(tx);
      });
    },
  };
  const repo=createCompanyRepository({adapter:failing,clock:()=>1000});
  const a=createBusinessStateAuthority({repository:repo,clock:()=>1000});
  await assert.rejects(()=>a.commit(ctx('company-a','fail'),'activity',{id:'a1'},{entity_id:'a1'}),/simulated write failure/);
  assert.equal(await a.read(ctx(),'activity','a1'),null);
  assert.equal((await a.listReceipts(ctx())).length,0);
});

test('authority descriptor is persistence-only and never grants execution authority',()=>{
  const a=authority();
  assert.equal(a.descriptor.company_boundary,'company_id');
  assert.equal(a.descriptor.identity_grants_authority,false);
  assert.equal(a.descriptor.execution_authority,false);
  assert.equal(a.descriptor.transaction_required,true);
});
