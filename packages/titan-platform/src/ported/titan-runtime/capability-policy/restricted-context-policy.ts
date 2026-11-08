// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/capability-policy/restricted-context-policy.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { evaluateSensitiveCapability } from './sensitive-capability-policy.js';

export const RESTRICTED_CONTEXT_POLICY_SCHEMA = 'titan.zero.restricted-context-policy.v1';
export const RESTRICTED_CONTEXT_DECISION_SCHEMA = 'titan.zero.restricted-context-decision.v1';

const BROWSER_RESTRICTED_PROTOCOLS = new Set(['chrome:', 'edge:', 'about:', 'devtools:', 'view-source:', 'file:']);
const PAYMENT_TOKENS = /(^|[\/_\-.])(checkout|payment|payments|pay|billing|card|wallet|banking)([\/_\-.]|$)/i;
const AUTH_TOKENS = /(^|[\/_\-.])(login|log-in|signin|sign-in|signup|sign-up|oauth|authorize|authorization|auth|sso|mfa|2fa|password|session)([\/_\-.]|$)/i;

const clean = value => String(value ?? '').trim();

function parseTarget(target) {
  const value = clean(target);
  if (!value) return { value, url: null };
  try { return { value, url: new URL(value) }; }
  catch { return { value, url: null }; }
}

function normalizeCategory(value) {
  const category = clean(value).toLowerCase().replace(/[\s_-]+/g, '-');
  if (['payment', 'payment-page', 'checkout', 'banking', 'financial'].includes(category)) return 'PAYMENT';
  if (['auth', 'authentication', 'login', 'sign-in', 'signin', 'oauth', 'sso', 'identity'].includes(category)) return 'AUTHENTICATION';
  if (['restricted', 'restricted-site', 'browser-internal', 'sensitive'].includes(category)) return 'RESTRICTED';
  return category ? 'OTHER' : 'UNKNOWN';
}

function classifyTarget(input = {}) {
  const parsed = parseTarget(input.target);
  const category = normalizeCategory(input.page_category ?? input.target_category);
  if (input.restricted_site === true || input.restricted_context === true || category === 'RESTRICTED') {
    return { restricted: true, class: 'RESTRICTED_SITE', reason: 'restricted_site' };
  }
  if (category === 'PAYMENT') return { restricted: true, class: 'PAYMENT_PAGE', reason: 'payment_page' };
  if (category === 'AUTHENTICATION') return { restricted: true, class: 'AUTHENTICATION_PAGE', reason: 'authentication_page' };
  if (!parsed.url) return { restricted: false, class: 'UNCLASSIFIED_TARGET', reason: 'target_not_url' };
  if (BROWSER_RESTRICTED_PROTOCOLS.has(parsed.url.protocol)) {
    return { restricted: true, class: 'BROWSER_RESTRICTED', reason: 'browser_restricted_scheme' };
  }
  const signal = `${parsed.url.hostname}${parsed.url.pathname}`;
  if (PAYMENT_TOKENS.test(signal)) return { restricted: true, class: 'PAYMENT_PAGE', reason: 'payment_page' };
  if (AUTH_TOKENS.test(signal)) return { restricted: true, class: 'AUTHENTICATION_PAGE', reason: 'authentication_page' };
  return { restricted: false, class: 'GENERAL_WEB', reason: 'general_web' };
}

function companyMismatch(input, company_id) {
  for (const key of ['target_company_id', 'context_company_id', 'verified_company_id']) {
    const value = clean(input[key]);
    if (value && value !== company_id) return key;
  }
  return '';
}

export function evaluateRestrictedContext(input = {}) {
  rejectLegacyTenantAuthorityDeep(input, 'restricted-context');
  const company_id = assertCanonicalCompanyId(input.company_id);
  const target = clean(input.target);
  const mismatch_field = companyMismatch(input, company_id);
  const classification = classifyTarget(input);

  const base = {
    schema: RESTRICTED_CONTEXT_DECISION_SCHEMA,
    company_id,
    target,
    target_class: classification.class,
    authority_neutral: true,
    identity_confers_authority: false,
    permission_confers_authority: false,
    fallback_escalation_permitted: false,
    cross_company_access_permitted: false
  };

  if (mismatch_field) return Object.freeze({ ...base, allowed: false, reason: 'company_scope_mismatch', mismatch_field });
  if (input.company_scope_verified !== true) return Object.freeze({ ...base, allowed: false, reason: 'company_scope_verification_required' });
  if (classification.restricted) return Object.freeze({ ...base, allowed: false, reason: classification.reason });
  return Object.freeze({ ...base, allowed: true, reason: 'target_context_allowed' });
}

export function evaluateRestrictedSensitiveCapability(input = {}) {
  const context = evaluateRestrictedContext(input);
  if (!context.allowed) {
    return Object.freeze({
      schema: RESTRICTED_CONTEXT_POLICY_SCHEMA,
      company_id: context.company_id,
      capability: clean(input.capability),
      target: context.target,
      target_class: context.target_class,
      allowed: false,
      reason: context.reason,
      context_decision: context,
      sensitive_decision: null,
      authority_neutral: true,
      permission_confers_authority: false,
      fallback_escalation_permitted: false
    });
  }

  const sensitive = evaluateSensitiveCapability({ ...input, restricted_context: false });
  return Object.freeze({
    schema: RESTRICTED_CONTEXT_POLICY_SCHEMA,
    company_id: context.company_id,
    capability: sensitive.capability,
    target: context.target,
    target_class: context.target_class,
    allowed: sensitive.allowed === true,
    reason: sensitive.reason,
    context_decision: context,
    sensitive_decision: sensitive,
    authority_neutral: true,
    permission_confers_authority: false,
    fallback_escalation_permitted: false
  });
}

export function createRestrictedCapabilityPolicy(options = {}) {
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();

  async function authorize(input = {}) {
    const decision = evaluateRestrictedSensitiveCapability(input);
    await auditSink(Object.freeze({ schema: RESTRICTED_CONTEXT_POLICY_SCHEMA, occurred_at: now(), ...decision }));
    return decision;
  }

  async function run(input = {}) {
    if (typeof input.operation !== 'function') throw new Error('restricted-capability-operation-required');
    const decision = await authorize(input);
    if (!decision.allowed) {
      const fallback = typeof input.onBlocked === 'function' ? await input.onBlocked(decision) : undefined;
      return Object.freeze({ executed: false, decision, fallback, authority_neutral: true, fallback_escalated: false });
    }
    const value = await input.operation(decision);
    return Object.freeze({ executed: true, decision, value, authority_neutral: true, fallback_escalated: false });
  }

  return Object.freeze({ authorize, run });
}
