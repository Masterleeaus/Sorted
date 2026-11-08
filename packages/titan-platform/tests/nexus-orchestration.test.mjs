import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveNexusPlan,approveNexusPlan,acceptNexusVerification} from '../.test-dist/nexus-orchestration.js';

const input={company_id:'company-1',plan_id:'plan-1',idempotency_key:'idem-1',configuration_revision:'rev-1',native_capabilities:['native.jobs'],requested_facets:[]};
test('resolves native-only plan without provider dependency',()=>{const plan=resolveNexusPlan(input);assert.equal(plan.state,'PROPOSED');assert.equal(plan.authority_granted,false);});
test('fails closed on unavailable provider and stale approval',()=>{assert.throws(()=>resolveNexusPlan({...input,requested_facets:[{provider:'frappe',facet:'accounting',available:false}]}),/provider-facet-unavailable/);const plan=resolveNexusPlan(input);assert.throws(()=>approveNexusPlan(plan,{company_id:'company-1',approval_ref:'approval-1',configuration_revision:'rev-2'}),/configuration-revision-stale/);});
test('requires approval and observed verification',()=>{const plan=resolveNexusPlan(input);assert.throws(()=>acceptNexusVerification(plan,{company_id:'company-1',plan_id:'plan-1',idempotency_key:'idem-1',status:'VERIFIED',observed_ref:'obs-1'}),/approval-required/);const approved=approveNexusPlan(plan,{company_id:'company-1',approval_ref:'approval-1',configuration_revision:'rev-1'});const verified=acceptNexusVerification(approved,{company_id:'company-1',plan_id:'plan-1',idempotency_key:'idem-1',status:'VERIFIED',observed_ref:'obs-1'});assert.equal(verified.state,'VERIFIED');assert.equal(verified.authority_granted,false);});
