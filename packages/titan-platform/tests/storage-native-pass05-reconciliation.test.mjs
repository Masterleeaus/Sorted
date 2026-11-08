import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  createCompanyCheckpointFacade,
  createStorageReconciler,
} from '../.test-dist/storage/index.js';

const context=(company_id='company-a')=>({company_id,actor_id:'actor-1',operation_id:'sync-op'});

function setup(){
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  return {
    repository,
    checkpoint:createCompanyCheckpointFacade({repository,company_id:'company-a'}),
    reconciler:createStorageReconciler({repository,clock:()=>1000}),
  };
}

test('checkpoint facade binds one company and rejects cross-company content',async()=>{
  const {checkpoint}=setup();
  await checkpoint.put({
    operation_id:'op-1',
    data:{company_id:'company-a',revision:1,state:'pending'},
  });
  assert.equal((await checkpoint.get('op-1')).data.company_id,'company-a');
  await assert.rejects(()=>checkpoint.put({
    operation_id:'op-2',
    data:{company_id:'company-b'},
  }),/cross-company/i);
});

test('checkpoint facade rejects legacy tenant aliases',async()=>{
  const {checkpoint}=setup();
  await assert.rejects(()=>checkpoint.put({
    operation_id:'op-legacy',
    data:{tenant_company_id:'legacy'},
  }),/legacy tenant/i);
});

test('server newer revision replaces local state only when local has no unpushed change',async()=>{
  const {reconciler}=setup();
  await reconciler.writeLocal(context(),{
    module_id:'crm',collection:'customers',record_id:'c1',
    revision:1,data:{name:'Local'},dirty:false,
  });
  const result=await reconciler.applyRemote(context(),{
    module_id:'crm',collection:'customers',record_id:'c1',
    revision:2,data:{name:'Remote'},
  });
  assert.equal(result.status,'remote_applied');
  assert.equal(result.record.data.payload.name,'Remote');
  assert.equal(result.record.data.revision,2);
});

test('local dirty state plus newer remote revision yields explicit conflict and preserves local',async()=>{
  const {reconciler}=setup();
  await reconciler.writeLocal(context(),{
    module_id:'jobs',collection:'jobs',record_id:'j1',
    revision:2,data:{status:'local'},dirty:true,
  });
  const result=await reconciler.applyRemote(context(),{
    module_id:'jobs',collection:'jobs',record_id:'j1',
    revision:3,data:{status:'remote'},
  });
  assert.equal(result.status,'conflict');
  assert.equal(result.conflict.reason,'local_dirty_remote_advanced');
  assert.equal((await reconciler.readLocal(context(),'jobs','jobs','j1')).data.payload.status,'local');
});

test('stale remote revisions never overwrite newer local state',async()=>{
  const {reconciler}=setup();
  await reconciler.writeLocal(context(),{
    module_id:'quotes',collection:'quotes',record_id:'q1',
    revision:4,data:{amount:40},dirty:false,
  });
  const result=await reconciler.applyRemote(context(),{
    module_id:'quotes',collection:'quotes',record_id:'q1',
    revision:3,data:{amount:30},
  });
  assert.equal(result.status,'remote_stale');
  assert.equal((await reconciler.readLocal(context(),'quotes','quotes','q1')).data.revision,4);
});

test('matching remote revision acknowledges dirty local state without replacing payload',async()=>{
  const {reconciler}=setup();
  await reconciler.writeLocal(context(),{
    module_id:'invoices',collection:'invoices',record_id:'i1',
    revision:5,data:{total:50},dirty:true,
  });
  const result=await reconciler.applyRemote(context(),{
    module_id:'invoices',collection:'invoices',record_id:'i1',
    revision:5,data:{total:50},
  });
  assert.equal(result.status,'acknowledged');
  const local=await reconciler.readLocal(context(),'invoices','invoices','i1');
  assert.equal(local.data.dirty,false);
  assert.equal(local.data.payload.total,50);
});

test('same revision with divergent payload is a conflict',async()=>{
  const {reconciler}=setup();
  await reconciler.writeLocal(context(),{
    module_id:'assets',collection:'assets',record_id:'a1',
    revision:2,data:{name:'A'},dirty:true,
  });
  const result=await reconciler.applyRemote(context(),{
    module_id:'assets',collection:'assets',record_id:'a1',
    revision:2,data:{name:'B'},
  });
  assert.equal(result.status,'conflict');
  assert.equal(result.conflict.reason,'same_revision_divergence');
});

test('remote state is company scoped and cross-company payloads fail closed',async()=>{
  const {reconciler}=setup();
  await assert.rejects(()=>reconciler.applyRemote(context(),{
    company_id:'company-b',
    module_id:'crm',collection:'customers',record_id:'c1',
    revision:1,data:{},
  }),/cross-company/i);
});

test('reconciliation layer remains authority-neutral and local-primary',()=>{
  const {reconciler}=setup();
  assert.equal(reconciler.descriptor.local_primary,true);
  assert.equal(reconciler.descriptor.company_boundary,'company_id');
  assert.equal(reconciler.descriptor.identity_grants_authority,false);
  assert.equal(reconciler.descriptor.execution_authority,false);
});
