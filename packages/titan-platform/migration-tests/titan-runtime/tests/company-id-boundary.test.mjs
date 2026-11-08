import assert from 'node:assert/strict';
import { freezeEnvelope, rejectLegacyTenantAuthorityDeep } from '../boundary.mjs';
import { normalizeCompatibilityCompanyInput, createCompanyExecutionContext, bindCompanyBoundary, COMPANY_BOUNDARY_STAGES } from '../company-context.mjs';

const canonical = normalizeCompatibilityCompanyInput({ company_id: 'co-1', actor_id: 'a-1' });
assert.equal(canonical.company_id, 'co-1');
assert.equal(Object.hasOwn(canonical, 'tenant_id'), false);

const compat = normalizeCompatibilityCompanyInput({ tenant_id: 'co-2' }, { allowLegacyAliases: true });
assert.equal(compat.company_id, 'co-2');
assert.equal(Object.hasOwn(compat, 'tenant_id'), false);

assert.throws(() => normalizeCompatibilityCompanyInput({ tenant_id: 'co-x' }), /not an authority boundary/);
assert.throws(() => normalizeCompatibilityCompanyInput({ company_id: 'co-1', tenant_id: 'co-2' }, { allowLegacyAliases: true }), /conflicts/);
assert.throws(() => rejectLegacyTenantAuthorityDeep({ nested: { tenant_company_id: 'bad' } }), /not an authority boundary/);
assert.throws(() => freezeEnvelope({ company_id: 'co-1', nested: { tenant_id: 'co-1' } }), /not an authority boundary/);

const ctx = createCompanyExecutionContext({ company_id: 'co-1', actor_id: 'a-1', operation_id: 'op-1' });
for (const stage of COMPANY_BOUNDARY_STAGES) {
  const bound = bindCompanyBoundary(ctx, stage, { company_id: 'co-1', value: stage });
  assert.equal(bound.company_id, 'co-1');
  assert.equal(bound.company_boundary_stage, stage);
}
assert.throws(() => bindCompanyBoundary(ctx, 'execution', { company_id: 'co-other' }), /mismatch/);
console.log('company_id boundary tests PASS');
