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

const quoteWizard={
  wizard_id:'quote-intake',
  name:'Quote intake',
  surfaces:['zero'],
  initial_step_id:'customer',
  steps:[
    {step_id:'customer',fields:[
      {field_id:'customer_name',type:'string',required:true,min_length:2},
      {field_id:'service_type',type:'enum',required:true,options:['cleaning','plumbing']},
    ],transitions:[
      {to:'cleaning',when:{field:'service_type',equals:'cleaning'}},
      {to:'plumbing',when:{field:'service_type',equals:'plumbing'}},
    ]},
    {step_id:'cleaning',prerequisites:[{field:'service_type',equals:'cleaning'}],fields:[
      {field_id:'bedrooms',type:'number',required:true,min:1,max:20},
    ],transitions:[{to:'review',default:true}]},
    {step_id:'plumbing',prerequisites:[{field:'service_type',equals:'plumbing'}],fields:[
      {field_id:'urgent',type:'boolean',required:true},
    ],transitions:[{to:'review',default:true}]},
    {step_id:'review',fields:[],terminal:true},
  ],
};

test('wizard engine public runtime exists',()=>{
  assert.equal(typeof interaction.createWizardRuntime,'function');
  assert.equal(typeof interaction.createWizardDefinition,'function');
});

test('wizard validates fields and branches deterministically from explicit answers', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createWizardRuntime({database:db,clock:()=>2000});
  runtime.registerDefinition(quoteWizard);
  let state=await runtime.start(companyA,{wizard_session_id:'wiz-1',wizard_id:'quote-intake',surface:'zero'});
  assert.equal(state.current_step_id,'customer');
  await assert.rejects(()=>runtime.submit(companyA,'wiz-1',{answers:{customer_name:'A',service_type:'cleaning'}}),/customer_name|min_length|validation/i);
  state=await runtime.submit(companyA,'wiz-1',{answers:{customer_name:'Alice',service_type:'cleaning'}});
  assert.equal(state.current_step_id,'cleaning');
  assert.equal(state.answers.customer_name,'Alice');
  await assert.rejects(()=>runtime.submit(companyA,'wiz-1',{answers:{bedrooms:0}}),/bedrooms|min|validation/i);
  state=await runtime.submit(companyA,'wiz-1',{answers:{bedrooms:3}});
  assert.equal(state.current_step_id,'review');
  assert.equal(state.status,'completed');
});

test('wizard pause/resume and answers survive runtime reconstruction without automatic completion', async()=>{
  const adapter=new MemoryAdapter();
  const db1=makeDb(adapter); await db1.open();
  const runtime1=interaction.createWizardRuntime({database:db1,clock:()=>2100});
  runtime1.registerDefinition(quoteWizard);
  await runtime1.start(companyA,{wizard_session_id:'wiz-r',wizard_id:'quote-intake',surface:'zero'});
  await runtime1.submit(companyA,'wiz-r',{answers:{customer_name:'Bob',service_type:'plumbing'}});
  const paused=await runtime1.pause(companyA,'wiz-r',{reason:'browser-suspend'});
  assert.equal(paused.status,'paused');
  await db1.close();

  const db2=makeDb(adapter); await db2.open();
  const runtime2=interaction.createWizardRuntime({database:db2,clock:()=>3100});
  runtime2.registerDefinition(quoteWizard);
  const restored=await runtime2.load(companyA,'wiz-r');
  assert.equal(restored.current_step_id,'plumbing');
  assert.equal(restored.answers.customer_name,'Bob');
  assert.equal(restored.status,'paused');
  const resumed=await runtime2.resume(companyA,'wiz-r');
  assert.equal(resumed.status,'active');
  assert.equal(resumed.current_step_id,'plumbing');
  assert.equal(resumed.submission_count,1);
});

test('wizard prerequisites fail closed and sessions are company scoped', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createWizardRuntime({database:db});
  runtime.registerDefinition(quoteWizard);
  await runtime.start(companyA,{wizard_session_id:'wiz-secure',wizard_id:'quote-intake',surface:'zero'});
  assert.equal(await runtime.load(companyB,'wiz-secure'),null);
  await assert.rejects(()=>runtime.start(companyA,{wizard_session_id:'wiz-legacy',wizard_id:'quote-intake',surface:'zero',metadata:{tenant_id:'legacy'}}),/tenant_id|legacy tenant boundary/);
  const plumbingOnly={...quoteWizard,wizard_id:'prereq-test',initial_step_id:'plumbing'};
  runtime.registerDefinition(plumbingOnly);
  await assert.rejects(()=>runtime.start(companyA,{wizard_session_id:'wiz-prereq',wizard_id:'prereq-test',surface:'zero'}),/prerequisite/i);
});

test('wizard state is authority-neutral and callers cannot force arbitrary navigation or completion', async()=>{
  const db=makeDb(new MemoryAdapter()); await db.open();
  const runtime=interaction.createWizardRuntime({database:db});
  runtime.registerDefinition(quoteWizard);
  const state=await runtime.start(companyA,{wizard_session_id:'wiz-safe',wizard_id:'quote-intake',surface:'zero',authority_granted:true,execution_authority:true});
  assert.equal(state.authority_neutral,true);
  assert.equal(state.execution_authority,false);
  assert.equal(state.authority_granted,false);
  await assert.rejects(()=>runtime.submit(companyA,'wiz-safe',{to:'review',answers:{customer_name:'Alice',service_type:'cleaning'}}),/explicit navigation|not allowed|override/i);
});
