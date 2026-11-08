import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryStorageAdapter,
  inferStorageBackend,
  selectStorageAdapter,
  STORAGE_BACKENDS,
} from '../.test-dist/storage/index.js';

test('backend inference reuses existing postgres/mysql URL semantics',()=>{
  assert.equal(inferStorageBackend({database_url:'postgres://localhost/titan'}),'postgres');
  assert.equal(inferStorageBackend({database_url:'postgresql://localhost/titan'}),'postgres');
  assert.equal(inferStorageBackend({database_url:'mysql://localhost/titan'}),'mysql');
  assert.equal(inferStorageBackend({database_url:'mariadb://localhost/titan'}),'mysql');
});

test('explicit supported backend wins only when it is valid',()=>{
  assert.equal(inferStorageBackend({backend:'memory'}),'memory');
  assert.equal(inferStorageBackend({backend:'indexeddb'}),'indexeddb');
  assert.throws(()=>inferStorageBackend({backend:'sqlite'}),/unsupported storage backend/i);
});

test('unsupported protocols fail closed instead of silently defaulting',()=>{
  assert.throws(()=>inferStorageBackend({database_url:'sqlite:///tmp/titan.db'}),/unsupported database protocol/i);
  assert.throws(()=>inferStorageBackend({}),/storage backend could not be determined/i);
});

test('selector requires an explicitly registered adapter factory for external databases',async()=>{
  await assert.rejects(()=>selectStorageAdapter({
    backend:'postgres',
    factories:{},
  }),/no registered adapter factory/i);

  await assert.rejects(()=>selectStorageAdapter({
    backend:'mysql',
    factories:{},
  }),/no registered adapter factory/i);
});

test('memory adapter is an explicit device-first test/runtime backend',async()=>{
  const selected=await selectStorageAdapter({backend:'memory'});
  assert.equal(selected.backend,'memory');
  assert.equal(selected.descriptor.company_boundary,'company_id');
  assert.equal(selected.descriptor.identity_grants_authority,false);
  assert.equal(selected.descriptor.execution_authority,false);
  await selected.adapter.put({
    pk:'a',company_id:'company-a',module_id:'m',collection:'c',record_id:'1',
    version:1,created_at:1,updated_at:1,deleted:false,data:null,actor_id:null,operation_id:null,
  });
  assert.equal((await selected.adapter.get('a')).company_id,'company-a');
});

test('registered SQL adapters are selected without gaining storage or execution authority',async()=>{
  const adapter=createMemoryStorageAdapter();
  const selected=await selectStorageAdapter({
    database_url:'mysql://localhost/titan',
    factories:{mysql:async()=>adapter},
  });
  assert.equal(selected.backend,'mysql');
  assert.equal(selected.adapter,adapter);
  assert.equal(selected.descriptor.authority_source,'external_policy_only');
  assert.equal(selected.descriptor.identity_grants_authority,false);
  assert.equal(selected.descriptor.execution_authority,false);
});

test('factory failure propagates fail-closed and never falls back to another backend',async()=>{
  await assert.rejects(()=>selectStorageAdapter({
    backend:'postgres',
    factories:{
      postgres:async()=>{throw new Error('postgres unavailable')},
      mysql:async()=>createMemoryStorageAdapter(),
    },
  }),/postgres unavailable/);
});

test('supported backend registry is explicit and immutable in intent',()=>{
  assert.deepEqual([...STORAGE_BACKENDS],['indexeddb','memory','mysql','postgres']);
});
