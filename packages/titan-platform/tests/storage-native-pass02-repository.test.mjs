import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  STORAGE_PROTOCOL,
} from '../.test-dist/storage/index.js';

const ctx=(company_id='company-a')=>({company_id,actor_id:'actor-1',operation_id:'op-1'});

test('company repository stores and reads records only inside canonical company_id boundary',async()=>{
  const adapter=createMemoryStorageAdapter();
  const repo=createCompanyRepository({adapter});
  const written=await repo.put(ctx(),{
    module_id:'crm',collection:'customers',record_id:'c1',
    data:{company_id:'company-a',name:'A'}
  });
  assert.equal(written.company_id,'company-a');
  assert.equal(written.version,1);
  assert.equal((await repo.get(ctx(),'crm','customers','c1')).data.name,'A');
  assert.equal(await repo.get(ctx('company-b'),'crm','customers','c1'),null);
});

test('cross-company payloads and legacy tenant boundaries fail closed',async()=>{
  const repo=createCompanyRepository({adapter:createMemoryStorageAdapter()});
  await assert.rejects(()=>repo.put(ctx(),{
    module_id:'crm',collection:'customers',record_id:'c1',
    data:{company_id:'company-b'}
  }),/cross-company/i);
  await assert.rejects(()=>repo.put({tenant_id:'legacy'},{
    module_id:'crm',collection:'customers',record_id:'c1',data:{}
  }),/company_id|legacy tenant/i);
  await assert.rejects(()=>repo.put(ctx(),{
    module_id:'crm',collection:'customers',record_id:'c1',
    data:{tenant_company_id:'legacy'}
  }),/legacy tenant/i);
});

test('idempotency is company scoped and retries do not create extra versions',async()=>{
  const repo=createCompanyRepository({adapter:createMemoryStorageAdapter()});
  const c={...ctx(),idempotency_key:'idem-1'};
  const one=await repo.put(c,{module_id:'jobs',collection:'jobs',record_id:'j1',data:{x:1}});
  const two=await repo.put(c,{module_id:'jobs',collection:'jobs',record_id:'j1',data:{x:999}});
  assert.equal(one.version,1);
  assert.equal(two.version,1);
  assert.equal(two.data.x,1);

  const other=await repo.put({...ctx('company-b'),idempotency_key:'idem-1'},{
    module_id:'jobs',collection:'jobs',record_id:'j1',data:{x:2}
  });
  assert.equal(other.company_id,'company-b');
});

test('optimistic revision conflicts fail closed instead of overwriting newer data',async()=>{
  const repo=createCompanyRepository({adapter:createMemoryStorageAdapter()});
  await repo.put(ctx(),{module_id:'quotes',collection:'quotes',record_id:'q1',data:{amount:10}});
  const two=await repo.put(ctx(),{
    module_id:'quotes',collection:'quotes',record_id:'q1',expected_revision:1,data:{amount:20}
  });
  assert.equal(two.version,2);
  await assert.rejects(()=>repo.put(ctx(),{
    module_id:'quotes',collection:'quotes',record_id:'q1',expected_revision:1,data:{amount:30}
  }),/revision conflict/i);
});

test('repository is storage authority neutral and does not grant execution authority',()=>{
  const repo=createCompanyRepository({adapter:createMemoryStorageAdapter()});
  assert.equal(repo.descriptor.protocol,STORAGE_PROTOCOL);
  assert.equal(repo.descriptor.company_boundary,'company_id');
  assert.equal(repo.descriptor.identity_grants_authority,false);
  assert.equal(repo.descriptor.execution_authority,false);
});

test('list and delete remain company isolated',async()=>{
  const repo=createCompanyRepository({adapter:createMemoryStorageAdapter()});
  await repo.put(ctx('company-a'),{module_id:'crm',collection:'customers',record_id:'1',data:{name:'A'}});
  await repo.put(ctx('company-b'),{module_id:'crm',collection:'customers',record_id:'1',data:{name:'B'}});
  assert.deepEqual((await repo.list(ctx('company-a'),{module_id:'crm',collection:'customers'})).map(x=>x.data.name),['A']);
  await repo.delete(ctx('company-a'),'crm','customers','1');
  assert.equal(await repo.get(ctx('company-a'),'crm','customers','1'),null);
  assert.equal((await repo.get(ctx('company-b'),'crm','customers','1')).data.name,'B');
});
