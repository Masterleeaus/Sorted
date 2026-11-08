import test from 'node:test';
import assert from 'node:assert/strict';
const a = await import('../.licensed-trades-test-dist/assets.js');

test('Pass 6 asset context is projection-only and leaves mutation with shared owners', () => {
  const out = a.buildLicensedTradeAssetContext({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',asset_kind:'HOT_WATER_SYSTEM',asset_ref:'asset:1',manufacturer:'Acme',model:'H100',serial_number:'S1',site_location:'plant room',configured_asset_policy_reference:'policy/assets'});
  assert.equal(out.asset_owner, 'shared_assets_inventory_owner');
  assert.equal(out.registers_asset, false);
  assert.equal(out.updates_asset, false);
  assert.equal(out.assigns_asset, false);
  assert.equal(out.mutates_service_history, false);
  assert.equal(out.grants_authority, false);
  assert.equal(out.execution_permitted, false);
});

test('Pass 6 captures plumbing hot-water identity, site and history references', () => {
  const out = a.buildLicensedTradeAssetContext({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',asset_kind:'HOT_WATER_SYSTEM',asset_ref:'asset:hws',manufacturer:'Brand',model:'X',serial_number:'ABC',site_location:'roof plant',installation_date:'2025-01-01',condition_reference:'condition:good',configured_asset_policy_reference:'policy/p',service_history:[{history_ref:'history:2',service_date:'2026-06-01',job_ref:'job:2',evidence_refs:['e:2','e:1','e:1']}]});
  assert.equal(out.identity.serial_number, 'ABC');
  assert.equal(out.site_location, 'roof plant');
  assert.deepEqual(out.service_history[0].evidence_refs, ['e:1','e:2']);
  assert.equal(out.context_complete, true);
});

test('Pass 6 supports electrical switchboard and circuit asset context', () => {
  assert.deepEqual(a.getLicensedTradeAssetKinds('electrical'), ['SWITCHBOARD','ELECTRICAL_CIRCUIT','ELECTRICAL_EQUIPMENT','OTHER_CONFIGURED_ASSET']);
  const out = a.buildLicensedTradeAssetContext({company_id:'c',trade:'electrical',service_key:'electrical.maintenance.preventive',asset_kind:'SWITCHBOARD',asset_ref:'asset:sb',model:'SB-1',serial_number:'E1',site_location:'main switch room',configured_asset_policy_reference:'policy/e'});
  assert.equal(out.trade, 'electrical');
  assert.equal(out.asset_kind, 'SWITCHBOARD');
});

test('Pass 6 supplies first-class HVAC unit/control asset context despite donor gap', () => {
  assert.deepEqual(a.getLicensedTradeAssetKinds('hvac'), ['HVAC_UNIT','HVAC_CONTROL','OTHER_CONFIGURED_ASSET']);
  const out = a.buildLicensedTradeAssetContext({company_id:'c',trade:'hvac',service_key:'hvac.maintenance.preventive',asset_kind:'HVAC_UNIT',asset_ref:'asset:ahu',manufacturer:'CoolCo',model:'AHU-2',serial_number:'H2',site_location:'level 4',configured_asset_policy_reference:'policy/h'});
  assert.equal(out.asset_kind, 'HVAC_UNIT');
  assert.equal(out.context_complete, true);
});

test('Pass 6 reports missing identity/site/policy as readiness gaps rather than inventing data', () => {
  const out = a.buildLicensedTradeAssetContext({company_id:'c',trade:'hvac',service_key:'hvac.fault.no-cooling-heating',asset_kind:'HVAC_UNIT'});
  assert.equal(out.context_complete, false);
  for (const gap of ['ASSET_REFERENCE_MISSING','SITE_LOCATION_MISSING','MODEL_MISSING','SERIAL_NUMBER_MISSING','CONFIGURED_ASSET_POLICY_REFERENCE_MISSING']) assert.ok(out.readiness_gaps.includes(gap));
});

test('Pass 6 rejects cross-trade asset kinds and service selection', () => {
  assert.throws(() => a.buildLicensedTradeAssetContext({company_id:'c',trade:'plumbing',service_key:'plumbing.maintenance.preventive',asset_kind:'SWITCHBOARD'}), /not valid for trade/);
  assert.throws(() => a.buildLicensedTradeAssetContext({company_id:'c',trade:'plumbing',service_key:'electrical.maintenance.preventive',asset_kind:'HOT_WATER_SYSTEM'}), /does not belong/);
});

test('Pass 6 rejects legacy tenant aliases and malformed service dates', () => {
  assert.throws(() => a.buildLicensedTradeAssetContext({company_id:'c',tenant_id:'legacy',trade:'hvac',service_key:'hvac.maintenance.preventive',asset_kind:'HVAC_UNIT'}), /legacy tenant boundary/);
  assert.throws(() => a.buildLicensedTradeAssetContext({company_id:'c',trade:'hvac',service_key:'hvac.maintenance.preventive',asset_kind:'HVAC_UNIT',service_history:[{history_ref:'h',service_date:'not-a-date'}]}), /ISO date/);
});
