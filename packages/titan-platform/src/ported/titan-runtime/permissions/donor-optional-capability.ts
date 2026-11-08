// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/permissions/donor-optional-capability.mjs
import { createPermissionGate } from './permission-gate.js';

export const DONOR_OPTIONAL_CAPABILITY_SCHEMA = 'titan.zero.donor-optional-capability.v1';

export const DONOR_OPTIONAL_CAPABILITIES = Object.freeze({
  cookies: Object.freeze({ permissions: Object.freeze(['cookies']), manifest_state: 'optional_now', risk: 'CRITICAL' }),
  notifications: Object.freeze({ permissions: Object.freeze(['notifications']), manifest_state: 'manager_optionalization_required', risk: 'MEDIUM' }),
  offscreen: Object.freeze({ permissions: Object.freeze(['offscreen']), manifest_state: 'manager_optionalization_required', risk: 'MEDIUM' }),
  tabGroups: Object.freeze({ permissions: Object.freeze(['tabGroups']), manifest_state: 'manager_optionalization_required', risk: 'MEDIUM' }),
  webNavigation: Object.freeze({ permissions: Object.freeze(['webNavigation']), manifest_state: 'manager_optionalization_required', risk: 'HIGH' }),
  webRequest: Object.freeze({ permissions: Object.freeze(['webRequest']), manifest_state: 'manager_optionalization_required', risk: 'CRITICAL' })
});

const text = value => String(value ?? '').trim();

function assertCompanyId(value) {
  const company_id = text(value);
  if (!company_id) throw new Error('donor-optional-company_id-required');
  return company_id;
}

function resolveCapability(name) {
  const capability = text(name);
  const descriptor = DONOR_OPTIONAL_CAPABILITIES[capability];
  if (!descriptor) throw new Error(`donor-optional-unknown-capability:${capability || 'empty'}`);
  return { capability, descriptor };
}

function resultBase(company_id, capability, descriptor) {
  return {
    schema: DONOR_OPTIONAL_CAPABILITY_SCHEMA,
    company_id,
    capability,
    permissions: descriptor.permissions,
    manifest_state: descriptor.manifest_state,
    risk: descriptor.risk,
    authority_neutral: true,
    identity_confers_authority: false
  };
}

export function createDonorOptionalCapabilityBroker(options = {}) {
  const gate = options.gate ?? createPermissionGate(options.permissionGateOptions ?? {});

  async function status(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const { capability, descriptor } = resolveCapability(input.capability);
    if (descriptor.manifest_state !== 'optional_now') {
      return Object.freeze({
        ...resultBase(company_id, capability, descriptor),
        available: false,
        granted: false,
        reason: 'manifest_optionalization_pending_manager'
      });
    }
    const gateResult = await gate.contains({
      company_id,
      permissions: descriptor.permissions,
      actor_ref: input.actor_ref,
      reason: input.reason || `donor_optional_status:${capability}`
    });
    return Object.freeze({
      ...resultBase(company_id, capability, descriptor),
      available: true,
      granted: gateResult.granted,
      reason: gateResult.granted ? 'granted' : 'not_granted'
    });
  }

  async function request(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const { capability, descriptor } = resolveCapability(input.capability);
    if (descriptor.manifest_state !== 'optional_now') {
      return Object.freeze({
        ...resultBase(company_id, capability, descriptor),
        requested: false,
        granted: false,
        denied: true,
        degraded_gracefully: true,
        reason: 'manifest_optionalization_pending_manager'
      });
    }
    const gateResult = await gate.request({
      company_id,
      permissions: descriptor.permissions,
      explicit_user_action: input.explicit_user_action === true,
      actor_ref: input.actor_ref,
      reason: input.reason || `donor_optional_request:${capability}`
    });
    return Object.freeze({
      ...resultBase(company_id, capability, descriptor),
      requested: gateResult.requested === true,
      granted: gateResult.granted === true,
      denied: gateResult.granted !== true,
      degraded_gracefully: gateResult.granted !== true,
      reason: gateResult.granted ? 'granted' : (gateResult.reason || 'user_denied')
    });
  }

  async function run(input = {}) {
    const company_id = assertCompanyId(input.company_id);
    const { capability, descriptor } = resolveCapability(input.capability);
    if (typeof input.onGranted !== 'function') throw new Error('donor-optional-onGranted-required');
    const permission = await request(input);
    if (!permission.granted) {
      const fallback = typeof input.onDenied === 'function'
        ? await input.onDenied(permission)
        : undefined;
      return Object.freeze({
        ...resultBase(company_id, capability, descriptor),
        executed: false,
        degraded_gracefully: true,
        permission,
        fallback
      });
    }
    const value = await input.onGranted(permission);
    return Object.freeze({
      ...resultBase(company_id, capability, descriptor),
      executed: true,
      degraded_gracefully: false,
      permission,
      value
    });
  }

  return Object.freeze({ status, request, run });
}
