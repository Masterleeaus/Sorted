import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const mapPath = path.join(root, 'src/verticals/cleaning/pass01-gap-map.json');
const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));

test('cleaning Pass 1 gap map is company scoped and authority neutral', () => {
  assert.equal(map.schema, 'titan.zero.vertical.cleaning.gap-map.v1');
  assert.equal(map.company_boundary, 'company_id');
  assert.equal(map.identity_grants_authority, false);
  assert.equal(map.production_behavior_changed, false);
  assert.equal(map.guardrails.no_parallel_business_truth, true);
  assert.equal(map.guardrails.no_parallel_workforce_runtime, true);
  assert.equal(map.guardrails.no_automatic_assignment, true);
  assert.equal(map.guardrails.no_authority_from_vertical_selection, true);
});

test('cleaning Pass 1 reuses retained donors before rewrite', () => {
  const sources = new Set(map.reuse_plan.map((entry) => entry.source));
  for (const expected of [
    'packages/titan-platform/src/ported/titan-cleaning-workforce.ts',
    'packages/titan-platform/src/ported/titan-workforce-cleaning-catalogue.ts',
    'packages/titan-platform/src/ported/titan-onboarding/runtime/cleaning-service-setup.ts',
    'packages/titan-platform/src/ported/titan-workforce/scheduling/cleaning-assignment-requirement-suggestions.ts',
    'packages/titan-platform/src/ported/titan-runtime/analytics/cleaning-kpi-definitions.ts'
  ]) assert.equal(sources.has(expected), true, `missing donor ${expected}`);
  assert.equal(map.reuse_plan.some((entry) => entry.disposition === 'REUSE_AS_REGRESSION_DONORS'), true);
});

test('cleaning Pass 1 preserves shared domain owners', () => {
  const owners = new Set(map.shared_domain_owners_to_preserve);
  for (const owner of ['booking','scheduling','jobs','reception','sales','customer-care','invoicing/payments']) {
    assert.equal(owners.has(owner), true, `missing shared owner ${owner}`);
  }
});

test('cleaning Pass 1 records handyman bias as a shared-owner gap rather than rewriting it', () => {
  const gap = map.gap_map.find((entry) => entry.id === 'CLEAN-GAP-002');
  assert.ok(gap);
  assert.match(gap.finding, /handyman/i);
  assert.match(gap.handling, /Do not mass-edit shared owners/i);
  assert.ok(gap.examples.includes('apps/web/lib/sms/classify.ts'));
});

test('cleaning Pass 2 entry criteria remain composition-first and company scoped', () => {
  assert.ok(map.pass2_entry_criteria.some((item) => /company_id only/i.test(item)));
  assert.ok(map.pass2_entry_criteria.some((item) => /configuration\/composition/i.test(item)));
  assert.ok(map.pass2_entry_criteria.some((item) => /handyman terminology/i.test(item)));
});
