// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/permissions/permission-gate.mjs
const text = value => String(value ?? '').trim();

export const PERMISSION_GATE_SCHEMA = 'titan.zero.permission-gate.v1';
export const PERMISSION_AUDIT_SCHEMA = 'titan.zero.permission-audit-event.v1';

export const SENSITIVE_PERMISSION_NAMES = Object.freeze(new Set([
  'activeTab', 'clipboardRead', 'clipboardWrite', 'cookies', 'scripting',
  'webNavigation', 'webRequest', 'webRequestBlocking'
]));

function assertCompanyId(value) {
  const company_id = text(value);
  if (!company_id) throw new Error('permission-gate-company_id-required');
  return company_id;
}

function normalizeList(values) {
  return Object.freeze([...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))].sort());
}

export function normalizePermissionSpec(input = {}) {
  const permissions = normalizeList(input.permissions);
  const origins = normalizeList(input.origins);
  if (!permissions.length && !origins.length) throw new Error('permission-gate-empty-spec');
  return Object.freeze({ permissions, origins });
}

export function createPermissionAuditEvent(input = {}) {
  const company_id = assertCompanyId(input.company_id);
  const action = text(input.action);
  const outcome = text(input.outcome);
  if (!action) throw new Error('permission-audit-action-required');
  if (!outcome) throw new Error('permission-audit-outcome-required');
  const spec = normalizePermissionSpec(input.spec);
  return Object.freeze({
    schema: PERMISSION_AUDIT_SCHEMA,
    company_id,
    action,
    outcome,
    permission_spec: spec,
    explicit_user_action: input.explicit_user_action === true,
    authority_neutral: true,
    identity_confers_authority: false,
    actor_ref: text(input.actor_ref),
    reason: text(input.reason),
    occurred_at: text(input.occurred_at) || new Date().toISOString()
  });
}

function defaultChromeProvider() {
  const api = globalThis.chrome?.permissions;
  if (!api) throw new Error('permission-gate-provider-unavailable');
  return {
    contains: spec => api.contains(spec),
    request: spec => api.request(spec),
    remove: spec => api.remove(spec)
  };
}

export function createPermissionGate(options = {}) {
  const provider = options.provider ?? defaultChromeProvider();
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const now = typeof options.now === 'function' ? options.now : () => new Date().toISOString();

  async function audit(payload) {
    const event = createPermissionAuditEvent({ ...payload, occurred_at: now() });
    await auditSink(event);
    return event;
  }

  async function contains(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const spec = normalizePermissionSpec(input);
    const granted = Boolean(await provider.contains(spec));
    await audit({ company_id, action: 'contains', outcome: granted ? 'granted' : 'not_granted', spec, explicit_user_action: false, actor_ref: input.actor_ref, reason: input.reason });
    return Object.freeze({ schema: PERMISSION_GATE_SCHEMA, company_id, granted, permission_spec: spec, authority_neutral: true, identity_confers_authority: false });
  }

  async function request(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const spec = normalizePermissionSpec(input);
    if (input.explicit_user_action !== true) {
      await audit({ company_id, action: 'request', outcome: 'blocked_no_user_action', spec, explicit_user_action: false, actor_ref: input.actor_ref, reason: input.reason });
      return Object.freeze({ schema: PERMISSION_GATE_SCHEMA, company_id, requested: false, granted: false, blocked: true, reason: 'explicit_user_action_required', permission_spec: spec, authority_neutral: true, identity_confers_authority: false });
    }
    const granted = Boolean(await provider.request(spec));
    await audit({ company_id, action: 'request', outcome: granted ? 'granted' : 'denied', spec, explicit_user_action: true, actor_ref: input.actor_ref, reason: input.reason });
    return Object.freeze({ schema: PERMISSION_GATE_SCHEMA, company_id, requested: true, granted, blocked: false, permission_spec: spec, authority_neutral: true, identity_confers_authority: false });
  }

  async function remove(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const spec = normalizePermissionSpec(input);
    if (input.explicit_user_action !== true) {
      await audit({ company_id, action: 'remove', outcome: 'blocked_no_user_action', spec, explicit_user_action: false, actor_ref: input.actor_ref, reason: input.reason });
      return Object.freeze({ schema: PERMISSION_GATE_SCHEMA, company_id, removed: false, blocked: true, reason: 'explicit_user_action_required', permission_spec: spec, authority_neutral: true, identity_confers_authority: false });
    }
    const removed = Boolean(await provider.remove(spec));
    await audit({ company_id, action: 'remove', outcome: removed ? 'removed' : 'not_removed', spec, explicit_user_action: true, actor_ref: input.actor_ref, reason: input.reason });
    return Object.freeze({ schema: PERMISSION_GATE_SCHEMA, company_id, removed, blocked: false, permission_spec: spec, authority_neutral: true, identity_confers_authority: false });
  }

  return Object.freeze({ contains, request, remove });
}
