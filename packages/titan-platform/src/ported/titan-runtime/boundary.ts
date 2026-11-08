// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/boundary.mjs
// Titan Zero browser-native runtime boundary foundation.
// Step 4: company_id is the sole canonical company/tenant authority boundary.

export const COMPANY_ID_FIELD = 'company_id';
export const LEGACY_TENANT_FIELDS = Object.freeze(['tenant_id', 'tenant_company_id']);

export function assertCanonicalCompanyId(value) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError('company_id is required');
  return value.trim();
}

export function rejectLegacyTenantAuthority(input, path = 'payload') {
  if (!input || typeof input !== 'object') return;
  for (const field of LEGACY_TENANT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, field)) {
      throw new TypeError(`${path}.${field} is not an authority boundary; normalize to company_id before runtime entry`);
    }
  }
}

export function rejectLegacyTenantAuthorityDeep(input, path = 'payload', seen = new WeakSet()) {
  if (!input || typeof input !== 'object') return;
  if (seen.has(input)) return;
  seen.add(input);
  rejectLegacyTenantAuthority(input, path);
  if (Array.isArray(input)) {
    input.forEach((value, index) => rejectLegacyTenantAuthorityDeep(value, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, value] of Object.entries(input)) {
    if (value && typeof value === 'object') rejectLegacyTenantAuthorityDeep(value, `${path}.${key}`, seen);
  }
}

export function freezeEnvelope(input) {
  if (!input || typeof input !== 'object') throw new TypeError('runtime envelope must be an object');
  rejectLegacyTenantAuthorityDeep(input);
  const company_id = assertCanonicalCompanyId(input.company_id);
  return Object.freeze({ ...input, company_id });
}
