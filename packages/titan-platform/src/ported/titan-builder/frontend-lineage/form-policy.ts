// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/frontend-lineage/form-policy.mjs
export function publicFormSecurityPolicy({ company_id, type = 'contact' } = {}) {
  if (!company_id) throw new Error('company_id_required');
  if (!['contact', 'newsletter'].includes(type)) throw new Error('unsupported_form_type');
  return Object.freeze({
    schema: 'titan.builder.public-form-policy/v1',
    company_id,
    type,
    executionOwner: 'external_frontend_host',
    builderSubmissionAuthority: false,
    persistenceAuthority: false,
    serverRequirements: ['csrf', 'temporary_signed_action', 'rate_limit', 'honeypot'],
    privacy: { storeRawIp: false, storeRawUserAgent: false },
  });
}
