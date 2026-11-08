import test from 'node:test';
import assert from 'node:assert/strict';
import {approveTitanWorkforceRetirement,buildTitanWorkforceRetirementPlan,declareTitanWorkforceAgent,TITAN_WORKFORCE_RETIREMENT_CONTRACT} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const registration=()=>declareTitanWorkforceAgent({company_id:'company-1',agent_key:'booking',agent_version:'2.0.0',name:'Booking',role_definition_id:'role.booking',operational_domains:['booking'],capabilities:[{capability_id:'booking.prepare',version:'1.0.0',description:'',operations:['read','propose']}],configuration:{}});
const base=(overrides={})=>({company_id:'company-1',registration:registration(),lifecycle_state:'DISABLED',active_work_count:0,dependencies:[{dependency_id:'schedule:booking',dependency_kind:'SCHEDULE',resolution:'REPOINT',resolution_ref:'schedule:booking-v2'}],owned_resources:[{resource_id:'queue:booking',disposition:'TRANSFER',disposition_ref:'queue:booking-v2'}],retained_history_refs:['history:booking'],retained_audit_refs:['audit:disable'],configuration_snapshot_ref:'config-snapshot:booking:2.0.0',retention_policy_ref:'retention:workforce:v1',...overrides});

test('retirement contract is retention-first and non-authoritative',()=>{
 assert.equal(TITAN_WORKFORCE_RETIREMENT_CONTRACT.automaticUninstall,false);
 assert.equal(TITAN_WORKFORCE_RETIREMENT_CONTRACT.automaticDataDeletion,false);
 assert.equal(TITAN_WORKFORCE_RETIREMENT_CONTRACT.retirementGrantsAuthority,false);
});

test('safe disabled agent with resolved dependencies becomes retirement-ready only',()=>{
 const plan=buildTitanWorkforceRetirementPlan(base());
 assert.equal(plan.phase,'RETIREMENT_READY'); assert.equal(plan.orphan_prevention_verified,true); assert.equal(plan.retention_verified,true);
 assert.equal(plan.uninstall_permitted,false); assert.equal(plan.execution_permitted,false); assert.equal(plan.grants_authority,false);
});

test('active work or unsafe lifecycle blocks retirement',()=>{
 let plan=buildTitanWorkforceRetirementPlan(base({active_work_count:1})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('active-work-must-be-zero-before-retirement'));
 plan=buildTitanWorkforceRetirementPlan(base({lifecycle_state:'PAUSED'})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('retirement-lifecycle-not-safe:PAUSED'));
});

test('unresolved dependencies and resources block orphan-producing retirement',()=>{
 let plan=buildTitanWorkforceRetirementPlan(base({dependencies:[{dependency_id:'workflow:x',dependency_kind:'WORKFLOW',resolution:'UNRESOLVED'}]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('dependency-unresolved:workflow:x'));
 plan=buildTitanWorkforceRetirementPlan(base({owned_resources:[{resource_id:'asset:x',disposition:'UNRESOLVED'}]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('owned-resource-unresolved:asset:x'));
});

test('resolved dependency/resource dispositions require evidence references',()=>{
 let plan=buildTitanWorkforceRetirementPlan(base({dependencies:[{dependency_id:'workflow:x',dependency_kind:'WORKFLOW',resolution:'REPOINT'}]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('dependency-resolution-ref-required:workflow:x'));
 plan=buildTitanWorkforceRetirementPlan(base({owned_resources:[{resource_id:'asset:x',disposition:'RETAIN'}]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('resource-disposition-ref-required:asset:x'));
});

test('history audit configuration snapshot and retention policy are mandatory',()=>{
 for(const [field,value,blocker] of [['retained_history_refs',[],'retained-history-reference-required'],['retained_audit_refs',[],'retained-audit-reference-required'],['configuration_snapshot_ref',null,'configuration-snapshot-reference-required'],['retention_policy_ref',null,'retention-policy-reference-required']]){
  const plan=buildTitanWorkforceRetirementPlan(base({[field]:value})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes(blocker));
 }
});

test('approval emits retained retired record but still never auto-uninstalls or deletes data',()=>{
 const plan=buildTitanWorkforceRetirementPlan(base());
 assert.throws(()=>approveTitanWorkforceRetirement(plan,{company_id:'company-1'}),/platform-manager-approval-required/);
 assert.throws(()=>approveTitanWorkforceRetirement(plan,{company_id:'company-1',platform_manager_approved:true}),/retirement-audit-ref-required/);
 const record=approveTitanWorkforceRetirement(plan,{company_id:'company-1',platform_manager_approved:true,retirement_audit_ref:'audit:retire'});
 assert.equal(record.lifecycle_state,'RETIRED'); assert.equal(record.automatic_uninstall,false); assert.equal(record.automatic_data_deletion,false); assert.equal(record.execution_permitted,false); assert.equal(record.grants_authority,false); assert.ok(record.retained_audit_refs.includes('audit:retire'));
});

test('cross-company and legacy tenant retirement fail closed',()=>{
 assert.throws(()=>buildTitanWorkforceRetirementPlan({...base(),company_id:'company-2'}),/cross-company/);
 assert.throws(()=>buildTitanWorkforceRetirementPlan({...base(),tenant_id:'legacy'}),/legacy-company-boundary/);
 const plan=buildTitanWorkforceRetirementPlan(base()); assert.throws(()=>approveTitanWorkforceRetirement(plan,{company_id:'company-2',platform_manager_approved:true,retirement_audit_ref:'a'}),/cross-company/);
});
