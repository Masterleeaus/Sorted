import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCleaningPricingPolicy } from '../.cleaning-test-dist/verticals/cleaning/pricing.js';

const base = { company_id:'company-a', service_id:'regular_clean' };

test('Pass3 hourly policy projects crew-hours and shared minimum-price ownership', () => {
  const p = buildCleaningPricingPolicy({ ...base, requested_mode:'hourly', crew_size:2, estimated_minutes:150 });
  assert.equal(p.mode, 'hourly');
  assert.equal(p.unit, 'crew_hour');
  assert.equal(p.directives.find(d => d.code === 'base:hourly').value, 5);
  assert.equal(p.directives.some(d => d.code === 'minimum_service_fee' && d.source === 'shared_pricing_settings'), true);
  assert.equal(p.canonical_price_cents, null);
});

test('per-room and per-area modes require their cleaning-native quantity inputs', () => {
  assert.throws(() => buildCleaningPricingPolicy({ company_id:'company-a', service_id:'regular_clean', requested_mode:'per_room' }), /not supported/);
  const area = buildCleaningPricingPolicy({ company_id:'company-a', service_id:'commercial_clean', requested_mode:'per_area', area_m2:420 });
  assert.equal(area.directives.find(d => d.code === 'base:per_area').value, 420);
  assert.throws(() => buildCleaningPricingPolicy({ company_id:'company-a', service_id:'commercial_clean', requested_mode:'per_area' }), /area_m2 is required/);
});

test('recurring frequency discounts are hints and only allowed for recurring-capable services', () => {
  const p = buildCleaningPricingPolicy({ ...base, frequency:'weekly' });
  const d = p.directives.find(d => d.code === 'frequency:weekly');
  assert.equal(d.value, 10);
  assert.equal(d.unit, 'percent_hint');
  assert.throws(() => buildCleaningPricingPolicy({ company_id:'company-a', service_id:'bond_end_of_lease', frequency:'weekly' }), /does not support recurring/);
});

test('travel, consumables, extras and time/context surcharges are projected without canonical amounts', () => {
  const p = buildCleaningPricingPolicy({ ...base, travel_km:14, consumables_required:true, urgent:true, weekend:true, parking_or_tolls:true, addon_ids:['oven_clean'] });
  for (const code of ['travel','consumables','urgent_booking','weekend','parking_or_tolls','addon:oven_clean']) {
    const d = p.directives.find(x => x.code === code);
    assert.ok(d, code);
    assert.equal(d.canonical_amount_cents, null, code);
  }
  assert.throws(() => buildCleaningPricingPolicy({ ...base, addon_ids:['roof_repair'] }), /unsupported add-ons/);
});

test('quote gates fail closed for high-risk, unknown-condition and explicitly quote-required services', () => {
  const pressure = buildCleaningPricingPolicy({ company_id:'company-a', service_id:'pressure_cleaning', requested_mode:'quote_required' });
  assert.equal(pressure.requires_quote, true);
  assert.ok(pressure.quote_reasons.includes('HIGH_RISK_SERVICE_REQUIRES_REVIEW'));
  const unknown = buildCleaningPricingPolicy({ ...base, condition_level:'unknown' });
  assert.equal(unknown.requires_quote, true);
  assert.ok(unknown.quote_reasons.includes('CONDITION_REQUIRES_REVIEW'));
});

test('duration and crew assumptions escalate to quote review rather than silently changing price', () => {
  const p = buildCleaningPricingPolicy({ ...base, crew_size:5, estimated_minutes:500 });
  assert.equal(p.requires_quote, true);
  assert.ok(p.quote_reasons.includes('DURATION_EXCEEDS_CATALOGUE_ASSUMPTION'));
  assert.ok(p.quote_reasons.includes('CREW_SIZE_OUTSIDE_STANDARD_ASSUMPTION'));
  assert.equal(p.calculates_canonical_price, false);
});

test('pricing projection preserves canonical owners and grants no authority', () => {
  const p = buildCleaningPricingPolicy(base);
  assert.equal(p.pricing_owner, 'shared_pricing_price_book_and_settings');
  assert.equal(p.quote_owner, 'shared_customer_quote_flow');
  assert.equal(p.policy_is_projection, true);
  assert.equal(p.persists_price, false);
  assert.equal(p.calculates_canonical_price, false);
  assert.equal(p.grants_authority, false);
  assert.equal(p.execution_permitted, false);
});

test('company boundary and malformed numeric inputs fail closed', () => {
  assert.throws(() => buildCleaningPricingPolicy({ company_id:'', service_id:'regular_clean' }), /company_id is required/);
  assert.throws(() => buildCleaningPricingPolicy({ company_id:'company-a', service_id:'regular_clean', tenant_id:'legacy' }), /legacy tenant boundary/);
  assert.throws(() => buildCleaningPricingPolicy({ ...base, travel_km:-1 }), /travel_km must be a finite non-negative number/);
  assert.throws(() => buildCleaningPricingPolicy({ ...base, crew_size:1.5 }), /positive integer/);
});
