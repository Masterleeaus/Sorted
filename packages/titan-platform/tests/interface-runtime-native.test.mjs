import test from 'node:test';
import assert from 'node:assert/strict';
import { createTitanInterfaceRuntime } from '../.test-dist/interface-runtime.js';

const accessibleCard = {
 key:'job',
 type:'card',
 children:[],
 props:{accessibility:{name:'Job',keyboard_operable:true,focus_visible:true,target_size_px:44}},
};

test('interface runtime composes authority-neutral canonical surface presentation',()=>{
 const runtime=createTitanInterfaceRuntime();
 const ctx=runtime.createContext({company_id:'company-1',user_id:'user-1',product_surface:'field',domain:'jobs',capabilities:['jobs.read']});
 const tree=runtime.presentation.compose({purpose:'job workspace',surface:'go',components:[accessibleCard]},ctx);
 assert.equal(tree.schema,'titan.interface.presentation-tree/v1');
 assert.equal(tree.surface,'go');
 assert.equal(tree.company_id,'company-1');
 assert.equal(tree.authority_granted,false);
 assert.equal(tree.runtime.authority_neutral,true);
 assert.equal(tree.nodes.length,1);
});

test('presentation rejects an intent whose surface does not match the context surface',()=>{
 const runtime=createTitanInterfaceRuntime();
 const ctx=runtime.createContext({company_id:'company-1',user_id:'user-1',product_surface:'zero',domain:'jobs'});
 assert.throws(()=>runtime.presentation.compose({purpose:'job workspace',surface:'go',components:[accessibleCard]},ctx),/interface_presentation_surface_mismatch/);
});

test('interface context requires a company and rejects blank company ids',()=>{
 const runtime=createTitanInterfaceRuntime();
 assert.throws(()=>runtime.createContext({company_id:'   ',user_id:'user-1',product_surface:'zero',domain:'jobs'}));
});

test('interface runtime canonicalizes all public surface aliases and rejects unknown surfaces',()=>{
 const runtime=createTitanInterfaceRuntime();
 const base={company_id:'company-1',user_id:'user-1',domain:'jobs'};
 for (const alias of ['bos','command','owner','manager','business']) assert.equal(runtime.createContext({...base,product_surface:alias}).product_surface,'zero');
 for (const alias of ['field','worker']) assert.equal(runtime.createContext({...base,product_surface:alias}).product_surface,'go');
 assert.equal(runtime.createContext({...base,product_surface:'customer'}).product_surface,'hub');
 assert.throws(()=>runtime.createContext({...base,product_surface:'admin'}),/zero, go or hub/);
});
