import test from 'node:test';
import assert from 'node:assert/strict';
const p = await import('../.licensed-trades-test-dist/pricing.js');

test('Pass 5 pricing policy is projection-only and leaves canonical amounts with shared owners', () => {
  const out = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',requested_mode:'FIXED_SERVICE',configured_policy_reference:'policy/p'});
  assert.equal(out.canonical_price_cents, null);
  assert.equal(out.calculates_canonical_price, false);
  assert.equal(out.persists_price, false);
  assert.equal(out.issues_quote, false);
  assert.equal(out.pricing_owner, 'shared_price_book_and_pricing_settings_owner');
  assert.equal(out.grants_authority, false);
});

test('Pass 5 supports call-out, diagnostic, hourly, fixed and installation patterns', () => {
  const callout = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'electrical',service_key:'electrical.emergency.no-power-hazard',requested_mode:'CALL_OUT',configured_policy_reference:'policy/e'});
  assert.ok(callout.directives.some((d) => d.code === 'call_out'));
  const diag = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'hvac',service_key:'hvac.fault.no-cooling-heating',requested_mode:'DIAGNOSTIC',configured_policy_reference:'policy/h'});
  assert.ok(diag.directives.some((d) => d.code === 'diagnostic'));
  const hourly = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.fault.leak-blockage',requested_mode:'HOURLY_LABOUR',estimated_labour_minutes:90,configured_policy_reference:'policy/p'});
  assert.ok(hourly.directives.some((d) => d.code === 'hourly_labour' && d.value === 1.5));
  const fixed = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'hvac',service_key:'hvac.maintenance.preventive',requested_mode:'FIXED_SERVICE',configured_policy_reference:'policy/h'});
  assert.equal(fixed.mode, 'FIXED_SERVICE');
  const install = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'electrical',service_key:'electrical.installation.circuit-equipment',requested_mode:'INSTALLATION',configured_policy_reference:'policy/e'});
  assert.ok(install.directives.some((d) => d.code === 'installation'));
});

test('Pass 5 projects materials and after-hours/travel/urgent modifiers without amounts', () => {
  const out = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'hvac',service_key:'hvac.emergency.critical-failure',material_refs:['part:b','part:a','part:a'],after_hours:true,urgent:true,travel_required:true,configured_policy_reference:'policy/h'});
  assert.deepEqual(out.material_refs, ['part:a','part:b']);
  for (const code of ['materials','after_hours','urgent_attendance','travel']) assert.ok(out.directives.some((d) => d.code === code));
  assert.ok(out.directives.every((d) => d.canonical_amount_cents === null));
});

test('Pass 5 high-risk/compliance/attendance-required services fail into quote review', () => {
  const electrical = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'electrical',service_key:'electrical.fault.power-circuit',configured_policy_reference:'policy/e'});
  assert.equal(electrical.requires_quote, true);
  assert.ok(electrical.quote_reasons.includes('SERVICE_QUOTE_MODE_ATTENDANCE_REQUIRED'));
  const compliance = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.compliance.inspection',configured_policy_reference:'policy/p'});
  assert.equal(compliance.requires_quote, true);
  assert.ok(compliance.quote_reasons.includes('COMPLIANCE_ORIENTED_SERVICE_REQUIRES_REVIEW'));
});

test('Pass 5 unknown scope, missing asset context and policy reference fail closed into review', () => {
  const out = p.buildLicensedTradePricingPolicy({company_id:'c',trade:'hvac',service_key:'hvac.fault.no-cooling-heating',unknown_scope:true,asset_context_complete:false});
  assert.equal(out.requires_quote, true);
  assert.ok(out.quote_reasons.includes('UNKNOWN_SCOPE_REQUIRES_REVIEW'));
  assert.ok(out.quote_reasons.includes('ASSET_CONTEXT_INCOMPLETE'));
  assert.ok(out.quote_reasons.includes('CONFIGURED_POLICY_REFERENCE_REQUIRED'));
});

test('Pass 5 rejects cross-trade service selection and legacy tenant aliases', () => {
  assert.throws(() => p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'electrical.fault.power-circuit'}), /does not belong/);
  assert.throws(() => p.buildLicensedTradePricingPolicy({company_id:'c',tenant_id:'legacy',trade:'plumbing',service_key:'plumbing.maintenance.preventive'}), /legacy tenant boundary/);
});

test('Pass 5 validates positive labour/crew assumptions and installation mode eligibility', () => {
  assert.throws(() => p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',crew_size:0}), /greater than zero/);
  assert.throws(() => p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',estimated_labour_minutes:0}), /greater than zero/);
  assert.throws(() => p.buildLicensedTradePricingPolicy({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',requested_mode:'INSTALLATION'}), /not supported/);
});
