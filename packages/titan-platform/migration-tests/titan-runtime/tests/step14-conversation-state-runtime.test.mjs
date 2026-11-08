import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessDatabase} from '../../titan-local/storage/business-database.mjs';
import {BUSINESS_DB_SCHEMA} from '../../titan-local/storage/schema.mjs';
import {createConversationStateRuntime} from '../interaction-engine/index.mjs';

const clone = value => value == null ? value : structuredClone(value);
class MemoryAdapter {
  constructor(stores){ this.stores=stores ?? new Map(Object.keys(BUSINESS_DB_SCHEMA.stores).map(name=>[name,new Map()])); }
  async open(){ return this; }
  async close(){}
  async health(){ return {ok:true}; }
  async transaction(storeNames, mode, work){
    const names=[...new Set(storeNames)];
    const before=new Map(names.map(name=>[name,new Map([...this.stores.get(name)].map(([k,v])=>[k,clone(v)]))]));
    const tx={
      get:async(store,key)=>clone(this.stores.get(store).get(key)),
      put:async(store,value)=>{const item=clone(value);this.stores.get(store).set(item.pk ?? item.id ?? item.key,item);return clone(item);},
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

function makeDb(adapter){let now=1000;return createBusinessDatabase({adapter,clock:()=>++now});}
const companyA={company_id:'company-a',actor_id:'owner-a'};
const companyB={company_id:'company-b',actor_id:'owner-b'};

test('conversation/session/context survive runtime reconstruction with stable identifiers', async()=>{
  const adapter=new MemoryAdapter();
  const db1=makeDb(adapter); await db1.open();
  const runtime1=createConversationStateRuntime({database:db1,clock:()=>2000});
  await runtime1.saveConversation(companyA,{conversation_id:'conv-1',surface:'zero',turn:4,last_intent:'quote.create'});
  await runtime1.saveSession(companyA,{session_id:'sess-1',conversation_id:'conv-1',surface:'zero',status:'active',current_goal:'Prepare quote'});
  await runtime1.saveContext(companyA,{context_id:'ctx-1',session_id:'sess-1',conversation_id:'conv-1',surface:'zero',actor_id:'owner-a',device_id:'device-1',locale:'en-AU',channel:'text'});
  await db1.close();

  const db2=makeDb(adapter); await db2.open();
  const runtime2=createConversationStateRuntime({database:db2,clock:()=>3000});
  const bundle=await runtime2.loadBundle(companyA,{conversation_id:'conv-1',session_id:'sess-1',context_id:'ctx-1'});
  assert.equal(bundle.conversation.conversation_id,'conv-1');
  assert.equal(bundle.conversation.turn,4);
  assert.equal(bundle.session.session_id,'sess-1');
  assert.equal(bundle.session.conversation_id,'conv-1');
  assert.equal(bundle.context.context_id,'ctx-1');
  assert.equal(bundle.context.device_id,'device-1');
  assert.equal(bundle.authority_neutral,true);
  assert.equal(bundle.execution_authority,false);
});

test('conversation state is strictly company scoped', async()=>{
  const adapter=new MemoryAdapter(); const db=makeDb(adapter); await db.open();
  const runtime=createConversationStateRuntime({database:db});
  await runtime.saveConversation(companyA,{conversation_id:'conv-1',surface:'zero'});
  assert.equal(await runtime.loadConversation(companyB,'conv-1'),null);
  await assert.rejects(()=>runtime.saveSession(companyA,{company_id:'company-b',session_id:'sess-x',conversation_id:'conv-1',surface:'zero'}),/Cross-company|company/);
});

test('legacy tenant boundaries are rejected recursively before persistence', async()=>{
  const adapter=new MemoryAdapter(); const db=makeDb(adapter); await db.open();
  const runtime=createConversationStateRuntime({database:db});
  await assert.rejects(()=>runtime.saveContext(companyA,{context_id:'ctx-legacy',session_id:'sess-1',conversation_id:'conv-1',surface:'zero',metadata:{tenant_id:'legacy'}}),/tenant_id|legacy tenant boundary/);
});

test('session/context restoration remains authority neutral and cannot become execution authority', async()=>{
  const adapter=new MemoryAdapter(); const db=makeDb(adapter); await db.open();
  const runtime=createConversationStateRuntime({database:db});
  const session=await runtime.saveSession(companyA,{session_id:'sess-1',conversation_id:'conv-1',surface:'zero',authority_granted:true,execution_authority:true});
  assert.equal(session.data.authority_neutral,true);
  assert.equal(session.data.execution_authority,false);
  assert.equal(session.data.authority_granted,false);
});
