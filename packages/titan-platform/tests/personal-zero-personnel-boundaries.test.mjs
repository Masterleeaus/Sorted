import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryStorageAdapter,createCompanyRepository} from '../.test-dist/storage/index.js';
import {
  ZERO_PERSONNEL_BOUNDARY,
  createCapabilityAuthorityPolicy,
  createCompanyRealityReference,
  createCompanyRelationship,
  createPersonalZeroStateService,
  createWorkforceDelegationBoundary,
  createZeroSurfaceProjection,
  resolveOneUnavailableBoundary,
} from '../.test-dist/personal-zero/index.js';

const relationship=(overrides={})=>createCompanyRelationship({
  relationship_id:'rel-a',
  one_id:'one-1',
  zero_id:'zero-1',
  company_id:'company-a',
  role_refs:['owner'],
  capability_refs:['jobs.read'],
  authority_refs:['auth-1'],
  data_visibility_refs:['scope-a'],
  activated_at:1,
  ...overrides,
});

test('Zero is one persistent identity across canonical surfaces and channels',()=>{
  const rel=relationship();
  const command=createZeroSurfaceProjection(rel,{surface:'zero',channel:'web'});
  const field=createZeroSurfaceProjection(rel,{surface:'go',channel:'mobile'});
  const customer=createZeroSurfaceProjection(rel,{surface:'hub',channel:'voice'});
  assert.equal(command.zero_id,'zero-1');
  assert.equal(field.zero_id,'zero-1');
  assert.equal(customer.zero_id,'zero-1');
  assert.equal(command.one_id,'one-1');
  assert.equal(field.relationship_id,'rel-a');
  assert.equal(customer.company_id,'company-a');
  assert.equal(command.execution_authority,false);
});

test('company contexts remain orthogonal to surfaces and do not leak role or authority refs',()=>{
  const a=createZeroSurfaceProjection(relationship(),{surface:'zero',channel:'web'});
  const b=createZeroSurfaceProjection(relationship({relationship_id:'rel-b',company_id:'company-b',role_refs:['customer'],capability_refs:['booking.read'],authority_refs:['auth-b'],data_visibility_refs:['scope-b']}),{surface:'hub',channel:'mobile'});
  assert.equal(a.zero_id,b.zero_id);
  assert.deepEqual(a.role_refs,['owner']);
  assert.deepEqual(b.role_refs,['customer']);
  assert.deepEqual(a.authority_refs,['auth-1']);
  assert.deepEqual(b.authority_refs,['auth-b']);
});

test('a customer is a separate One and Zero, not a context inside an owner Zero',()=>{
  const owner=createZeroSurfaceProjection(relationship(),{surface:'zero',channel:'web'});
  const customer=createZeroSurfaceProjection(relationship({relationship_id:'rel-customer',one_id:'one-customer',zero_id:'zero-customer',role_refs:['customer'],authority_refs:[],data_visibility_refs:['customer-scope']}),{surface:'hub',channel:'mobile'});
  assert.notEqual(owner.one_id,customer.one_id);
  assert.notEqual(owner.zero_id,customer.zero_id);
});

test('same company cannot bind one One to multiple Zeros or one Zero to multiple Ones',async()=>{
  const svc=createPersonalZeroStateService({repository:createCompanyRepository({adapter:createMemoryStorageAdapter()})});
  const ctx={company_id:'company-a',actor_id:'actor',operation_id:'op'};
  await svc.putRelationship(ctx,relationship());
  await assert.rejects(()=>svc.putRelationship(ctx,relationship({relationship_id:'rel-other-zero',zero_id:'zero-2'})),/One.*different Zero/i);
  await assert.rejects(()=>svc.putRelationship(ctx,relationship({relationship_id:'rel-other-one',one_id:'one-2'})),/Zero.*different One/i);
});

test('Zero-originated intent must delegate to a distinct workforce actor under explicit authority and governed execution',()=>{
  const delegation=createWorkforceDelegationBoundary({
    intent_id:'intent-1',one_id:'one-1',zero_id:'zero-1',company_id:'company-a',relationship_id:'rel-a',
    workforce_actor_id:'manager-1',workforce_tier:'manager',capability_id:'schedule.update',authority_ref:'auth-schedule',decision_ref:'decision-1',
  });
  assert.equal(delegation.execution_gateway_required,true);
  assert.equal(delegation.zero_execution_authority,false);
  assert.equal(delegation.workforce_actor_id,'manager-1');
  assert.throws(()=>createWorkforceDelegationBoundary({...delegation,workforce_actor_id:'zero-1'}),/Zero cannot be the workforce execution actor/i);
  assert.throws(()=>createWorkforceDelegationBoundary({...delegation,authority_ref:''}),/authority_ref is required/i);
});

test('company State, Configuration and Intelligence are explicit reference semantics, not Zero-owned copies',()=>{
  const state=createCompanyRealityReference({company_id:'company-a',kind:'state',ref:'state:jobs'});
  const config=createCompanyRealityReference({company_id:'company-a',kind:'configuration',ref:'config:scheduling'});
  const intelligence=createCompanyRealityReference({company_id:'company-a',kind:'intelligence',ref:'intel:forecast'});
  assert.deepEqual([state.kind,config.kind,intelligence.kind],['state','configuration','intelligence']);
  assert.equal(state.copied_payload,false);
  assert.equal(config.copied_payload,false);
  assert.equal(intelligence.authority_neutral,true);
  assert.equal(intelligence.execution_authority,false);
});

test('prediction is not an authority level and confidence cannot elevate authority',()=>{
  const policy=createCapabilityAuthorityPolicy({capability_id:'schedule.update',state:'recommend',predictive:true,confidence:1,authority_ref:'auth-1'});
  assert.equal(policy.state,'recommend');
  assert.equal(policy.predictive,true);
  assert.equal(policy.execution_authority,false);
  assert.throws(()=>createCapabilityAuthorityPolicy({capability_id:'schedule.update',state:'predictive',predictive:true,confidence:1,authority_ref:'auth-1'}),/invalid capability authority state/i);
});

test('One unavailability never widens authority and only bounded delegated execution may continue',()=>{
  const continueResult=resolveOneUnavailableBoundary({authority_state:'execute_within_policy',delegated_work_active:true,delegate_one_id:null,delegate_authority_ref:null});
  assert.equal(continueResult.action,'continue_within_envelope');
  assert.equal(continueResult.authority_expanded,false);
  assert.equal(continueResult.authority_state,'execute_within_policy');
  const edge=resolveOneUnavailableBoundary({authority_state:'prepare_ask',delegated_work_active:true,delegate_one_id:null,delegate_authority_ref:null});
  assert.equal(edge.action,'queue_or_escalate');
  const incompleteDelegate=resolveOneUnavailableBoundary({authority_state:'recommend',delegated_work_active:false,delegate_one_id:'one-delegate',delegate_authority_ref:null});
  assert.equal(incompleteDelegate.action,'queue_or_escalate');
  const handoff=resolveOneUnavailableBoundary({authority_state:'recommend',delegated_work_active:false,delegate_one_id:'one-delegate',delegate_authority_ref:'auth-delegate'});
  assert.equal(handoff.action,'handoff');
  assert.equal(handoff.delegate_one_id,'one-delegate');
  assert.equal(handoff.authority_expanded,false);
});

test('boundary descriptor rejects digital-twin, model-provider and workforce-manager semantics',()=>{
  assert.equal(ZERO_PERSONNEL_BOUNDARY.digital_twin,false);
  assert.equal(ZERO_PERSONNEL_BOUNDARY.model_provider,false);
  assert.equal(ZERO_PERSONNEL_BOUNDARY.workforce_manager,false);
  assert.equal(ZERO_PERSONNEL_BOUNDARY.execution_authority,false);
  assert.equal(ZERO_PERSONNEL_BOUNDARY.workforce_execution,'delegated_workforce');
  assert.equal(ZERO_PERSONNEL_BOUNDARY.consequential_execution,'execution_gateway');
});
