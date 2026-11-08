import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitanInterfaceRuntime, PresentationComposer, presentReceipt } from '../.test-dist/interface-runtime.js';

test('interface runtime composes authority-neutral canonical surface presentation',()=>{
 const runtime=createTitanInterfaceRuntime();
 const ctx=runtime.createContext({company_id:'company-1',user_id:'user-1',product_surface:'field',domain:'jobs',capabilities:['jobs.read']});
 const tree=new PresentationComposer().compose({purpose:'job workspace',components:[{key:'job',type:'card',props:{accessibility:{name:'Job',keyboard_operable:true,focus_visible:true,target_size_px:44}}}]},ctx);
 assert.equal(tree.surface,'go'); assert.equal(tree.company_id,'company-1'); assert.equal(tree.authority_neutral,true);
});

test('receipt presenter rejects cross-company projection',()=>{
 const runtime=createTitanInterfaceRuntime();
 const ctx=runtime.createContext({company_id:'company-1',user_id:'user-1',product_surface:'zero',domain:'jobs'});
 assert.throws(()=>presentReceipt({receipt_id:'r1',company_id:'company-2',status:'accepted'},ctx),/company-mismatch/);
});

test('runtime registry rejects duplicate contribution keys',()=>{
 const runtime=createTitanInterfaceRuntime(); runtime.contributions.register({key:'jobs.card',kind:'component'});
 assert.throws(()=>runtime.contributions.register({key:'jobs.card',kind:'component'}),/duplicate-interface-contribution/);
});


test('interface runtime canonicalizes all public surface aliases and rejects unknown surfaces',()=>{
 const runtime=createTitanInterfaceRuntime();
 const base={company_id:'company-1',user_id:'user-1',domain:'jobs'};
 for (const alias of ['bos','command','owner','manager','business']) assert.equal(runtime.createContext({...base,product_surface:alias}).product_surface,'zero');
 for (const alias of ['field','worker']) assert.equal(runtime.createContext({...base,product_surface:alias}).product_surface,'go');
 assert.equal(runtime.createContext({...base,product_surface:'customer'}).product_surface,'hub');
 assert.throws(()=>runtime.createContext({...base,product_surface:'admin'}),/zero, go or hub/);
});
