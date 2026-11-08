import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  createMigrationCoordinator,
  createCompanyCheckpointFacade,
  createBusinessStateAuthority,
  createBackupRecoveryService,
  createStorageAuthorityDiagnostics,
} from '../.test-dist/storage/index.js';

const ctx=(company_id='company-a', extra={})=>({
  company_id,actor_id:'actor-1',operation_id:'regression-op',...extra
});

test('concurrent migration invocation runs a stage exactly once and the peer skips',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  const migrations=createMigrationCoordinator({repository,clock:()=>1000});
  let calls=0;
  let release;
  const gate=new Promise((resolve)=>{release=resolve});
  const migration={
    id:'009-concurrency',
    version:1,
    checksum:'same',
    up:async()=>{calls+=1; await gate; return {ok:true}},
  };
  const a=migrations.run(ctx(),migration);
  const b=migrations.run(ctx(),migration);
  await new Promise((resolve)=>setTimeout(resolve,5));
  release();
  const results=await Promise.all([a,b]);
  assert.equal(calls,1);
  assert.deepEqual(results.map((r)=>r.status).sort(),['applied','skipped']);
});

test('failed migration remains retryable after coordinator recreation on same adapter',async()=>{
  const adapter=createMemoryStorageAdapter();
  const repo1=createCompanyRepository({adapter,clock:()=>1000});
  const first=createMigrationCoordinator({repository:repo1,clock:()=>1000});
  let attempts=0;
  const migration={id:'009-restart-migration',version:1,checksum:'x',up:async()=>{
    attempts+=1;
    if(attempts===1) throw new Error('first failure');
  }};
  await assert.rejects(()=>first.run(ctx(),migration),/first failure/);
  const repo2=createCompanyRepository({adapter,clock:()=>2000});
  const second=createMigrationCoordinator({repository:repo2,clock:()=>2000});
  const result=await second.run(ctx(),migration);
  assert.equal(result.status,'applied');
  assert.equal(attempts,2);
});

test('company checkpoint survives repository/service recreation and never crosses companies',async()=>{
  const adapter=createMemoryStorageAdapter();
  const repo1=createCompanyRepository({adapter,clock:()=>1000});
  const cp1=createCompanyCheckpointFacade({repository:repo1,company_id:'company-a'});
  await cp1.put({operation_id:'restart-1',data:{state:'pending'}});
  const repo2=createCompanyRepository({adapter,clock:()=>2000});
  const cp2=createCompanyCheckpointFacade({repository:repo2,company_id:'company-a'});
  assert.equal((await cp2.get('restart-1')).data.state,'pending');
  const cpB=createCompanyCheckpointFacade({repository:repo2,company_id:'company-b'});
  assert.equal(await cpB.get('restart-1'),null);
});

test('simultaneous business-state writes with the same expected revision produce one commit and one durable conflict',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  const authority=createBusinessStateAuthority({repository,clock:()=>1000});
  const one=authority.commit(ctx('company-a',{idempotency_key:'c1'}),'jobs',{id:'j1',value:1},{entity_id:'j1',expected_revision:0});
  const two=authority.commit(ctx('company-a',{idempotency_key:'c2'}),'jobs',{id:'j1',value:2},{entity_id:'j1',expected_revision:0});
  const results=await Promise.all([one,two]);
  assert.equal(results.filter((r)=>r.committed).length,1);
  assert.equal(results.filter((r)=>r.conflict && r.reason==='revision_mismatch').length,1);
  assert.equal((await authority.listConflicts(ctx())).length,1);
});

test('cross-company nested payload corruption is rejected before persistence',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  await assert.rejects(
    ()=>repository.put(ctx('company-a'),{
      module_id:'crm',collection:'customers',record_id:'x',
      data:{nested:{company_id:'company-b'}}
    }),
    /cross-company/i
  );
  assert.equal((await repository.list(ctx('company-a'))).length,0);
});

test('backup tamper is rejected after service restart and current data remains intact',async()=>{
  const adapter=createMemoryStorageAdapter();
  const repo1=createCompanyRepository({adapter,clock:()=>1000});
  const service1=createBackupRecoveryService({repository:repo1,clock:()=>1000});
  await repo1.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Safe'}});
  const backup=await service1.exportCompany(ctx());
  backup.records[0].data.name='Corrupt';
  const repo2=createCompanyRepository({adapter,clock:()=>2000});
  const service2=createBackupRecoveryService({repository:repo2,clock:()=>2000});
  await assert.rejects(()=>service2.restoreCompany(ctx(),backup,{mode:'replace'}),/checksum mismatch/i);
  assert.equal((await repo2.get(ctx(),'crm','customers','c1')).data.name,'Safe');
});

test('legacy company aliases remain rejected across migration, checkpoint, repository and recovery contexts',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  const migration=createMigrationCoordinator({repository,clock:()=>1000});
  await assert.rejects(
    ()=>migration.run({...ctx(),tenant_company_id:'legacy'},{id:'legacy',version:1,checksum:'l',up:async()=>{}}),
    /legacy tenant/i
  );
  await assert.rejects(
    ()=>repository.put({...ctx(),tenant_id:'legacy'},{module_id:'crm',collection:'c',record_id:'1',data:{}}),
    /legacy/i
  );
  const service=createBackupRecoveryService({repository,clock:()=>1000});
  await assert.rejects(
    ()=>service.exportCompany({...ctx(),tenant_company_id:'legacy'}),
    /legacy/i
  );
});

test('corrupted backup cannot smuggle authority or foreign company identity through nested fields',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  const service=createBackupRecoveryService({repository,clock:()=>1000});
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'A'}});
  const backup=await service.exportCompany(ctx());
  backup.records[0].data={company_id:'company-b',execution_authority:true};
  backup.record_count=1;
  assert.throws(()=>service.verifyBackup(backup,{company_id:'company-a'}),/cross-company|checksum/i);
});


test('storage authority diagnostics are read-only and inventory native authority surfaces',async()=>{
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'A'}});
  const before=await repository.list(ctx());
  const diagnostics=createStorageAuthorityDiagnostics({repository});
  const snapshot=await diagnostics.inspect(ctx());
  const after=await repository.list(ctx());
  assert.equal(snapshot.company_id,'company-a');
  assert.equal(snapshot.health,'healthy');
  assert.equal(snapshot.readonly_transaction_canary,'PASS');
  assert.equal(snapshot.record_count,1);
  assert.equal(snapshot.capabilities.migration_checkpoints,true);
  assert.equal(snapshot.capabilities.reconciliation_conflicts,true);
  assert.equal(snapshot.capabilities.business_receipts,true);
  assert.deepEqual(after,before);
});

test('storage diagnostics flag malformed observed record envelopes without granting authority',async()=>{
  const base=createMemoryStorageAdapter();
  await base.put({
    pk:'corrupt',
    company_id:'company-a',
    module_id:'crm',
    collection:'customers',
    record_id:'c1',
    version:0,
    created_at:1000,
    updated_at:1000,
    deleted:false,
    data:{name:'bad'},
    actor_id:null,
    operation_id:null,
  });
  const repository=createCompanyRepository({adapter:base,clock:()=>1000});
  const diagnostics=createStorageAuthorityDiagnostics({repository});
  const snapshot=await diagnostics.inspect(ctx());
  assert.equal(snapshot.health,'degraded');
  assert.ok(snapshot.drift.some((d)=>d.code==='INVALID_VERSION'));
  assert.equal(diagnostics.descriptor.identity_grants_authority,false);
  assert.equal(diagnostics.descriptor.execution_authority,false);
});
