import test from 'node:test';
import assert from 'node:assert/strict';
import { collapseRepeatedFeedEntries } from '../feed-deduplication.mjs';
import { partitionHumanDecisionRouting } from '../feed-human-decision-routing.mjs';
import { createFeedDeliveryReplayGuard } from '../feed-delivery-replay-guard.mjs';
import { createFeedPresentationStateStore } from '../feed-presentation-state.mjs';
import { createBusinessDatabase } from '../../../titan-local/storage/business-database.mjs';
import { BUSINESS_DB_SCHEMA } from '../../../titan-local/storage/schema.mjs';

const clone=value=>value==null?value:structuredClone(value);
class MemoryAdapter {
  constructor(){this.stores=new Map(Object.keys(BUSINESS_DB_SCHEMA.stores).map(name=>[name,new Map()]));this.writeTail=Promise.resolve();}
  async open(){return this;} async close(){} async health(){return{ok:true};}
  _key(v){return v.pk??v.id??v.key;}
  async transaction(storeNames,mode,work){
    const run=async()=>{
      const names=[...new Set(storeNames)];
      const before=new Map(names.map(n=>[n,new Map([...this.stores.get(n)].map(([k,v])=>[k,clone(v)]))]));
      const tx={
        get:async(s,k)=>clone(this.stores.get(s).get(k)),
        put:async(s,v)=>{const x=clone(v);this.stores.get(s).set(this._key(x),x);return clone(x);},
        delete:async(s,k)=>this.stores.get(s).delete(k),
        getAll:async s=>[...this.stores.get(s).values()].map(clone),
        getAllByIndex:async(s,indexName,key)=>{const index=BUSINESS_DB_SCHEMA.stores[s].indexes[indexName];const fields=Array.isArray(index.keyPath)?index.keyPath:[index.keyPath];const wanted=Array.isArray(key)?key:[key];return[...this.stores.get(s).values()].filter(item=>fields.every((field,i)=>item[field]===wanted[i])).map(clone);}
      };
      try{return await work(tx);}catch(e){if(mode==='readwrite')for(const[n,m]of before)this.stores.set(n,m);throw e;}
    };
    if(mode!=='readwrite') return run();
    const result=this.writeTail.then(run,run);this.writeTail=result.then(()=>undefined,()=>undefined);return result;
  }
}
const makeDb=()=>{let now=1_000_000;return createBusinessDatabase({adapter:new MemoryAdapter(),clock:()=>++now});};
const companies=['company-a','company-b','company-c','company-d'];

test('high-volume deduplication preserves all occurrences and isolates companies/surfaces',()=>{
  const entries=[];
  for(const company_id of companies){
    for(let group=0;group<50;group++){
      for(let repeat=0;repeat<5;repeat++){
        entries.push({company_id,surface:'feed',kind:'job_event',operation_id:`op-${group}`,title:'Job update',status:'OPEN',event_id:`${company_id}-f-${group}-${repeat}`,occurred_at:new Date(1_700_000_000_000+repeat*1000).toISOString(),severity:repeat===4?'URGENT':'NORMAL'});
        entries.push({company_id,surface:'inbox',kind:'external_message',conversation_id:`conv-${group}`,title:'Customer reply',message_id:`${company_id}-i-${group}-${repeat}`,occurred_at:new Date(1_700_000_000_000+repeat*1000).toISOString(),severity:'NORMAL'});
      }
    }
  }
  assert.equal(entries.length,2000);
  const result=collapseRepeatedFeedEntries(entries);
  assert.equal(result.preserved_occurrence_count,2000);
  assert.equal(result.output_count,400);
  assert.equal(result.collapsed_count,1600);
  const scopes=new Set(result.entries.map(e=>`${e.company_id}|${e.surface}`));
  assert.equal(scopes.size,8);
  for(const item of result.entries){assert.equal(item.deduplication.occurrence_count,5);}
});

test('high-volume human routing partitions deterministically without cross-company bleed',()=>{
  for(const company_id of companies){
    const records=[];
    for(let i=0;i<400;i++){
      const mode=i%4;
      records.push({company_id,entry_id:`${company_id}-${i}`,severity:mode===1?'URGENT':'NORMAL',risk_level:mode===1?'high':'low',authority_required:mode===2,authority_requirement:mode===3?{company_id,requirement_level:'human_only',authority_required:true}:undefined});
    }
    const p=partitionHumanDecisionRouting(records,company_id);
    assert.equal(p.feed.length,100);
    assert.equal(p.decision_feed.length,100);
    assert.equal(p.approval_queue.length,100);
    assert.equal(p.human_review.length,100);
    for(const list of Object.values(p)) for(const item of list){assert.equal(item.company_id,company_id);assert.equal(item.authority_granted,false);assert.equal(item.execution_permitted,false);}
  }
});

test('delivery storm guard suppresses a 100-way concurrent duplicate burst per company/channel',async()=>{
  const database=makeDb(); await database.open();
  const guard=createFeedDeliveryReplayGuard({database,clock:()=>2_000_000});
  for(const company_id of companies){
    const context={company_id,actor_id:'stress'};
    const payload={surface:'feed',channel:'CHROME',notification_id:'same-notification',kind:'job_blocked',semantic_state:'OPEN',now:2_000_000,lease_ms:60000};
    const results=await Promise.all(Array.from({length:100},()=>guard.prepareDelivery(context,payload)));
    assert.equal(results.filter(r=>r.allowed).length,1);
    assert.equal(results.filter(r=>!r.allowed&&r.reason==='delivery-already-in-flight').length,99);
  }
});

test('delivery fingerprints keep lifecycle/channel/surface events independently deliverable',async()=>{
  const database=makeDb(); await database.open();
  const guard=createFeedDeliveryReplayGuard({database,clock:()=>3_000_000});
  const context={company_id:'company-a',actor_id:'stress'};
  const variants=[
    {surface:'feed',channel:'CHROME',semantic_state:'OPEN'},
    {surface:'feed',channel:'IN_APP',semantic_state:'OPEN'},
    {surface:'decision_feed',channel:'CHROME',semantic_state:'OPEN'},
    {surface:'feed',channel:'CHROME',semantic_state:'ACKNOWLEDGED'},
    {surface:'feed',channel:'CHROME',semantic_state:'RESOLVED'}
  ];
  const results=[];
  for(const v of variants) results.push(await guard.prepareDelivery(context,{...v,notification_id:'notif-variant',kind:'job_blocked',now:3_000_000}));
  assert.equal(results.every(r=>r.allowed),true);
});

test('presentation state sustains 1000 company-scoped transitions with identical entry ids',async()=>{
  const database=makeDb(); await database.open();
  const store=createFeedPresentationStateStore({database,clock:()=>4_000_000});
  for(const company_id of companies){
    const context={company_id,actor_id:'stress'};
    for(let i=0;i<250;i++) await store.transition(context,{surface:'feed',entry_id:`shared-${i}`,action:'MARK_READ',now:4_000_000+i});
  }
  for(const company_id of companies){
    const context={company_id,actor_id:'stress'};
    const list=await store.list(context,{surface:'feed',limit:1000});
    assert.equal(list.states.length,250);
    assert.equal(list.states.every(s=>s.company_id===company_id),true);
  }
});

test('stress paths fail closed on cross-company and legacy tenant authority attempts',async()=>{
  const database=makeDb(); await database.open();
  const guard=createFeedDeliveryReplayGuard({database});
  const store=createFeedPresentationStateStore({database});
  await assert.rejects(()=>guard.prepareDelivery({company_id:'company-a'},{company_id:'company-b',surface:'feed',channel:'IN_APP',notification_id:'x'}),/cross-company/);
  await assert.rejects(()=>store.transition({company_id:'company-a'},{surface:'feed',entry_id:'x',action:'MARK_READ',tenant_id:'legacy'}),/legacy-tenant/);
  assert.throws(()=>partitionHumanDecisionRouting([{company_id:'company-a',tenant_id:'legacy'}],'company-a'),/legacy_tenant/);
});
