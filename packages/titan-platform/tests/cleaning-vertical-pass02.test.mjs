import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEANING_SERVICE_CATALOGUE, CLEANING_SERVICE_BY_ID, getCleaningServiceCatalogue } from '../.cleaning-test-dist/verticals/cleaning/catalogue.js';

const REQUIRED = ['regular_clean','commercial_clean','bond_end_of_lease','airbnb_turnover','carpet_cleaning','upholstery_cleaning','window_cleaning','pressure_cleaning'];

test('Pass2 catalogue covers every required Cleaning vertical family', () => {
  const ids = new Set(CLEANING_SERVICE_CATALOGUE.map(service => service.id));
  for (const id of REQUIRED) assert.equal(ids.has(id), true, `missing ${id}`);
  assert.ok(CLEANING_SERVICE_CATALOGUE.length >= 12);
});

test('every catalogue service carries inclusions, exclusions, duration assumptions and add-ons', () => {
  for (const service of CLEANING_SERVICE_CATALOGUE) {
    assert.ok(service.inclusions.length > 0, `${service.id} inclusions`);
    assert.ok(service.exclusions.length > 0, `${service.id} exclusions`);
    assert.ok(service.duration.base_minutes > 0, `${service.id} duration`);
    assert.ok(service.duration.min_minutes <= service.duration.base_minutes);
    assert.ok(service.duration.max_minutes >= service.duration.base_minutes);
    assert.ok(Array.isArray(service.addons));
    assert.equal(service.grants_authority, false);
  }
});

test('retained bundle job types are semantically mapped where available', () => {
  assert.equal(CLEANING_SERVICE_BY_ID.regular_clean.retained_job_type_id, 'domestic_recurring');
  assert.equal(CLEANING_SERVICE_BY_ID.deep_clean.retained_job_type_id, 'deep_clean');
  assert.equal(CLEANING_SERVICE_BY_ID.bond_end_of_lease.retained_job_type_id, 'bond_end_of_lease');
  assert.equal(CLEANING_SERVICE_BY_ID.airbnb_turnover.retained_job_type_id, 'airbnb_turnover');
  assert.equal(CLEANING_SERVICE_BY_ID.commercial_clean.retained_job_type_id, 'commercial');
  assert.equal(CLEANING_SERVICE_BY_ID.office_clean.retained_job_type_id, 'office');
  assert.equal(CLEANING_SERVICE_BY_ID.move_in_out_clean.retained_job_type_id, 'move_in');
});

test('specialist/high-risk work remains explicit and quote-gated where appropriate', () => {
  for (const id of ['bond_end_of_lease','upholstery_cleaning','pressure_cleaning','post_construction_clean','custom_cleaning_service']) {
    assert.equal(CLEANING_SERVICE_BY_ID[id].quote_required, true, id);
  }
  assert.equal(CLEANING_SERVICE_BY_ID.pressure_cleaning.risk_level, 'HIGH');
  assert.equal(CLEANING_SERVICE_BY_ID.post_construction_clean.risk_level, 'HIGH');
});

test('catalogue projection preserves shared domain owners and confers no authority', () => {
  const view = getCleaningServiceCatalogue({ company_id:'company-a' });
  assert.equal(view.company_id, 'company-a');
  assert.equal(view.catalogue_is_projection, true);
  assert.equal(view.pricing_owner_unchanged, true);
  assert.equal(view.booking_owner_unchanged, true);
  assert.equal(view.scheduling_owner_unchanged, true);
  assert.equal(view.jobs_owner_unchanged, true);
  assert.equal(view.grants_authority, false);
  assert.equal(view.execution_permitted, false);
});

test('company boundary and unknown service filters fail closed', () => {
  assert.throws(() => getCleaningServiceCatalogue({ company_id:'' }), /company_id is required/);
  assert.throws(() => getCleaningServiceCatalogue({ company_id:'company-a', tenant_id:'legacy' }), /legacy tenant boundary/);
  assert.throws(() => getCleaningServiceCatalogue({ company_id:'company-a', include_ids:['regular_clean','missing'] }), /unknown cleaning service ids: missing/);
});

test('cleaning-native labels/descriptions do not introduce handyman terminology', () => {
  const visible = CLEANING_SERVICE_CATALOGUE.map(service => `${service.label} ${service.description}`).join(' ').toLowerCase();
  assert.equal(visible.includes('handyman'), false);
  assert.equal(visible.includes('dovetails'), false);
});

test('catalogue supports recurring service where operationally appropriate', () => {
  for (const id of ['regular_clean','deep_clean','airbnb_turnover','commercial_clean','office_clean','carpet_cleaning','window_cleaning','pressure_cleaning']) {
    assert.equal(CLEANING_SERVICE_BY_ID[id].recurring_supported, true, id);
  }
});
