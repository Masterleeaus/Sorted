import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  createBackupRecoveryService,
} from '../.test-dist/storage/index.js';

const ctx=(company_id='company-a')=>({company_id,actor_id:'owner-1',operation_id:'backup-op'});

function setup(){
  const repository=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  const service=createBackupRecoveryService({repository,clock:()=>1000});
  return {repository,service};
}

test('export contains only the requested company and validates successfully',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx('company-a'),{module_id:'crm',collection:'customers',record_id:'a1',data:{name:'A'}});
  await repository.put(ctx('company-b'),{module_id:'crm',collection:'customers',record_id:'b1',data:{name:'B'}});
  const backup=await service.exportCompany(ctx('company-a'));
  assert.equal(backup.company_id,'company-a');
  assert.equal(backup.records.length,1);
  assert.equal(backup.records[0].company_id,'company-a');
  assert.equal(service.verifyBackup(backup,{company_id:'company-a'}).valid,true);
});

test('tampered backup checksum is rejected fail-closed',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx(),{module_id:'jobs',collection:'jobs',record_id:'j1',data:{status:'open'}});
  const backup=await service.exportCompany(ctx());
  backup.records[0].data.status='tampered';
  assert.throws(()=>service.verifyBackup(backup,{company_id:'company-a'}),/checksum mismatch/i);
});

test('cross-company restore is rejected',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx('company-a'),{module_id:'crm',collection:'customers',record_id:'a1',data:{name:'A'}});
  const backup=await service.exportCompany(ctx('company-a'));
  await assert.rejects(()=>service.restoreCompany(ctx('company-b'),backup),/cross-company backup/i);
});

test('dry-run restore changes nothing but returns a recovery plan',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx(),{module_id:'jobs',collection:'jobs',record_id:'j1',data:{status:'open'}});
  const backup=await service.exportCompany(ctx());
  await repository.put(ctx(),{module_id:'jobs',collection:'jobs',record_id:'j2',data:{status:'new'}});
  const plan=await service.restoreCompany(ctx(),backup,{dry_run:true,mode:'replace'});
  assert.equal(plan.status,'dry_run');
  assert.equal(plan.backup_records,1);
  assert.equal(plan.current_records,2);
  assert.equal((await repository.list(ctx())).length,2);
});

test('replace restore removes later records and restores backup payloads atomically',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Before'}});
  const backup=await service.exportCompany(ctx());
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'After'}});
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c2',data:{name:'Later'}});
  const result=await service.restoreCompany(ctx(),backup,{mode:'replace'});
  assert.equal(result.status,'restored');
  const rows=await repository.list(ctx());
  assert.equal(rows.length,1);
  assert.equal(rows[0].record_id,'c1');
  assert.equal(rows[0].data.name,'Before');
});

test('merge restore preserves records not present in backup',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Backup'}});
  const backup=await service.exportCompany(ctx());
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c2',data:{name:'Keep'}});
  await service.restoreCompany(ctx(),backup,{mode:'merge'});
  const rows=await repository.list(ctx());
  assert.equal(rows.length,2);
});

test('restore validation failure cannot partially overwrite current data',async()=>{
  const {repository,service}=setup();
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Current'}});
  const backup=await service.exportCompany(ctx());
  backup.records.push({...backup.records[0],record_id:'c2',pk:'bad-pk',company_id:'company-b'});
  await assert.rejects(()=>service.restoreCompany(ctx(),backup,{mode:'replace'}),/cross-company|checksum|record count/i);
  const current=await repository.get(ctx(),'crm','customers','c1');
  assert.equal(current.data.name,'Current');
});

test('restore write failure rolls back all changes',async()=>{
  const base=createMemoryStorageAdapter();
  let puts=0;
  const failing={
    get:base.get.bind(base),
    listByCompany:base.listByCompany.bind(base),
    getIdempotency:base.getIdempotency.bind(base),
    putIdempotency:base.putIdempotency.bind(base),
    delete:base.delete.bind(base),
    put:base.put.bind(base),
    async transaction(work){
      return base.transaction(async()=>{
        const tx={
          get:base.get.bind(base),
          listByCompany:base.listByCompany.bind(base),
          getIdempotency:base.getIdempotency.bind(base),
          putIdempotency:base.putIdempotency.bind(base),
          delete:base.delete.bind(base),
          async put(record){
            puts+=1;
            if(puts===3) throw new Error('restore write failed');
            return base.put(record);
          },
        };
        return work(tx);
      });
    },
  };
  const repository=createCompanyRepository({adapter:failing,clock:()=>1000});
  const service=createBackupRecoveryService({repository,clock:()=>1000});
  await repository.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Current'}});
  const clean=createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000});
  await clean.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c1',data:{name:'Backup1'}});
  await clean.put(ctx(),{module_id:'crm',collection:'customers',record_id:'c2',data:{name:'Backup2'}});
  const cleanService=createBackupRecoveryService({repository:clean,clock:()=>1000});
  const backup=await cleanService.exportCompany(ctx());
  await assert.rejects(()=>service.restoreCompany(ctx(),backup,{mode:'replace'}),/restore write failed/);
  const rows=await repository.list(ctx());
  assert.equal(rows.length,1);
  assert.equal(rows[0].data.name,'Current');
});

test('backup/recovery service is authority-neutral',()=>{
  const {service}=setup();
  assert.equal(service.descriptor.company_boundary,'company_id');
  assert.equal(service.descriptor.identity_grants_authority,false);
  assert.equal(service.descriptor.execution_authority,false);
  assert.equal(service.descriptor.transaction_required,true);
});
