import test from 'node:test';
import assert from 'node:assert/strict';
const r = await import('../.licensed-trades-test-dist/recurrence.js');

function base(overrides={}) { return {company_id:'c1',trade:'plumbing',service_key:'plumbing.maintenance.preventive',plan_ref:'plan:1',customer_ref:'cust:1',cadence:'ANNUAL',next_due_date:'2027-01-15',configured_policy_reference:'policy:p',qualification_requirement_refs:['qual:plumbing'],...overrides}; }

test('Pass 8 recurrence contract is projection-only and authority-neutral', () => {
  const out=r.buildLicensedTradeMaintenancePlan(base());
  assert.equal(out.recurrence_projection_only,true);
  for (const k of ['creates_or_updates_plan','creates_booking','creates_schedule','creates_job','creates_assignment','sends_reminder','mutates_asset_history','execution_permitted','grants_authority','qualification_metadata_grants_authority','continuity_preference_grants_assignment']) assert.equal(out[k],false);
  assert.equal(out.ready_for_shared_recurrence_handoff,true);
});

test('Pass 8 supports maintenance and compliance plans for all three trades', () => {
  const cases=[
    ['plumbing','plumbing.maintenance.preventive'],['electrical','electrical.maintenance.preventive'],['hvac','hvac.maintenance.preventive'],
    ['plumbing','plumbing.compliance.inspection'],['electrical','electrical.compliance.inspection'],['hvac','hvac.compliance.inspection'],
  ];
  for (const [trade,service_key] of cases) {
    const out=r.buildLicensedTradeMaintenancePlan(base({trade,service_key,qualification_requirement_refs:['qual:x']}));
    assert.equal(out.trade,trade); assert.equal(out.service_key,service_key); assert.equal(out.blockers.length,0);
  }
});

test('Pass 8 rejects fault, installation and emergency services as recurrence-plan services', () => {
  for (const service_key of ['plumbing.fault.leak-blockage','electrical.installation.circuit-equipment','hvac.emergency.critical-failure']) {
    const trade=service_key.split('.')[0];
    assert.throws(()=>r.buildLicensedTradeMaintenancePlan(base({trade,service_key})),/not recurrence-plan eligible/);
  }
});

test('Pass 8 validates cadence and deterministic reminder policy', () => {
  const out=r.buildLicensedTradeMaintenancePlan(base({cadence:'CUSTOM',custom_interval_days:45,reminder_policy:{customer_days_before:[7,30,7,1],internal_days_before:[3,14],overdue_after_days:5}}));
  assert.equal(out.cadence_days,45);
  assert.deepEqual(out.reminder_policy.customer_days_before,[30,7,1]);
  assert.deepEqual(out.reminder_policy.internal_days_before,[14,3]);
  assert.equal(out.reminder_policy.overdue_after_days,5);
  assert.throws(()=>r.buildLicensedTradeMaintenancePlan(base({cadence:'CUSTOM'})),/custom_interval_days/);
});

test('Pass 8 pause/resume/change are governed intents with fail-closed state checks', () => {
  const pause=r.buildLicensedTradeMaintenancePlan(base({state:'ACTIVE',intent:'PAUSE'}));
  assert.equal(pause.target_state,'PAUSED'); assert.equal(pause.lifecycle_handoff.requires_canonical_commit,true);
  const resume=r.buildLicensedTradeMaintenancePlan(base({state:'PAUSED',intent:'RESUME'}));
  assert.equal(resume.target_state,'ACTIVE');
  const badResume=r.buildLicensedTradeMaintenancePlan(base({state:'ACTIVE',intent:'RESUME'}));
  assert.ok(badResume.blockers.includes('PLAN_NOT_PAUSED'));
  const change=r.buildLicensedTradeMaintenancePlan(base({intent:'CHANGE'}));
  assert.ok(change.blockers.includes('CHANGE_REASON_REFERENCE_REQUIRED'));
});

test('Pass 8 requires due date, configured policy and qualification references before handoff', () => {
  const out=r.buildLicensedTradeMaintenancePlan(base({next_due_date:null,configured_policy_reference:null,qualification_requirement_refs:[]}));
  assert.ok(out.blockers.includes('NEXT_DUE_DATE_REQUIRED'));
  assert.ok(out.blockers.includes('CONFIGURED_POLICY_REFERENCE_REQUIRED'));
  assert.ok(out.blockers.includes('QUALIFICATION_REQUIREMENT_REFERENCE_REQUIRED'));
  assert.equal(out.ready_for_shared_recurrence_handoff,false);
});

test('Pass 8 preserves asset and worker continuity as non-authoritative references', () => {
  const out=r.buildLicensedTradeMaintenancePlan(base({asset_refs:['asset:b','asset:a','asset:a'],continuity_worker_refs:['worker:2','worker:1','worker:1']}));
  assert.deepEqual(out.asset_refs,['asset:a','asset:b']);
  assert.deepEqual(out.continuity_worker_refs,['worker:1','worker:2']);
  assert.equal(out.continuity_preference_grants_assignment,false);
  assert.equal(out.canonical_assignment_owner,'shared_workforce_assignment_owner');
});

test('Pass 8 rejects legacy tenant aliases, cross-trade services and invalid dates/reminders', () => {
  assert.throws(()=>r.buildLicensedTradeMaintenancePlan({...base(),tenant_id:'legacy'}),/legacy tenant boundary/);
  assert.throws(()=>r.buildLicensedTradeMaintenancePlan(base({trade:'hvac'})),/does not belong/);
  assert.throws(()=>r.buildLicensedTradeMaintenancePlan(base({next_due_date:'2027-02-30'})),/valid date/);
  assert.throws(()=>r.buildLicensedTradeMaintenancePlan(base({reminder_policy:{customer_days_before:[-1]}})),/between 0 and 365/);
});
