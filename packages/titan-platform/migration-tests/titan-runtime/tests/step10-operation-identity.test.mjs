import assert from 'node:assert/strict';
import { createOperationIdentity, transitionOperationIdentity, operationStorageRecord, operationEventFields, sameOperation } from '../operation-identity/index.mjs';
import { TitanOperationIdentityStore } from '../operation-identity/store.mjs';
class MemoryDb{
 constructor(){this.rows=new Map()}
 key(c,id){return `${c.company_id}:${id}`}
 async put(_collection,c,row){this.rows.set(this.key(c,row.id),structuredClone(row));return row}
 async get(_collection,c,id){return this.rows.get(this.key(c,id))??null}
 async list(_collection,c){return [...this.rows.values()].filter(r=>r.company_id===c.company_id)}
}
const times=['2026-09-05T02:20:00.000Z','2026-09-05T02:20:01.000Z','2026-09-05T02:20:02.000Z','2026-09-05T02:20:03.000Z']; let i=0; const now=()=>times[i++]||times.at(-1);
const op=createOperationIdentity({company_id:'co-1',operation_id:'op-1',request_id:'req-1',actor_id:'user-1',capability:'browser.form.fill'}, {now});
assert.equal(op.correlation_id,'op-1'); assert.equal(op.idempotency_key,'co-1:req-1'); assert.equal(op.state,'created');
const accepted=transitionOperationIdentity(op,'accepted',{}, {now}); const deciding=transitionOperationIdentity(accepted,'deciding',{decision_id:'dec-1'}, {now});
assert.equal(deciding.operation_id,'op-1'); assert.equal(deciding.decision_id,'dec-1'); assert.equal(operationStorageRecord(deciding).status,'deciding');
assert.equal(operationEventFields(deciding).request_id,'req-1'); assert.equal(sameOperation(op,deciding),true);
assert.throws(()=>createOperationIdentity({...op,tenant_id:'co-1'}),/legacy-tenant-authority-field/);
assert.throws(()=>transitionOperationIdentity(deciding,'created'),/invalid-operation-transition/);
assert.throws(()=>transitionOperationIdentity(deciding,'authorized',{operation_id:'op-2'}),/immutable-operation-field:operation_id/);
const store=new TitanOperationIdentityStore({database:new MemoryDb(), now});
const stored=await store.create({company_id:'co-1',operation_id:'op-2',request_id:'req-2',actor_id:'user-1',capability:'browser.click'});
const retry=await store.create({company_id:'co-1',operation_id:'op-3',request_id:'req-2',actor_id:'user-1',capability:'browser.click',idempotency_key:stored.idempotency_key});
assert.equal(retry.operation_id,'op-2');
const moved=await store.transition({company_id:'co-1'},'op-2','accepted'); assert.equal(moved.state,'accepted');
assert.equal((await store.get({company_id:'co-1'},'op-2')).company_id,'co-1'); assert.equal(await store.get({company_id:'co-2'},'op-2'),null);
console.log('Step 10 operation identity tests PASS');
