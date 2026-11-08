import test from 'node:test';
import assert from 'node:assert/strict';
const q = await import('../.licensed-trades-test-dist/qualification.js');

test('Pass 4 projects service qualification requirements as scheduling metadata only', () => {
  const out = q.buildLicensedTradeAssignmentRequirements({ company_id:'c', trade:'electrical', service_key:'electrical.installation.circuit-equipment', configured_policy_reference:'policy/electrical' });
  assert.ok(out.required_qualification_tags.includes('electrical_licensed_worker_required'));
  assert.equal(out.scheduling_metadata_only, true);
  assert.equal(out.assignment_owner, 'shared_workforce_assignment_owner');
  assert.equal(out.automatic_assignment, false);
  assert.equal(out.grants_authority, false);
});

test('Pass 4 blocks missing configured policy references', () => {
  const out = q.buildLicensedTradeAssignmentRequirements({ company_id:'c', trade:'plumbing', service_key:'plumbing.compliance.inspection' });
  assert.ok(out.blockers.includes('CONFIGURED_POLICY_REFERENCE_REQUIRED'));
});

test('Pass 4 verified current qualification can produce scheduling candidate only', () => {
  const now = 2_000_000;
  const out = q.evaluateLicensedTradeWorkerQualification({ company_id:'c', worker_id:'w1', trade:'electrical', service_key:'electrical.fault.power-circuit', configured_policy_reference:'policy/current', now, qualification_records:[{ company_id:'c', worker_id:'w1', qualification_tag:'electrical_licensed_worker_required', verification_state:'VERIFIED', certificate_ref:'cert-1', evidence_refs:['ev-1'], valid_from:now-100, expires_at:now+100 }] });
  assert.equal(out.eligible_for_scheduling_proposal, true);
  assert.equal(out.assignment_permitted, false);
  assert.equal(out.execution_permitted, false);
  assert.equal(out.grants_authority, false);
});

test('Pass 4 expired/revoked/unverified qualifications fail closed', () => {
  const base = { company_id:'c', worker_id:'w1', trade:'plumbing', service_key:'plumbing.installation.fixture-system', configured_policy_reference:'policy/current', now:1000 };
  for (const record of [
    {company_id:'c',worker_id:'w1',qualification_tag:'plumbing_licensed_worker_required',verification_state:'UNVERIFIED'},
    {company_id:'c',worker_id:'w1',qualification_tag:'plumbing_licensed_worker_required',verification_state:'REVOKED'},
    {company_id:'c',worker_id:'w1',qualification_tag:'plumbing_licensed_worker_required',verification_state:'VERIFIED',expires_at:999},
  ]) {
    const out = q.evaluateLicensedTradeWorkerQualification({...base, qualification_records:[record]});
    assert.equal(out.eligible_for_scheduling_proposal, false);
    assert.ok(out.blockers.some((b) => b.startsWith('MISSING_VERIFIED_QUALIFICATION:')));
  }
});

test('Pass 4 supports HVAC configured qualification combinations without hard-coding jurisdiction claims', () => {
  const out = q.evaluateLicensedTradeWorkerQualification({ company_id:'c', worker_id:'w2', trade:'hvac', service_key:'hvac.installation.system', configured_policy_reference:'policy/hvac', qualification_records:[
    {company_id:'c',worker_id:'w2',qualification_tag:'hvac_installation_scope',verification_state:'VERIFIED',certificate_ref:'scope-cert'},
    {company_id:'c',worker_id:'w2',qualification_tag:'configured_refrigerant_or_electrical_qualification_when_required',verification_state:'VERIFIED',certificate_ref:'configured-cert'},
  ]});
  assert.equal(out.eligible_for_scheduling_proposal, true);
  assert.equal(out.qualification_is_not_authority, true);
});

test('Pass 4 required certificate and evidence hooks fail closed when absent', () => {
  const out = q.evaluateLicensedTradeWorkerQualification({ company_id:'c', worker_id:'w1', trade:'plumbing', service_key:'plumbing.maintenance.preventive', configured_policy_reference:'policy/current', required_certificate_refs:['cert-required'], required_evidence_refs:['evidence-required'], qualification_records:[{company_id:'c',worker_id:'w1',qualification_tag:'plumbing_scope_match',verification_state:'VERIFIED'}] });
  assert.ok(out.blockers.includes('REQUIRED_CERTIFICATE_REFERENCE_NOT_VERIFIED:cert-required'));
  assert.ok(out.blockers.includes('REQUIRED_QUALIFICATION_EVIDENCE_MISSING:evidence-required'));
  assert.equal(out.eligible_for_scheduling_proposal, false);
});

test('Pass 4 base scheduling ineligibility remains a blocker even with qualifications', () => {
  const out = q.evaluateLicensedTradeWorkerQualification({ company_id:'c', worker_id:'w1', trade:'hvac', service_key:'hvac.maintenance.preventive', configured_policy_reference:'policy/current', base_scheduling_eligible:false, qualification_records:[{company_id:'c',worker_id:'w1',qualification_tag:'hvac_scope_match',verification_state:'VERIFIED'}] });
  assert.ok(out.blockers.includes('BASE_SCHEDULING_INELIGIBLE'));
  assert.equal(out.eligible_for_scheduling_proposal, false);
});

test('Pass 4 rejects cross-company qualification evidence and legacy tenant aliases', () => {
  assert.throws(() => q.evaluateLicensedTradeWorkerQualification({ company_id:'c', worker_id:'w', trade:'electrical', service_key:'electrical.maintenance.preventive', configured_policy_reference:'p', qualification_records:[{company_id:'other',worker_id:'w',qualification_tag:'electrical_licensed_worker_required',verification_state:'VERIFIED'}] }), /cross-company/);
  assert.throws(() => q.evaluateLicensedTradeWorkerQualification({ company_id:'c', tenant_id:'legacy', worker_id:'w', trade:'hvac', service_key:'hvac.maintenance.preventive' }), /legacy tenant boundary/);
});
