import test from 'node:test';
import assert from 'node:assert/strict';
const c = await import('../.licensed-trades-test-dist/catalogue.js');

test('Pass 2 exposes all three trades with five service classes each', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo' });
  assert.equal(out.schema, 'titan.zero.vertical.licensed-trades.catalogue.v1');
  assert.equal(out.service_count, 15);
  for (const trade of ['plumbing','electrical','hvac']) {
    const rows = out.services.filter((s) => s.trade === trade);
    assert.equal(rows.length, 5);
    assert.deepEqual(new Set(rows.map((s) => s.service_class)), new Set(['FAULT','MAINTENANCE','INSTALLATION','EMERGENCY','COMPLIANCE']));
  }
});

test('Pass 2 preserves shared business owners and authority neutrality', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo' });
  assert.equal(out.pricing_owner, 'shared_pricing_quote_owner');
  assert.equal(out.booking_owner, 'shared_booking_owner');
  assert.equal(out.scheduling_owner, 'shared_scheduling_owner');
  assert.equal(out.assignment_owner, 'shared_workforce_assignment_owner');
  assert.equal(out.jobs_owner, 'shared_jobs_owner');
  assert.equal(out.catalogue_grants_authority, false);
  assert.equal(out.service_selection_grants_authority, false);
  assert.equal(out.qualification_metadata_grants_authority, false);
  assert.equal(out.automatic_assignment, false);
  assert.equal(out.automatic_execution, false);
  assert.equal(out.automatic_compliance_certification, false);
});

test('Pass 2 compliance services require configured jurisdiction policy references', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo' });
  const compliance = out.services.filter((s) => s.service_class === 'COMPLIANCE');
  assert.equal(compliance.length, 3);
  assert.equal(compliance.every((s) => s.configured_policy_reference_required), true);
  assert.equal(compliance.every((s) => s.compliance_oriented), true);
  assert.equal(out.compliance_policy_owner, 'company_configured_jurisdiction_policy_owner');
});

test('Pass 2 emergency services require attendance and never encode automatic execution', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo' });
  const emergencies = out.services.filter((s) => s.service_class === 'EMERGENCY');
  assert.equal(emergencies.length, 3);
  assert.equal(emergencies.every((s) => s.emergency_capable), true);
  assert.equal(emergencies.every((s) => s.quote_mode === 'ATTENDANCE_REQUIRED'), true);
  assert.equal(out.automatic_execution, false);
});

test('Pass 2 includes HVAC native catalogue semantics despite donor gap', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo', trades: ['hvac'] });
  assert.equal(out.service_count, 5);
  assert.equal(out.services.every((s) => s.trade === 'hvac'), true);
  assert.ok(out.services.some((s) => s.asset_context.includes('refrigerant circuit')));
  assert.ok(out.services.some((s) => s.qualification_tags.some((q) => q.includes('refrigerant'))));
});

test('Pass 2 supports trade-scoped projection without changing company boundary', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo', trades: ['plumbing','electrical'] });
  assert.equal(out.company_id, 'company_demo');
  assert.equal(out.service_count, 10);
  assert.equal(out.services.some((s) => s.trade === 'hvac'), false);
});

test('Pass 2 rejects legacy tenant boundary recursively', () => {
  assert.throws(() => c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo', tenant_id: 'legacy' }), /legacy tenant boundary/);
  assert.throws(() => c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo', nested: { tenant_company_id: 'legacy' } }), /legacy tenant boundary/);
});

test('Pass 2 service keys are unique and definitions retain evidence + asset context', () => {
  const out = c.buildLicensedTradeServiceCatalogue({ company_id: 'company_demo' });
  assert.equal(new Set(out.services.map((s) => s.service_key)).size, out.service_count);
  assert.equal(out.services.every((s) => s.evidence_requirements.length > 0), true);
  assert.equal(out.services.every((s) => s.asset_context.length > 0), true);
  assert.equal(out.services.every((s) => s.qualification_tags.length > 0), true);
});
