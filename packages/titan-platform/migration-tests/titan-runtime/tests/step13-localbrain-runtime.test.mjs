import test from 'node:test';
import assert from 'node:assert/strict';
import {reasonWithLocalBrain} from '../interaction-engine/index.mjs';

const registry={entries:[{registry_id:'titan.native:capability:quote.create',id:'quote.create',kind:'capability',title:'Quote',description:'Prepare a quote',module_id:'titan.native',company_id:null,capabilities:['quote.create'],authority:[],permissions:[],risk_class:'LOW',mutates:true}],authority:{activation_confers_authority:false}};

test('LocalBrain resolves common request offline without granting authority',()=>{
 const out=reasonWithLocalBrain({company_id:'c1',context:{company_id:'c1',surface:'zero'},text:'please get a quote for this job',online:false},{capability_registry:registry});
 assert.equal(out.company_id,'c1');
 assert.equal(out.mode,'offline-first');
 assert.equal(out.reasoning.ready_for_decision,true);
 assert.equal(out.reasoning.authority_granted,false);
 assert.equal(out.execution_authority,false);
 assert.equal(out.audit.cloud_used,false);
});

test('LocalBrain fails closed on ambiguous or unknown request',()=>{
 const out=reasonWithLocalBrain({company_id:'c1',context:{company_id:'c1',surface:'zero'},text:'maybe something later',online:false},{capability_registry:registry});
 assert.equal(out.reasoning.ready_for_decision,false);
 assert.equal(out.escalation.status,'deferred');
 assert.equal(out.execution_authority,false);
});

test('LocalBrain rejects legacy tenant boundary',()=>{
 assert.throws(()=>reasonWithLocalBrain({company_id:'c1',tenant_id:'legacy',context:{company_id:'c1',surface:'zero'},text:'get a quote'}),/tenant_id/);
});
