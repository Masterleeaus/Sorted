import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleaningBookingSchedulingProjection } from '../.cleaning-test-dist/verticals/cleaning/scheduling.js';

const base={company_id:'company-a',booking_ref:'booking:1',customer_ref:'customer:1',cadence:'fortnightly',cadence_source_ref:'contract:recurring-1',sites:[{site_ref:'site:a',service_id:'regular_clean',requested_date:'2026-09-20',arrival_window:{start:'09:00',end:'11:00'},crew_size:2,travel_buffer_before_minutes:20,travel_buffer_after_minutes:15,access:{instructions_ref:'access:a',key_access_ref:'key:a',alarm_ref:'alarm:a',pet_notes:'dog in yard',parking_notes:'rear bay'}}]};

test('Pass5 projects recurring cadence, crew requirements, access and travel buffers',()=>{
 const p=buildCleaningBookingSchedulingProjection(base);
 assert.equal(p.cadence,'fortnightly'); assert.equal(p.sites[0].crew_size,2); assert.equal(p.sites[0].travel_buffer_before_minutes,20);
 assert.equal(p.sites[0].access.key_access_ref,'key:a'); assert.equal(p.sites[0].access.alarm_ref,'alarm:a'); assert.equal(p.sites[0].access.pet_notes,'dog in yard');
 assert.equal(p.sites[0].retained_assignment_requirement_owner,'titan.workforce.cleaning-assignment-requirement-suggestions.v1');
});

test('multi-site commercial bookings remain ordered projections without scheduling mutation',()=>{
 const p=buildCleaningBookingSchedulingProjection({...base,cadence:'weekly',sites:[...base.sites,{site_ref:'site:b',service_id:'commercial_clean',requested_date:'2026-09-20',arrival_window:{start:'18:00',end:'22:00'},estimated_minutes:240,crew_size:3}]});
 assert.equal(p.multi_site,true); assert.deepEqual(p.sites.map(x=>x.site_ref),['site:a','site:b']); assert.equal(p.schedule_mutation_emitted,false);
});

test('non-recurring services reject recurring cadence',()=>{
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,sites:[{site_ref:'site:a',service_id:'bond_end_of_lease'}]}),/does not support recurring/);
});

test('recurring cadence requires provenance and arrival windows fail closed',()=>{
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,cadence_source_ref:''}),/cadence_source_ref is required/);
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,cadence:'one_off',cadence_source_ref:undefined,sites:[{site_ref:'site:a',service_id:'regular_clean',arrival_window:{start:'12:00',end:'09:00'}}]}),/end must be after start/);
});

test('reschedule requests retain policy review and require a reason reference',()=>{
 const p=buildCleaningBookingSchedulingProjection({...base,reschedule:{requested:true,reason_ref:'reason:customer',preserve_team_preference:true,minimum_notice_minutes:1440}});
 assert.equal(p.reschedule.requires_shared_booking_policy_review,true); assert.equal(p.reschedule.preserve_team_preference,true);
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,reschedule:{requested:true}}),/reason_ref is required/);
});

test('company boundary, unknown services and duplicate sites fail closed',()=>{
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,company_id:''}),/company_id is required/);
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,tenant_id:'legacy'}),/legacy tenant boundary/);
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,cadence:'one_off',sites:[{site_ref:'site:a',service_id:'missing'}]}),/unknown cleaning service id/);
 assert.throws(()=>buildCleaningBookingSchedulingProjection({...base,sites:[base.sites[0],base.sites[0]]}),/duplicate cleaning site_ref/);
});

test('booking/scheduling projection preserves shared owners and identity-not-authority',()=>{
 const p=buildCleaningBookingSchedulingProjection(base);
 assert.equal(p.owners.booking,'shared_booking_owner'); assert.equal(p.owners.scheduling,'shared_scheduling_owner'); assert.equal(p.owners.assignment,'shared_workforce_assignment_owner');
 assert.equal(p.booking_mutation_emitted,false); assert.equal(p.schedule_mutation_emitted,false); assert.equal(p.automatic_assignment,false); assert.equal(p.automatic_reassignment,false); assert.equal(p.requires_fresh_assignment_authority,true); assert.equal(p.grants_authority,false); assert.equal(p.execution_permitted,false);
});
