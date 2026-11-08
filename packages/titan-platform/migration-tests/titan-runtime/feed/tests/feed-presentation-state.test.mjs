import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessDatabase } from '../../../titan-local/storage/business-database.mjs';
import { BUSINESS_DB_SCHEMA } from '../../../titan-local/storage/schema.mjs';
import { createFeedPresentationStateStore, isFeedEntrySnoozed } from '../feed-presentation-state.mjs';

const clone = value => value == null ? value : structuredClone(value);
class MemoryAdapter {
  constructor(){ this.stores=new Map(Object.keys(BUSINESS_DB_SCHEMA.stores).map(name=>[name,new Map()])); }
  async open(){ return this; }
  async close(){}
  async health(){ return {ok:true}; }
  _key(value){ return value.pk ?? value.id ?? value.key; }
  async transaction(storeNames, mode, work){
    const names=[...new Set(storeNames)];
    const before=new Map(names.map(name=>[name,new Map([...this.stores.get(name)].map(([k,v])=>[k,clone(v)]))]));
    const tx={
      get:async(store,key)=>clone(this.stores.get(store).get(key)),
      put:async(store,value)=>{const item=clone(value);this.stores.get(store).set(this._key(item),item);return clone(item);},
      delete:async(store,key)=>this.stores.get(store).delete(key),
      getAll:async store=>[...this.stores.get(store).values()].map(clone),
      getAllByIndex:async(store,indexName,key)=>{
        const index=BUSINESS_DB_SCHEMA.stores[store].indexes[indexName];
        const fields=Array.isArray(index.keyPath)?index.keyPath:[index.keyPath];
        const wanted=Array.isArray(key)?key:[key];
        return [...this.stores.get(store).values()].filter(item=>fields.every((field,i)=>item[field]===wanted[i])).map(clone);
      },
    };
    try{return await work(tx);}catch(error){if(mode==='readwrite')for(const[name,map]of before)this.stores.set(name,map);throw error;}
  }
}

const make=()=>{let now=1000;const database=createBusinessDatabase({adapter:new MemoryAdapter(),clock:()=>++now});const store=createFeedPresentationStateStore({database,clock:()=>++now});return {database,store};};
const A={company_id:'company-a',actor_id:'owner-a'};
const B={company_id:'company-b',actor_id:'owner-b'};

test('read state persists across store instances through company-scoped database',async()=>{
  const {database,store}=make(); await database.open();
  await store.transition(A,{surface:'feed',entry_id:'event-1',action:'MARK_READ',now:1100});
  const restarted=createFeedPresentationStateStore({database,clock:()=>1200});
  const state=await restarted.read(A,{surface:'feed',entry_id:'event-1'});
  assert.equal(state.read_at,1100);
  assert.equal(state.company_id,'company-a');
});

test('same entry id has independent state in different companies',async()=>{
  const {database,store}=make(); await database.open();
  await store.transition(A,{surface:'feed',entry_id:'event-1',action:'MARK_READ',now:1100});
  assert.equal((await store.read(B,{surface:'feed',entry_id:'event-1'})).read_at,null);
  await store.transition(B,{surface:'feed',entry_id:'event-1',action:'MARK_READ',now:1200});
  assert.equal((await store.read(A,{surface:'feed',entry_id:'event-1'})).read_at,1100);
  assert.equal((await store.read(B,{surface:'feed',entry_id:'event-1'})).read_at,1200);
});

test('cross-company transitions and legacy tenant fields are rejected',async()=>{
  const {database,store}=make(); await database.open();
  await assert.rejects(()=>store.transition(A,{company_id:'company-b',surface:'feed',entry_id:'x',action:'MARK_READ'}),/cross-company/);
  await assert.rejects(()=>store.transition(A,{surface:'feed',entry_id:'x',action:'MARK_READ',tenant_id:'legacy'}),/legacy-tenant/);
});

test('snooze persists, expires deterministically and can be cleared',async()=>{
  const {database,store}=make(); await database.open();
  const snoozed=await store.transition(A,{surface:'feed',entry_id:'event-2',action:'SNOOZE',actor_ref:'owner-a',snoozed_until:5000,now:2000});
  assert.equal(isFeedEntrySnoozed(snoozed,3000),true);
  assert.equal(isFeedEntrySnoozed(snoozed,5001),false);
  const cleared=await store.transition(A,{surface:'feed',entry_id:'event-2',action:'UNSNOOZE',now:5100});
  assert.equal(cleared.snoozed_until,null);
});

test('presentation acknowledgement never claims notification lifecycle authority',async()=>{
  const {database,store}=make(); await database.open();
  const state=await store.transition(A,{surface:'feed',entry_id:'notification-1',action:'ACKNOWLEDGE_PRESENTATION',actor_ref:'owner-a',lifecycle_ack_ref:'notif-1',notification_lifecycle_acknowledged:true,now:3000});
  assert.equal(state.presentation_acknowledged_at,3000);
  assert.equal(state.acknowledgement_scope,'presentation_only');
  assert.equal(state.notification_lifecycle_acknowledged,true);
  assert.equal(state.acknowledgement_confers_authority,false);
  assert.equal(state.authority_neutral,true);
});

test('legacy read-id migration requires explicit same-company proof',async()=>{
  const {database,store}=make(); await database.open();
  await assert.rejects(()=>store.importLegacyReadIds(A,{read_ids:['a','b']}),/company-proof-required/);
  const result=await store.importLegacyReadIds(A,{source_company_id:'company-a',surface:'feed',read_ids:['a','b','a'],read_at:4000});
  assert.equal(result.imported_count,2);
  assert.equal((await store.read(A,{surface:'feed',entry_id:'a'})).read_at,4000);
});

import { buildWorkforceNotificationEscalation, transitionWorkforceNotification } from '../../../titan-workforce/notifications/workforce-notification-escalation-runtime.mjs';

test('workforce notification acknowledgement remains durable lifecycle authority and company scoped',async()=>{
  const {database}=make(); await database.open();
  const key={module_id:'titan.workforce',collection:'notification-escalation',record_id:'notification-escalation:company-a'};
  const built=buildWorkforceNotificationEscalation({company_id:'company-a',now:6000,notifications:[{notification_id:'notif-1',topic:'JOB_BLOCKED',urgency:'HIGH',recipient_refs:['owner-a'],ack_required:true,ack_deadline_at:9000}]});
  await database.putRecord(A,{...key,data:built,provenance:{source:'test',company_id:'company-a',authority_effect:false}});
  const acknowledged=transitionWorkforceNotification(built,{company_id:'company-a',notification_id:'notif-1',action:'ACKNOWLEDGE',actor_ref:'owner-a',now:7000});
  await database.putRecord(A,{...key,data:acknowledged,provenance:{source:'test-ack',company_id:'company-a',authority_effect:false}});
  const row=await database.getRecord(A,key);
  assert.equal(row.data.notifications[0].state,'ACKNOWLEDGED');
  assert.equal(row.data.notifications[0].acknowledged_at,7000);
  assert.equal(row.data.authority_effect,false);
  assert.equal(await database.getRecord(B,key),null);
});
