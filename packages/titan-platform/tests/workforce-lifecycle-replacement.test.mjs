import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TITAN_WORKFORCE_REPLACEMENT_CONTRACT,
  advanceTitanWorkforceReplacementPlan,
  buildTitanWorkforceReplacementPlan,
  declareTitanWorkforceAgent,
  evaluateTitanWorkforceAssignmentCompatibility,
  projectTitanWorkforceHealth,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const registration=(key,version='1.0.0')=>declareTitanWorkforceAgent({company_id:'company-1',agent_key:key,agent_version:version,name:key,role_definition_id:`role.${key}`,operational_domains:['booking'],capabilities:[{capability_id:'booking.prepare',version:'1.0.0',description:'',operations:['read','propose']}],configuration:{}});
const source=()=>registration('booking-v1','1.0.0');
const target=()=>registration('booking-v2','2.0.0');
const health=(reg,state='ENABLED',h='READY')=>projectTitanWorkforceHealth({company_id:'company-1',agent_key:reg.agent_key,lifecycle_state:state,health_state:h,readiness_reasons:h==='READY'?[]:['provider-down']});
const evidence=(reg,h)=>evaluateTitanWorkforceAssignmentCompatibility({company_id:'company-1',registration:reg,health:h,required_capabilities:[{capability_id:'booking.prepare'}],required_domains:['booking']});
const base=(overrides={})=>{const s=source(),t=target(),sh=health(s),th=health(t);return {company_id:'company-1',source_registration:s,target_registration:t,source_health:sh,target_health:th,target_compatibility:evidence(t,th),preserved_history_refs:['history:booking-v1'],audit_refs:['audit:replacement-request'],...overrides};};

test('replacement contract is proposal-only and authority-neutral',()=>{
 assert.equal(TITAN_WORKFORCE_REPLACEMENT_CONTRACT.automaticTaskTransfer,false);
 assert.equal(TITAN_WORKFORCE_REPLACEMENT_CONTRACT.replacementGrantsAuthority,false);
});

test('zero-active-work replacement becomes cutover-ready but cannot self execute',()=>{
 const plan=buildTitanWorkforceReplacementPlan(base());
 assert.equal(plan.phase,'CUTOVER_READY'); assert.equal(plan.target_may_receive_new_work_after_cutover,true);
 assert.equal(plan.execution_permitted,false); assert.equal(plan.grants_authority,false); assert.equal(plan.requires_platform_manager_approval,true);
});

test('active work requires explicit continuity and drains before cutover',()=>{
 let plan=buildTitanWorkforceReplacementPlan(base({active_task_ids:['task-1','task-2'],continuity:[{task_id:'task-1',handoff_ref:'handoff:1'},{task_id:'task-2',handoff_ref:'handoff:2',execution_receipt_ref:'receipt:2'}]}));
 assert.equal(plan.phase,'DRAINING_SOURCE'); assert.equal(plan.continuity.length,2); assert.equal(plan.automatic_task_transfer,false);
 plan=advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',active_task_ids:['task-2']}); assert.equal(plan.phase,'DRAINING_SOURCE'); assert.equal(plan.active_work_count,1);
 plan=advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',active_task_ids:[]}); assert.equal(plan.phase,'CUTOVER_READY');
});

test('missing active-task continuity blocks replacement',()=>{
 const plan=buildTitanWorkforceReplacementPlan(base({active_task_ids:['task-1'],continuity:[]}));
 assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('active-task-continuity-missing:task-1'));
});

test('degraded or incompatible target blocks replacement',()=>{
 const s=source(),t=target(),sh=health(s),th=health(t,'ENABLED','DEGRADED');
 let plan=buildTitanWorkforceReplacementPlan({company_id:'company-1',source_registration:s,target_registration:t,source_health:sh,target_health:th,target_compatibility:evidence(t,th),preserved_history_refs:['history:1'],audit_refs:['audit:1']});
 assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.some(x=>x.startsWith('target-not-ready')));
});

test('history and audit provenance are mandatory',()=>{
 let plan=buildTitanWorkforceReplacementPlan(base({preserved_history_refs:[]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('source-history-reference-required'));
 plan=buildTitanWorkforceReplacementPlan(base({audit_refs:[]})); assert.equal(plan.phase,'BLOCKED'); assert.ok(plan.blockers.includes('replacement-audit-reference-required'));
});

test('completion requires platform-manager approval and cutover audit ref',()=>{
 let plan=buildTitanWorkforceReplacementPlan(base());
 assert.throws(()=>advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1'}),/platform-manager-approval-required/);
 assert.throws(()=>advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',platform_manager_approved:true}),/cutover-audit-ref-required/);
 plan=advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',platform_manager_approved:true,cutover_audit_ref:'audit:cutover'});
 assert.equal(plan.phase,'COMPLETED'); assert.ok(plan.audit_refs.includes('audit:cutover')); assert.equal(plan.execution_permitted,false);
});

test('cross-company, same-agent and legacy tenant replacement fail closed',()=>{
 assert.throws(()=>buildTitanWorkforceReplacementPlan({...base(),company_id:'company-2'}),/cross-company/);
 const s=source(),sh=health(s); assert.throws(()=>buildTitanWorkforceReplacementPlan({...base(),source_registration:s,target_registration:s,source_health:sh,target_health:sh,target_compatibility:evidence(s,sh)}),/distinct-agent/);
 assert.throws(()=>buildTitanWorkforceReplacementPlan({...base(),tenant_id:'legacy'}),/legacy-company-boundary/);
});
