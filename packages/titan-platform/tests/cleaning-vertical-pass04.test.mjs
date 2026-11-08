import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleaningOnboardingSetup, toRetainedCleaningServiceSetupPayload } from '../.cleaning-test-dist/verticals/cleaning/onboarding.js';
import { createCleaningServiceSetupAuthority } from '../../onboarding/runtime/cleaning-service-setup.mjs';
import { readFileSync } from 'node:fs';

const cleaningBundle=JSON.parse(readFileSync(new URL('../../modules/bundles/cleaning-workforce.bundle.json',import.meta.url),'utf8'));

const base=()=>({
  company_id:'company-a',offered_service_ids:['regular_clean','airbnb_turnover','commercial_clean'],service_areas:[{id:'north',label:'Northern suburbs',postcodes:['3071','3072'],travel_radius_km:20}],enabled_pricing_modes:['hourly','fixed','quote_required'],team_capacity:{default_crew_size:1,max_parallel_crews:4,max_workers_per_crew:3},operating_hours:[{day:'monday',start:'08:00',end:'17:00'},{day:'saturday',start:'09:00',end:'14:00'}],equipment_defaults:['vacuum','mop'],supply_defaults:['microfibre','general cleaner'],recurring:{enabled:true,supported_frequencies:['weekly','fortnightly'],default_frequency:'fortnightly'}
});

test('Pass4 creates cleaning-native onboarding without handyman terminology or authority',()=>{
  const setup=buildCleaningOnboardingSetup(base());
  assert.equal(setup.company_id,'company-a');
  assert.equal(setup.configuration_only,true);
  assert.equal(setup.grants_authority,false);
  assert.equal(setup.execution_permitted,false);
  assert.equal(setup.persists_business_truth,false);
  assert.equal(JSON.stringify(setup).toLowerCase().includes('handyman'),false);
});

test('selected services are canonical catalogue projections',()=>{
  const setup=buildCleaningOnboardingSetup(base());
  assert.deepEqual(setup.offered_services.map(s=>s.service_id),['regular_clean','airbnb_turnover','commercial_clean']);
  assert.ok(setup.offered_services.every(s=>s.label && s.pricing_hints.length));
});

test('service areas, hours and team capacity are validated',()=>{
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),service_areas:[]}),/service area/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),operating_hours:[{day:'monday',start:'17:00',end:'08:00'}]}),/end must be after start/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),team_capacity:{default_crew_size:4,max_parallel_crews:2,max_workers_per_crew:3}}),/cannot exceed/);
});

test('recurring setup requires selected recurring-capable service and valid default',()=>{
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),offered_service_ids:['custom_cleaning_service'],recurring:{enabled:true,supported_frequencies:['weekly'],default_frequency:'weekly'}}),/no selected service supports recurrence/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),recurring:{enabled:true,supported_frequencies:['weekly'],default_frequency:'fortnightly'}}),/default recurring frequency/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),recurring:{enabled:true,supported_frequencies:[],default_frequency:null}}),/no supported recurring frequencies/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),recurring:{enabled:true,supported_frequencies:['yearly'],default_frequency:null}}),/unsupported recurring frequency/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),recurring:{enabled:'false',supported_frequencies:[],default_frequency:null}}),/recurring.enabled must be a boolean/);
  const custom=buildCleaningOnboardingSetup({...base(),offered_service_ids:['regular_clean'],configured_pricing:[{service_id:'regular_clean',mode:'hourly',hourly_rate:62.5}],recurring:{enabled:true,supported_frequencies:['custom'],default_frequency:'custom'}});
  assert.deepEqual(toRetainedCleaningServiceSetupPayload(custom).recurrence.supported_frequencies,['custom_recurring']);
  assert.equal(toRetainedCleaningServiceSetupPayload(custom).recurrence.default_frequency,'custom_recurring');
});

test('legacy tenant aliases and cross-boundary substitutes fail closed',()=>{
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),tenant_id:'legacy'}),/legacy tenant boundary/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),company_id:''}),/company_id is required/);
});

test('retained onboarding authority remains the persistence owner',()=>{
  const setup=buildCleaningOnboardingSetup(base());
  assert.equal(setup.retained_onboarding_authority,'titan.onboarding.cleaning-service-setup-authority.v1');
  assert.equal(setup.retained_catalogue_copy_permitted,false);
  assert.throws(()=>toRetainedCleaningServiceSetupPayload(setup),/hourly_rate is required/);
  const configured=buildCleaningOnboardingSetup({...base(),configured_pricing:[
    {service_id:'regular_clean',mode:'hourly',hourly_rate:62.5},
    {service_id:'airbnb_turnover',mode:'fixed',fixed_price:185},
    {service_id:'commercial_clean',mode:'quote_required'}
  ]});
  const payload=toRetainedCleaningServiceSetupPayload(configured);
  assert.deepEqual(payload.selections.map(selection=>selection.job_type_id),['domestic_recurring','airbnb_turnover','commercial']);
  assert.deepEqual(payload.recurrence,{enabled:true,supported_frequencies:['weekly','fortnightly'],default_frequency:'fortnightly',supported_job_type_ids:['domestic_recurring','airbnb_turnover','commercial']});
  assert.equal(payload.selections[0].pricing.hourly_rate,62.5);
  assert.equal(payload.selections[1].pricing.fixed_price,185);
  assert.equal(payload.selections[2].pricing.mode,'quote_required');
  assert.equal(payload.requires_retained_onboarding_authority,true);
  assert.equal(payload.projection_only,true);
  assert.equal(payload.grants_authority,false);
  assert.equal(payload.execution_permitted,false);
});

test('configured pricing rejects missing required amounts and unmapped job types',()=>{
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),configured_pricing:[{service_id:'regular_clean',mode:'fixed'}]}),/fixed_price is required/);
  assert.throws(()=>buildCleaningOnboardingSetup({...base(),configured_pricing:[{service_id:'regular_clean',mode:'per_area'}]}),/must be fixed, hourly, or quote_required/);
  assert.throws(()=>toRetainedCleaningServiceSetupPayload(buildCleaningOnboardingSetup({...base(),offered_service_ids:['carpet_cleaning']})),/no retained job type mapping/);
  const colliding=buildCleaningOnboardingSetup({...base(),offered_service_ids:['regular_clean','one_off_clean'],configured_pricing:[
    {service_id:'regular_clean',mode:'fixed',fixed_price:100},
    {service_id:'one_off_clean',mode:'hourly',hourly_rate:60}
  ]});
  assert.throws(()=>toRetainedCleaningServiceSetupPayload(colliding),/collide on retained job type domestic_recurring/);
});

test('adapter uses the real cleaning bundle and retained runtime contract',async()=>{
  const configured=buildCleaningOnboardingSetup({...base(),offered_service_ids:['regular_clean','deep_clean','bond_end_of_lease','airbnb_turnover','commercial_clean','move_in_out_clean','office_clean'],configured_pricing:[
    {service_id:'regular_clean',mode:'hourly',hourly_rate:62.5},
    {service_id:'deep_clean',mode:'fixed',fixed_price:310},
    {service_id:'bond_end_of_lease',mode:'quote_required'},
    {service_id:'airbnb_turnover',mode:'fixed',fixed_price:185},
    {service_id:'commercial_clean',mode:'quote_required'},
    {service_id:'move_in_out_clean',mode:'fixed',fixed_price:220},
    {service_id:'office_clean',mode:'fixed',fixed_price:140}
  ]});
  const payload=toRetainedCleaningServiceSetupPayload(configured);
  const expectedBundleIds=['domestic_recurring','deep_clean','bond_end_of_lease','airbnb_turnover','commercial','move_in','office'];
  const bundleIds=cleaningBundle.modules.find(module=>module.id==='titan.workforce.cleaning').contributes.projections.find(projection=>projection.id==='job-types').value.map(jobType=>jobType.id);
  assert.deepEqual(bundleIds,expectedBundleIds);
  assert.ok(payload.selections.every(selection=>bundleIds.includes(selection.job_type_id)));

  const records=new Map();
  const database={
    async getRecord(context){return records.get(context.company_id)||null;},
    async putRecord(context,record){const stored={...record,version:Number(records.get(context.company_id)?.version||0)+1};records.set(context.company_id,stored);return stored;}
  };
  const authority=createCleaningServiceSetupAuthority({database,cleaningBundle});
  await assert.rejects(authority.save({company_id:'company-a'},{...structuredClone(payload),recurrence:{...payload.recurrence,supported_frequencies:['yearly']}}),/unsupported cleaning recurrence frequency/);
  await assert.rejects(authority.save({company_id:'company-a'},{...structuredClone(payload),company_id:'company-b'}),/Cross-company cleaning setup payload rejected/);
  const saved=await authority.save({company_id:'company-a'},payload);
  assert.deepEqual(saved.selected_job_types,expectedBundleIds);
  const view=await authority.read({company_id:'company-a'});
  assert.equal(view.company_id,'company-a');
  assert.equal(view.selections[0].pricing.hourly_rate,62.5);
  assert.equal(view.selections[1].pricing.fixed_price,310);
  assert.equal(view.selections[2].pricing.mode,'quote_required');
  assert.equal(view.selections[3].pricing.fixed_price,185);
  assert.equal(view.selections[4].pricing.mode,'quote_required');
  assert.equal(view.selections[5].pricing.fixed_price,220);
  assert.equal(view.selections[6].pricing.fixed_price,140);
  assert.deepEqual(view.recurrence,{enabled:true,supported_frequencies:['weekly','fortnightly'],default_frequency:'fortnightly',supported_job_type_ids:['domestic_recurring','deep_clean','airbnb_turnover','commercial','office']});
  const otherCompany=await authority.read({company_id:'company-b'});
  assert.deepEqual(otherCompany.selections,[]);
  assert.equal(otherCompany.recurrence.enabled,false);
  const restartedAuthority=createCleaningServiceSetupAuthority({database,cleaningBundle});
  assert.deepEqual((await restartedAuthority.read({company_id:'company-a'})).recurrence,view.recurrence);
  await assert.rejects(restartedAuthority.save({company_id:'company-a'},{company_id:'company-a',selections:[payload.selections[0]]}),/recurring cleaning job type deep_clean is not selected/);
  const selectionOnly={company_id:'company-a',selections:payload.selections};
  await restartedAuthority.save({company_id:'company-a'},{...selectionOnly,expected_revision:1});
  assert.deepEqual((await restartedAuthority.read({company_id:'company-a'})).recurrence,view.recurrence);
  await restartedAuthority.save({company_id:'company-a'},{...selectionOnly,recurrence:{enabled:false,supported_frequencies:[],default_frequency:null,supported_job_type_ids:[]},expected_revision:2});
  assert.equal((await restartedAuthority.read({company_id:'company-a'})).recurrence.enabled,false);
  await assert.rejects(restartedAuthority.save({company_id:'company-a'},{...payload,expected_revision:0}),/cleaning setup revision mismatch/);
});

test('equipment and supply defaults are cleaning configuration, not implicit capabilities',()=>{
  const setup=buildCleaningOnboardingSetup(base());
  assert.deepEqual(setup.equipment_defaults,['vacuum','mop']);
  assert.deepEqual(setup.supply_defaults,['microfibre','general cleaner']);
  assert.equal('capabilities' in setup,false);
});
