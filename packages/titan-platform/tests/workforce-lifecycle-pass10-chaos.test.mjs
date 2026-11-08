import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTitanWorkforceLifecycleRuntime,
  transitionTitanWorkforceLifecycle,
  buildTitanWorkforceMigrationPlan,
  transitionTitanWorkforceMigration,
  declareTitanWorkforceAgent,
  projectTitanWorkforceHealth,
  evaluateTitanWorkforceAssignmentCompatibility,
  buildTitanWorkforceReplacementPlan,
  advanceTitanWorkforceReplacementPlan,
  buildTitanWorkforceRetirementPlan,
  approveTitanWorkforceRetirement,
} from '../.lifecycle-test-dist/workforce-lifecycle/index.js';

const registration=(key='booking',version='1.0.0')=>declareTitanWorkforceAgent({
  company_id:'company-1', agent_key:key, agent_version:version, name:key,
  role_definition_id:`role.${key}`, operational_domains:['booking'],
  capabilities:[{capability_id:'booking.prepare',version:'1.0.0',description:'',operations:['read','propose']}], configuration:{}
});
const health=(reg,state='ENABLED',healthState='READY')=>projectTitanWorkforceHealth({
  company_id:'company-1',agent_key:reg.agent_key,lifecycle_state:state,health_state:healthState,
  readiness_reasons:healthState==='READY'?[]:['provider-down']
});
const compatibility=(reg,h)=>evaluateTitanWorkforceAssignmentCompatibility({
  company_id:'company-1',registration:reg,health:h,
  required_capabilities:[{capability_id:'booking.prepare'}],required_domains:['booking']
});
const migrationBase=(overrides={})=>({
  company_id:'company-1',agent_key:'booking',source_version:'1.0.0',target_version:'1.1.0',
  source_configuration_revision:1,target_configuration_revision:2,lifecycle_state:'PAUSED',active_work_count:0,
  backup_ref:'backup:booking:1',rollback_ref:'rollback:booking:1',
  migrations:[{migration_id:'booking-1-1',registered:true,data_preserving:true,authority_neutral:true,reversible:true,rollback_ref:'rollback:booking:step1'}],
  ...overrides
});

test('disable-mid-task drains monotonically and restart reconstruction remains non-assignable',()=>{
  let runtime=createTitanWorkforceLifecycleRuntime({company_id:'company-1',agent_key:'booking',lifecycle_state:'ENABLED',health_state:'READY',active_work_count:3});
  ({runtime}=transitionTitanWorkforceLifecycle(runtime,'DISABLE',{company_id:'company-1',active_work_count:3,reason:'maintenance'}));
  assert.equal(runtime.lifecycle_state,'DRAINING'); assert.equal(runtime.accepts_new_assignments,false); assert.equal(runtime.execution_permitted,false);
  runtime=createTitanWorkforceLifecycleRuntime({...runtime});
  assert.equal(runtime.lifecycle_state,'DRAINING'); assert.equal(runtime.active_work_count,3); assert.equal(runtime.accepts_new_assignments,false);
  ({runtime}=transitionTitanWorkforceLifecycle(runtime,'DRAIN_TICK',{company_id:'company-1',active_work_count:2}));
  assert.throws(()=>transitionTitanWorkforceLifecycle(runtime,'DRAIN_TICK',{company_id:'company-1',active_work_count:3}),/cannot-increase/);
  ({runtime}=transitionTitanWorkforceLifecycle(runtime,'DRAIN_TICK',{company_id:'company-1',active_work_count:0}));
  assert.equal(runtime.lifecycle_state,'DISABLED'); assert.equal(runtime.accepts_new_assignments,false);
});

test('interrupted upgrade restarts into manual recovery and never replays effects automatically',()=>{
  let plan=buildTitanWorkforceMigrationPlan(migrationBase());
  plan=transitionTitanWorkforceMigration(plan,{company_id:'company-1',type:'START',checkpoint_id:'cp:start'});
  plan=transitionTitanWorkforceMigration(plan,{company_id:'company-1',type:'INTERRUPT',checkpoint_id:'cp:interrupt',effect_state:'UNKNOWN'});
  assert.equal(plan.phase,'RECOVERY_REQUIRED'); assert.equal(plan.requires_manual_review,true); assert.equal(plan.automatic_effect_replay,false);
  const recovered=buildTitanWorkforceMigrationPlan(migrationBase({previous_checkpoint:plan}));
  assert.equal(recovered.phase,'RECOVERY_REQUIRED'); assert.equal(recovered.interrupted_upgrade_detected,true); assert.equal(recovered.effect_state,'UNKNOWN');
  assert.equal(recovered.execution_permitted,false); assert.equal(recovered.migration_grants_authority,false);
});

test('upgrade failure rolls back explicitly and rolled-back state is terminal',()=>{
  let plan=buildTitanWorkforceMigrationPlan(migrationBase());
  plan=transitionTitanWorkforceMigration(plan,{company_id:'company-1',type:'START'});
  plan=transitionTitanWorkforceMigration(plan,{company_id:'company-1',type:'FAIL',effect_state:'UNKNOWN'});
  assert.equal(plan.phase,'ROLLBACK_REQUIRED');
  const restarted=buildTitanWorkforceMigrationPlan(migrationBase({previous_checkpoint:plan}));
  assert.equal(restarted.phase,'ROLLBACK_REQUIRED'); assert.equal(restarted.effect_state,'UNKNOWN');
  plan=transitionTitanWorkforceMigration(restarted,{company_id:'company-1',type:'ROLLED_BACK',checkpoint_id:'cp:rolled-back'});
  assert.equal(plan.phase,'ROLLED_BACK'); assert.equal(plan.effect_state,'ROLLED_BACK');
  assert.throws(()=>transitionTitanWorkforceMigration(plan,{company_id:'company-1',type:'START'}),/invalid-transition/);
});

test('upgrade is blocked while active work exists or lifecycle is enabled',()=>{
  const plan=buildTitanWorkforceMigrationPlan(migrationBase({lifecycle_state:'ENABLED',active_work_count:1}));
  assert.equal(plan.phase,'BLOCKED');
  assert.ok(plan.blockers.includes('active-work-must-drain-before-upgrade'));
  assert.ok(plan.blockers.includes('lifecycle-state-not-upgrade-safe:ENABLED'));
  assert.equal(plan.execution_permitted,false);
});

test('replacement restart preserves continuity evidence and cannot auto-transfer work',()=>{
  const source=registration('booking-v1','1.0.0'), target=registration('booking-v2','2.0.0');
  const sh=health(source), th=health(target), comp=compatibility(target,th);
  let plan=buildTitanWorkforceReplacementPlan({
    company_id:'company-1',source_registration:source,target_registration:target,source_health:sh,target_health:th,target_compatibility:comp,
    active_task_ids:['task-a','task-b'],continuity:[{task_id:'task-a',handoff_ref:'handoff:a'},{task_id:'task-b',handoff_ref:'handoff:b'}],
    preserved_history_refs:['history:v1'],audit_refs:['audit:prepare']
  });
  assert.equal(plan.phase,'DRAINING_SOURCE'); assert.equal(plan.automatic_task_transfer,false); assert.equal(plan.execution_permitted,false);
  const serialized=JSON.parse(JSON.stringify(plan));
  plan=advanceTitanWorkforceReplacementPlan(serialized,{company_id:'company-1',active_task_ids:['task-b']});
  assert.equal(plan.phase,'DRAINING_SOURCE'); assert.equal(plan.continuity.length,2);
  plan=advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',active_task_ids:[]});
  assert.equal(plan.phase,'CUTOVER_READY'); assert.equal(plan.requires_fresh_authority_evaluation,true);
});

test('replacement completion remains approval-gated after restart',()=>{
  const source=registration('booking-v1','1.0.0'), target=registration('booking-v2','2.0.0');
  const sh=health(source), th=health(target), comp=compatibility(target,th);
  let plan=buildTitanWorkforceReplacementPlan({company_id:'company-1',source_registration:source,target_registration:target,source_health:sh,target_health:th,target_compatibility:comp,preserved_history_refs:['history:v1'],audit_refs:['audit:prepare']});
  plan=JSON.parse(JSON.stringify(plan));
  assert.throws(()=>advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1'}),/platform-manager-approval-required/);
  plan=advanceTitanWorkforceReplacementPlan(plan,{company_id:'company-1',platform_manager_approved:true,cutover_audit_ref:'audit:cutover'});
  assert.equal(plan.phase,'COMPLETED'); assert.equal(plan.execution_permitted,false); assert.equal(plan.grants_authority,false);
});

test('retirement cannot orphan dependencies or erase retained history under chaos conditions',()=>{
  const reg=registration('booking','1.0.0');
  let plan=buildTitanWorkforceRetirementPlan({
    company_id:'company-1',registration:reg,lifecycle_state:'DISABLED',active_work_count:0,
    dependencies:[{dependency_id:'schedule-1',dependency_kind:'SCHEDULE',resolution:'UNRESOLVED'}],
    owned_resources:[{resource_id:'config-1',disposition:'RETAIN',disposition_ref:'retained:config-1'}],
    retained_history_refs:['history:booking'],retained_audit_refs:['audit:booking'],configuration_snapshot_ref:'snapshot:booking',retention_policy_ref:'policy:7y'
  });
  assert.equal(plan.phase,'BLOCKED'); assert.equal(plan.orphan_prevention_verified,false);
  plan=buildTitanWorkforceRetirementPlan({
    company_id:'company-1',registration:reg,lifecycle_state:'DISABLED',active_work_count:0,
    dependencies:[{dependency_id:'schedule-1',dependency_kind:'SCHEDULE',resolution:'REPOINT',resolution_ref:'schedule:new-agent'}],
    owned_resources:[{resource_id:'config-1',disposition:'RETAIN',disposition_ref:'retained:config-1'}],
    retained_history_refs:['history:booking'],retained_audit_refs:['audit:booking'],configuration_snapshot_ref:'snapshot:booking',retention_policy_ref:'policy:7y'
  });
  assert.equal(plan.phase,'RETIREMENT_READY');
  const record=approveTitanWorkforceRetirement(plan,{company_id:'company-1',platform_manager_approved:true,retirement_audit_ref:'audit:retired'});
  assert.equal(record.lifecycle_state,'RETIRED'); assert.deepEqual(record.retained_history_refs,['history:booking']); assert.equal(record.automatic_data_deletion,false);
});

test('degraded target cannot become replacement recipient during recovery',()=>{
  const source=registration('booking-v1','1.0.0'), target=registration('booking-v2','2.0.0');
  const sh=health(source), th=health(target,'ENABLED','DEGRADED'), comp=compatibility(target,th);
  const plan=buildTitanWorkforceReplacementPlan({company_id:'company-1',source_registration:source,target_registration:target,source_health:sh,target_health:th,target_compatibility:comp,preserved_history_refs:['history:v1'],audit_refs:['audit:prepare']});
  assert.equal(plan.phase,'BLOCKED'); assert.equal(plan.target_may_receive_new_work_after_cutover,false); assert.equal(plan.execution_permitted,false);
});

test('cross-company chaos events fail closed across transition, migration and retirement approval',()=>{
  const runtime=createTitanWorkforceLifecycleRuntime({company_id:'company-1',agent_key:'booking',lifecycle_state:'ENABLED',health_state:'READY'});
  assert.throws(()=>transitionTitanWorkforceLifecycle(runtime,'PAUSE',{company_id:'company-2'}),/cross-company/);
  const migration=buildTitanWorkforceMigrationPlan(migrationBase());
  assert.throws(()=>transitionTitanWorkforceMigration(migration,{company_id:'company-2',type:'START'}),/cross-company/);
  const reg=registration();
  const retirement=buildTitanWorkforceRetirementPlan({company_id:'company-1',registration:reg,lifecycle_state:'DISABLED',retained_history_refs:['history'],retained_audit_refs:['audit'],configuration_snapshot_ref:'snapshot',retention_policy_ref:'policy'});
  assert.throws(()=>approveTitanWorkforceRetirement(retirement,{company_id:'company-2',platform_manager_approved:true,retirement_audit_ref:'audit:retired'}),/cross-company/);
});

test('all chaos-path outputs preserve identity-not-authority invariants',()=>{
  const runtime=createTitanWorkforceLifecycleRuntime({company_id:'company-1',agent_key:'booking',lifecycle_state:'ENABLED',health_state:'READY'});
  const paused=transitionTitanWorkforceLifecycle(runtime,'PAUSE',{company_id:'company-1'}).runtime;
  const migration=buildTitanWorkforceMigrationPlan(migrationBase());
  const reg=registration(); const h=health(reg); const comp=compatibility(reg,h);
  for(const value of [runtime,paused,migration,h,comp]){
    if('execution_permitted' in value) assert.equal(value.execution_permitted,false);
    if('grants_authority' in value) assert.equal(value.grants_authority,false);
    if('migration_grants_authority' in value) assert.equal(value.migration_grants_authority,false);
    if('identity_grants_authority' in value) assert.equal(value.identity_grants_authority,false);
  }
});
