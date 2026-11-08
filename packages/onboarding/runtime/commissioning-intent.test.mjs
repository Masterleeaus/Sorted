import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommissioningIntent, acceptCommissioningObservation } from './commissioning-intent.mjs';

const input={intent_id:'intent-1',company_id:'company-1',idempotency_key:'idem-1',correlation_id:'corr-1',authority_decision_ref:'decision-1',provider_facets:[{provider:'frappe',facet:'accounting',enabled:false}],operations:[{capability_id:'company.config.apply',parameters:{revision:'r1'}}]};

test('creates authority-neutral typed commissioning intent',()=>{const intent=createCommissioningIntent(input);assert.equal(intent.state,'PREPARED');assert.equal(intent.authority_granted,false);});
test('rejects shell/root mechanics and cross-company observations',()=>{assert.throws(()=>createCommissioningIntent({...input,operations:[{capability_id:'root.shell.exec',parameters:{command:'sudo sh -c rm'}}]}),/untyped-host-mechanics-forbidden/);const intent=createCommissioningIntent(input);assert.throws(()=>acceptCommissioningObservation(intent,{company_id:'company-2',intent_id:'intent-1',idempotency_key:'idem-1',status:'VERIFIED',observed_ref:'obs-1'}),/company-mismatch/);});
test('requires independent observed verification before completion',()=>{const intent=createCommissioningIntent(input);assert.throws(()=>acceptCommissioningObservation(intent,{company_id:'company-1',intent_id:'intent-1',idempotency_key:'idem-1',status:'ACKNOWLEDGED',observed_ref:'ack-1'}),/observed-verification-required/);const verified=acceptCommissioningObservation(intent,{company_id:'company-1',intent_id:'intent-1',idempotency_key:'idem-1',status:'VERIFIED',observed_ref:'obs-1'});assert.equal(verified.state,'VERIFIED');assert.equal(verified.authority_granted,false);});
