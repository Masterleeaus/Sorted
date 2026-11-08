// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/permissions/permission-consent-controller.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { createPermissionGate } from './permission-gate.js';
import { createDonorOptionalCapabilityBroker } from './donor-optional-capability.js';

export const PERMISSION_CONSENT_CONTROLLER_SCHEMA = 'titan.zero.permission-consent-controller.v1';

const text = value => String(value ?? '').trim();

function assertCompanyId(value) {
  return assertCanonicalCompanyId(value);
}

function normalizeCapability(value) {
  const capability = text(value);
  if (!capability) throw new Error('permission-consent-capability-required');
  return capability;
}

function authorityNeutral(base = {}) {
  return Object.freeze({
    schema: PERMISSION_CONSENT_CONTROLLER_SCHEMA,
    ...base,
    authority_neutral: true,
    permission_presence_grants_authority: false,
    permission_confers_authority: false,
    identity_confers_authority: false,
    execution_permitted: false,
    grants_authority: false
  });
}

export function buildPermissionConsentViewModel(input = {}) {
  rejectLegacyTenantAuthorityDeep(input, 'permission-consent');
  const company_id = assertCompanyId(input.company_id);
  const capability = normalizeCapability(input.capability);
  const granted = input.granted === true;
  const pendingManager = input.pending_manager === true;
  const denied = input.denied === true;
  const state = pendingManager ? 'managed' : granted ? 'granted' : denied ? 'denied' : 'not_granted';
  return authorityNeutral({
    company_id,
    capability,
    state,
    granted,
    pending_manager: pendingManager,
    can_request: !pendingManager && !granted,
    can_revoke: !pendingManager && granted,
    message: pendingManager
      ? 'This capability remains managed by Titan until Manager-approved optionalization is available.'
      : granted
        ? 'Permission granted for this company context. Separate business authority is still required.'
        : denied
          ? 'Permission was not granted. Titan will continue with the safe fallback where available.'
          : 'Permission is not granted. It will only be requested from an explicit user action.'
  });
}

export function createPermissionConsentController(options = {}) {
  const gate = options.gate ?? createPermissionGate(options.permissionGateOptions ?? {});
  const broker = options.broker ?? createDonorOptionalCapabilityBroker({ gate });

  async function status(input = {}) {
    rejectLegacyTenantAuthorityDeep(input, 'permission-consent');
    const company_id = assertCompanyId(input.company_id);
    const capability = normalizeCapability(input.capability);
    const result = await broker.status({ company_id, capability, actor_ref: input.actor_ref, reason: input.reason });
    return buildPermissionConsentViewModel({
      company_id,
      capability,
      granted: result.granted === true,
      pending_manager: result.available === false && result.reason === 'manifest_optionalization_pending_manager'
    });
  }

  async function request(input = {}) {
    rejectLegacyTenantAuthorityDeep(input, 'permission-consent');
    const company_id = assertCompanyId(input.company_id);
    const capability = normalizeCapability(input.capability);
    if (input.explicit_user_action !== true) {
      return authorityNeutral({
        company_id,
        capability,
        state: 'blocked',
        granted: false,
        can_request: true,
        can_revoke: false,
        reason: 'explicit_user_action_required',
        message: 'Permission requests require an explicit user action.'
      });
    }
    const result = await broker.request({
      company_id,
      capability,
      explicit_user_action: true,
      actor_ref: input.actor_ref,
      reason: input.reason
    });
    return buildPermissionConsentViewModel({
      company_id,
      capability,
      granted: result.granted === true,
      denied: result.denied === true,
      pending_manager: result.reason === 'manifest_optionalization_pending_manager'
    });
  }

  async function revoke(input = {}) {
    rejectLegacyTenantAuthorityDeep(input, 'permission-consent');
    const company_id = assertCompanyId(input.company_id);
    const capability = normalizeCapability(input.capability);
    if (input.explicit_user_action !== true) {
      return authorityNeutral({
        company_id,
        capability,
        state: 'blocked',
        granted: true,
        can_request: false,
        can_revoke: true,
        reason: 'explicit_user_action_required',
        message: 'Permission revocation requires an explicit user action.'
      });
    }
    if (capability !== 'cookies') {
      return buildPermissionConsentViewModel({ company_id, capability, pending_manager: true });
    }
    const result = await gate.remove({
      company_id,
      permissions: ['cookies'],
      explicit_user_action: true,
      actor_ref: input.actor_ref,
      reason: input.reason || 'permission_consent_revoke:cookies'
    });
    return buildPermissionConsentViewModel({ company_id, capability, granted: result.removed !== true });
  }

  return Object.freeze({ status, request, revoke });
}
