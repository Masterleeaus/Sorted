import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const gap = JSON.parse(fs.readFileSync(path.join(root, 'src/verticals/licensed-trades/pass01-gap-map.json'), 'utf8'));

let contracts;
try {
  contracts = await import('../.licensed-trades-test-dist/contracts.js');
} catch {
  contracts = null;
}

test('licensed-trades Pass 1 gap map is company scoped and authority neutral', () => {
  assert.equal(gap.schema, 'titan.zero.vertical.licensed-trades.gap-map.v1');
  assert.equal(gap.company_boundary, 'company_id');
  assert.equal(gap.identity_grants_authority, false);
  assert.equal(gap.production_behavior_changed, false);
  assert.equal(gap.guardrails.no_parallel_business_truth, true);
  assert.equal(gap.guardrails.no_parallel_workforce_runtime, true);
  assert.equal(gap.guardrails.no_automatic_assignment, true);
  assert.equal(gap.guardrails.no_automatic_execution, true);
  assert.equal(gap.guardrails.qualification_metadata_is_not_authority, true);
});

test('licensed-trades Pass 1 records plumbing and electrical donors and explicit HVAC gap', () => {
  const sources = new Set(gap.reuse_plan.map((entry) => entry.source));
  for (const expected of [
    'packages/domain/src/construction-profiles/plumbing.ts',
    'packages/domain/src/construction-profiles/electrical.ts',
    'packages/titan-platform/src/ported/titan-plumbing-workforce.ts',
    'packages/titan-platform/src/ported/titan-electrical-workforce.ts'
  ]) assert.equal(sources.has(expected), true, `missing donor ${expected}`);
  const hvac = gap.gap_map.find((entry) => entry.id === 'TRADE-GAP-001');
  assert.ok(hvac);
  assert.match(hvac.finding, /no equivalent native HVAC/i);
});

test('licensed-trades Pass 1 preserves canonical shared owners', () => {
  const owners = new Set(gap.shared_domain_owners_to_preserve);
  for (const owner of ['booking','scheduling','workforce assignment','jobs','pricing/quotes','assets/inventory','recurrence/rebooking','customer-care']) {
    assert.equal(owners.has(owner), true, `missing shared owner ${owner}`);
  }
});

test('licensed-trades Pass 1 treats jurisdiction rules as configured policy, not hard-coded authority', () => {
  const compliance = gap.gap_map.find((entry) => entry.id === 'TRADE-GAP-002');
  assert.ok(compliance);
  assert.match(compliance.finding, /policy references\/configuration/i);
  assert.match(compliance.handling, /historical examples only/i);
  assert.equal(gap.guardrails.no_unconfigured_regulatory_claims, true);
});

test('licensed-trades Pass 1 records handyman bias without rewriting shared estimate owners', () => {
  const shared = gap.gap_map.find((entry) => entry.id === 'TRADE-GAP-004');
  assert.ok(shared);
  assert.match(shared.finding, /handyman\/Dovetails/i);
  assert.match(shared.handling, /Do not mass-edit shared owners/i);
});

test('licensed-trades inventory contract exposes primitives without granting authority', { skip: contracts === null }, () => {
  const inventory = contracts.buildLicensedTradesPass1Inventory({ company_id: 'company_demo' });
  assert.equal(inventory.schema, 'titan.zero.vertical.licensed-trades.pass1.v1');
  assert.deepEqual([...inventory.trades], ['plumbing','electrical','hvac']);
  assert.equal(inventory.donor_matrix.plumbing.donor_state, 'ADAPT');
  assert.equal(inventory.donor_matrix.electrical.donor_state, 'ADAPT');
  assert.equal(inventory.donor_matrix.hvac.donor_state, 'GAP');
  assert.equal(inventory.trade_selection_grants_authority, false);
  assert.equal(inventory.qualification_metadata_grants_authority, false);
  assert.equal(inventory.automatic_assignment, false);
  assert.equal(inventory.automatic_execution, false);
  assert.equal(inventory.jurisdiction_rules_must_be_configured, true);
});

test('licensed-trades inventory rejects legacy tenant boundary', { skip: contracts === null }, () => {
  assert.throws(
    () => contracts.buildLicensedTradesPass1Inventory({ company_id: 'company_demo', tenant_id: 'legacy' }),
    /legacy tenant boundary/
  );
});
