// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/company-context.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from './boundary.js';

export const COMPANY_BOUNDARY_STAGES = Object.freeze([
  'authorization', 'storage', 'projection', 'decision', 'execution'
]);

export function normalizeCompatibilityCompanyInput(input, { allowLegacyAliases = false } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('company context input must be an object');
  const out = { ...input };
  const aliases = ['tenant_id', 'tenant_company_id'];
  const legacyValues = aliases.filter((k) => Object.prototype.hasOwnProperty.call(out, k)).map((k) => [k, out[k]]);

  if (legacyValues.length && !allowLegacyAliases) {
    rejectLegacyTenantAuthority(out, 'company_context');
  }

  let companyId = out.company_id;
  if ((companyId === undefined || companyId === null || companyId === '') && legacyValues.length) {
    companyId = legacyValues[0][1];
  }
  if (legacyValues.length) {
    const canonical = assertCanonicalCompanyId(companyId);
    for (const [field, value] of legacyValues) {
      if (assertCanonicalCompanyId(value) !== canonical) {
        throw new TypeError(`${field} conflicts with company_id`);
      }
      delete out[field];
    }
    out.company_id = canonical;
  } else {
    out.company_id = assertCanonicalCompanyId(companyId);
  }
  return Object.freeze(out);
}

export function createCompanyExecutionContext(input, options = {}) {
  const normalized = normalizeCompatibilityCompanyInput(input, options);
  const context = {
    company_id: normalized.company_id,
    actor_id: normalized.actor_id ?? null,
    device_id: normalized.device_id ?? null,
    correlation_id: normalized.correlation_id ?? null,
    operation_id: normalized.operation_id ?? null,
    source: normalized.source ?? 'titan-runtime',
  };
  return Object.freeze(context);
}

export function assertCompanyBoundaryMatch(expectedCompanyId, candidate, stage = 'runtime') {
  const expected = assertCanonicalCompanyId(expectedCompanyId);
  if (!candidate || typeof candidate !== 'object') throw new TypeError(`${stage} payload must be an object`);
  rejectLegacyTenantAuthority(candidate, stage);
  const actual = assertCanonicalCompanyId(candidate.company_id);
  if (actual !== expected) throw new TypeError(`${stage} company_id mismatch`);
  return actual;
}

export function bindCompanyBoundary(context, stage, payload) {
  if (!COMPANY_BOUNDARY_STAGES.includes(stage)) throw new TypeError(`unsupported company boundary stage: ${stage}`);
  assertCompanyBoundaryMatch(context.company_id, payload, stage);
  return Object.freeze({ ...payload, company_id: context.company_id, company_boundary_stage: stage });
}
