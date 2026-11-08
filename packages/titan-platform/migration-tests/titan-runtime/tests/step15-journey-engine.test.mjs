import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessDatabase } from '../../titan-local/storage/business-database.mjs';
import { BUSINESS_DB_SCHEMA } from '../../titan-local/storage/schema.mjs';

const interaction = await import('../interaction-engine/index.mjs');
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

const quoteJourney = {
  journey_id:'quote-preparation',
  name:'Quote preparation',
  surfaces:['zero'],
  initial_step_id:'capture',
  steps:[
    {step_id:'capture',kind:'interaction',transitions:[{to:'review',when:{field:'captured',equals:true}},{to:'clarify',default:true}]},
    {step_id:'clarify',kind:'interaction',transitions:[{to:'review',when:{field:'captured',equals:true}}]},
    {step_id:'review',kind:'checkpoint',transitions:[{to:'complete',when:{field:'approved',equals:true}}]},
    {step_id:'complete',kind:'terminal',terminal:true},
  ],
};

test('journey engine public runtime exists',()=>{
  assert.equal(typeof interaction.createJourneyRuntime,'function');
  assert.equal(typeof interaction.createJourneyDefinition,'function');
});

test('journey transitions are deterministic and branching uses explicit local facts', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createJourneyRuntime({database:db,clock:()=>2000});
  runtime.registerDefinition(quoteJourney);
  let state=await runtime.start(companyA,{journey_instance_id:'journey-1',journey_id:'quote-preparation',surface:'zero',conversation_id:'conv-1',session_id:'sess-1'});
  assert.equal(state.current_step_id,'capture');
  state=await runtime.advance(companyA,'journey-1',{facts:{captured:false}});
  assert.equal(state.current_step_id,'clarify');
  state=await runtime.advance(companyA,'journey-1',{facts:{captured:true}});
  assert.equal(state.current_step_id,'review');
  state=await runtime.advance(companyA,'journey-1',{facts:{approved:true}});
  assert.equal(state.current_step_id,'complete');
  assert.equal(state.status,'completed');
});

test('journey pause/resume survives runtime reconstruction without automatic progression', async()=>{
  const adapter=new MemoryAdapter();
  const db1=makeDb(adapter); await db1.open();
  const runtime1=interaction.createJourneyRuntime({database:db1,clock:()=>2100});
  runtime1.registerDefinition(quoteJourney);
  await runtime1.start(companyA,{journey_instance_id:'journey-r',journey_id:'quote-preparation',surface:'zero',conversation_id:'conv-r',session_id:'sess-r'});
  const paused=await runtime1.pause(companyA,'journey-r',{reason:'browser-suspend'});
  assert.equal(paused.status,'paused');
  await db1.close();

  const db2=makeDb(adapter); await db2.open();
  const runtime2=interaction.createJourneyRuntime({database:db2,clock:()=>3100});
  runtime2.registerDefinition(quoteJourney);
  const restored=await runtime2.load(companyA,'journey-r');
  assert.equal(restored.current_step_id,'capture');
  assert.equal(restored.status,'paused');
  const resumed=await runtime2.resume(companyA,'journey-r');
  assert.equal(resumed.status,'active');
  assert.equal(resumed.current_step_id,'capture');
  assert.equal(resumed.transition_count,0);
});

test('journey instances are company scoped and legacy tenant fields fail closed', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createJourneyRuntime({database:db});
  runtime.registerDefinition(quoteJourney);
  await runtime.start(companyA,{journey_instance_id:'journey-secure',journey_id:'quote-preparation',surface:'zero'});
  assert.equal(await runtime.load(companyB,'journey-secure'),null);
  await assert.rejects(()=>runtime.start(companyA,{journey_instance_id:'journey-legacy',journey_id:'quote-preparation',surface:'zero',metadata:{tenant_id:'legacy'}}),/tenant_id|legacy tenant boundary/);
});

test('journey state never grants execution authority and invalid transitions fail closed', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createJourneyRuntime({database:db});
  runtime.registerDefinition(quoteJourney);
  const state=await runtime.start(companyA,{journey_instance_id:'journey-safe',journey_id:'quote-preparation',surface:'zero',authority_granted:true,execution_authority:true});
  assert.equal(state.authority_neutral,true);
  assert.equal(state.execution_authority,false);
  assert.equal(state.authority_granted,false);
  await assert.rejects(()=>runtime.advance(companyA,'journey-safe',{to:'complete',facts:{approved:true}}),/explicit transition|not allowed|transition/i);
});
