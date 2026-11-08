// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/capability-policy/sensitive-capability-policy.mjs
const text = v => String(v ?? '').trim();

export const SENSITIVE_CAPABILITY_POLICY_SCHEMA = 'titan.zero.sensitive-capability-policy.v1';
export const SENSITIVE_CAPABILITY_DECISION_SCHEMA = 'titan.zero.sensitive-capability-decision.v1';

export const SENSITIVE_CAPABILITIES = Object.freeze({
  scripting: Object.freeze({ permission: 'scripting', risk: 'CRITICAL', user_action_required: true, target_required: true }),
  activeTab: Object.freeze({ permission: 'activeTab', risk: 'HIGH', user_action_required: true, target_required: true }),
  clipboardRead: Object.freeze({ permission: 'clipboardRead', risk: 'HIGH', user_action_required: true, target_required: false }),
  navigation: Object.freeze({ permission: 'webNavigation', risk: 'HIGH', user_action_required: true, target_required: true }),
  requestObservation: Object.freeze({ permission: 'webRequest', risk: 'CRITICAL', user_action_required: true, target_required: true })
});

function requireCompanyId(value) {
  const company_id = text(value);
  if (!company_id) throw new Error('sensitive-capability-company_id-required');
  return company_id;
}

function descriptorFor(name) {
  const capability = text(name);
  const descriptor = SENSITIVE_CAPABILITIES[capability];
  if (!descriptor) throw new Error(`sensitive-capability-unknown:${capability || 'empty'}`);
  return { capability, descriptor };
}

function base(company_id, capability, descriptor) {
  return {
    schema: SENSITIVE_CAPABILITY_DECISION_SCHEMA,
    company_id,
    capability,
    permission: descriptor.permission,
    risk: descriptor.risk,
    authority_neutral: true,
    identity_confers_authority: false,
    permission_confers_authority: false
  };
}

export function evaluateSensitiveCapability(input = {}) {
  const company_id = requireCompanyId(input.company_id);
  const { capability, descriptor } = descriptorFor(input.capability);
  const purpose = text(input.purpose);
  const target = text(input.target);
  const actor_ref = text(input.actor_ref);

  if (!purpose) return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'purpose_required', actor_ref, purpose, target });
  if (descriptor.user_action_required && input.explicit_user_action !== true) {
    return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'explicit_user_action_required', actor_ref, purpose, target });
  }
  if (descriptor.target_required && !target) {
    return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'target_required', actor_ref, purpose, target });
  }
  if (input.company_scope_verified !== true) {
    return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'company_scope_verification_required', actor_ref, purpose, target });
  }
  if (input.execution_authority_verified !== true) {
    return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'execution_authority_verification_required', actor_ref, purpose, target });
  }
  if (input.restricted_context === true) {
    return Object.freeze({ ...base(company_id, capability, descriptor), allowed: false, reason: 'restricted_context', actor_ref, purpose, target });
  }

  return Object.freeze({ ...base(company_id, capability, descriptor), allowed: true, reason: 'policy_satisfied', actor_ref, purpose, target });
}

export function createSensitiveCapabilityPolicy(options = {}) {
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();

  async function authorize(input = {}) {
    const decision = evaluateSensitiveCapability(input);
    await auditSink(Object.freeze({ schema: SENSITIVE_CAPABILITY_POLICY_SCHEMA, occurred_at: now(), ...decision }));
    return decision;
  }

  async function run(input = {}) {
    if (typeof input.operation !== 'function') throw new Error('sensitive-capability-operation-required');
    const decision = await authorize(input);
    if (!decision.allowed) {
      const fallback = typeof input.onBlocked === 'function' ? await input.onBlocked(decision) : undefined;
      return Object.freeze({ executed: false, decision, fallback, authority_neutral: true });
    }
    const value = await input.operation(decision);
    return Object.freeze({ executed: true, decision, value, authority_neutral: true });
  }

  return Object.freeze({ authorize, run });
}
