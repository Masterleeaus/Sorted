import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  createCompanyRepository,
  createMigrationCoordinator,
} from '../.test-dist/storage/index.js';

const context=(company_id='company-a')=>({company_id,actor_id:'actor-1',operation_id:'migration-op'});

function coordinator(){
  return createMigrationCoordinator({
    repository:createCompanyRepository({adapter:createMemoryStorageAdapter(),clock:()=>1000}),
    clock:()=>1000,
  });
}

test('successful migration writes a company-scoped completion checkpoint only after success',async()=>{
  const c=coordinator();
  let calls=0;
  const result=await c.run(context(),{
    id:'001-core',version:1,checksum:'abc',
    up:async()=>{calls+=1; return {rows:3}},
    down:async()=>{},
  });
  assert.equal(result.status,'applied');
  assert.equal(calls,1);
  const cp=await c.getCheckpoint(context(),'001-core');
  assert.equal(cp.company_id,'company-a');
  assert.equal(cp.version,1);
  assert.equal(cp.checksum,'abc');
  assert.equal(cp.status,'completed');
});

test('completed stage is skipped without rerunning migration body',async()=>{
  const c=coordinator();
  let calls=0;
  const migration={id:'002-skip',version:1,checksum:'hash',up:async()=>{calls+=1}};
  await c.run(context(),migration);
  const second=await c.run(context(),migration);
  assert.equal(second.status,'skipped');
  assert.equal(calls,1);
});

test('failed stage is not checkpointed and can retry cleanly',async()=>{
  const c=coordinator();
  let calls=0;
  const migration={
    id:'003-retry',version:1,checksum:'retry',
    up:async()=>{calls+=1; if(calls===1) throw new Error('temporary failure')},
  };
  await assert.rejects(()=>c.run(context(),migration),/temporary failure/);
  assert.equal(await c.getCheckpoint(context(),'003-retry'),null);
  const retry=await c.run(context(),migration);
  assert.equal(retry.status,'applied');
  assert.equal(calls,2);
});

test('migration checkpoints are company isolated',async()=>{
  const c=coordinator();
  let calls=0;
  const migration={id:'004-company',version:1,checksum:'same',up:async()=>{calls+=1}};
  await c.run(context('company-a'),migration);
  await c.run(context('company-b'),migration);
  assert.equal(calls,2);
  assert.equal((await c.getCheckpoint(context('company-a'),'004-company')).company_id,'company-a');
  assert.equal((await c.getCheckpoint(context('company-b'),'004-company')).company_id,'company-b');
});

test('same migration id with changed version or checksum fails closed',async()=>{
  const c=coordinator();
  await c.run(context(),{id:'005-drift',version:1,checksum:'one',up:async()=>{}});
  await assert.rejects(()=>c.run(context(),{id:'005-drift',version:2,checksum:'one',up:async()=>{}}),/migration compatibility conflict/i);
  await assert.rejects(()=>c.run(context(),{id:'005-drift',version:1,checksum:'two',up:async()=>{}}),/migration compatibility conflict/i);
});

test('rollback runs down first and records rollback only after success',async()=>{
  const c=coordinator();
  let downCalls=0;
  const migration={
    id:'006-rollback',version:1,checksum:'rb',
    up:async()=>{},
    down:async()=>{downCalls+=1},
  };
  await c.run(context(),migration);
  const result=await c.rollback(context(),migration,{reason:'test'});
  assert.equal(result.status,'rolled_back');
  assert.equal(downCalls,1);
  assert.equal(await c.getCheckpoint(context(),'006-rollback'),null);
  const receipts=await c.listRollbackReceipts(context());
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].migration_id,'006-rollback');
});

test('rollback failure preserves the completed checkpoint',async()=>{
  const c=coordinator();
  const migration={
    id:'007-safe',version:1,checksum:'safe',
    up:async()=>{},
    down:async()=>{throw new Error('cannot rollback')},
  };
  await c.run(context(),migration);
  await assert.rejects(()=>c.rollback(context(),migration),/cannot rollback/);
  assert.equal((await c.getCheckpoint(context(),'007-safe')).status,'completed');
});

test('rollback without down contract fails closed',async()=>{
  const c=coordinator();
  const migration={id:'008-no-down',version:1,checksum:'nd',up:async()=>{}};
  await c.run(context(),migration);
  await assert.rejects(()=>c.rollback(context(),migration),/rollback contract/i);
});

test('migration coordinator is authority neutral',()=>{
  const c=coordinator();
  assert.equal(c.descriptor.company_boundary,'company_id');
  assert.equal(c.descriptor.identity_grants_authority,false);
  assert.equal(c.descriptor.execution_authority,false);
});
