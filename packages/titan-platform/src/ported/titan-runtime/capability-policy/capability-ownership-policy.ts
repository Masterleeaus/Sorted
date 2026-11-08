// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/capability-policy/capability-ownership-policy.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { evaluateRestrictedSensitiveCapability } from './restricted-context-policy.js';

export const CAPABILITY_OWNERSHIP_POLICY_SCHEMA = 'titan.zero.capability-ownership-policy.v1';
export const CAPABILITY_OWNERSHIP_DECISION_SCHEMA = 'titan.zero.capability-ownership-decision.v1';

const OWNER = Object.freeze({ TITAN: 'TITAN', MONICA: 'MONICA', RETRIEVER: 'RETRIEVER' });
export const CAPABILITY_OWNERS = OWNER;

const CAPABILITY_OWNERSHIP = Object.freeze({
  storage: Object.freeze({ owners: [OWNER.TITAN, OWNER.MONICA, OWNER.RETRIEVER], inheritance: false }),
  scripting: Object.freeze({ owners: [OWNER.TITAN, OWNER.MONICA, OWNER.RETRIEVER], inheritance: false }),
  activeTab: Object.freeze({ owners: [OWNER.TITAN, OWNER.MONICA, OWNER.RETRIEVER], inheritance: false }),
  offscreen: Object.freeze({ owners: [OWNER.MONICA, OWNER.RETRIEVER], inheritance: false }),
  clipboardRead: Object.freeze({ owners: [OWNER.TITAN, OWNER.MONICA], inheritance: false }),
  navigation: Object.freeze({ owners: [OWNER.RETRIEVER], inheritance: false }),
  requestObservation: Object.freeze({ owners: [OWNER.RETRIEVER], inheritance: false }),
  tabGroups: Object.freeze({ owners: [OWNER.RETRIEVER], inheritance: false }),
  notifications: Object.freeze({ owners: [OWNER.RETRIEVER], inheritance: false }),
  cookies: Object.freeze({ owners: [OWNER.MONICA, OWNER.RETRIEVER], inheritance: false }),
  sidePanel: Object.freeze({ owners: [OWNER.TITAN], inheritance: false }),
  contextMenus: Object.freeze({ owners: [OWNER.TITAN], inheritance: false }),
  alarms: Object.freeze({ owners: [OWNER.TITAN], inheritance: false })
});

const clean = value => String(value ?? '').trim();
const upper = value => clean(value).toUpperCase();

function normalizeOwner(value) {
  const owner = upper(value);
  if (!Object.values(OWNER).includes(owner)) throw new Error(`capability-owner-invalid:${owner || 'empty'}`);
  return owner;
}

function normalizeCapability(value) {
  const raw = clean(value);
  const aliases = { webNavigation: 'navigation', webRequest: 'requestObservation' };
  return aliases[raw] || raw;
}

function descriptorFor(capability) {
  const descriptor = CAPABILITY_OWNERSHIP[capability];
  if (!descriptor) throw new Error(`capability-ownership-unknown:${capability || 'empty'}`);
  return descriptor;
}

export function evaluateCapabilityOwnership(input = {}) {
  rejectLegacyTenantAuthorityDeep(input, 'capability-ownership');
  const company_id = assertCanonicalCompanyId(input.company_id);
  const owner = normalizeOwner(input.owner ?? input.runtime_owner ?? input.requesting_runtime);
  const capability = normalizeCapability(input.capability);
  const descriptor = descriptorFor(capability);
  const source_owner = input.source_owner ? normalizeOwner(input.source_owner) : owner;
  const target_owner = input.target_owner ? normalizeOwner(input.target_owner) : owner;

  const base = {
    schema: CAPABILITY_OWNERSHIP_DECISION_SCHEMA,
    company_id,
    owner,
    capability,
    declared_owners: [...descriptor.owners],
    source_owner,
    target_owner,
    authority_neutral: true,
    identity_confers_authority: false,
    permission_confers_authority: false,
    capability_confers_authority: false,
    privilege_inheritance_permitted: false,
    cross_runtime_grant_permitted: false,
    cross_company_access_permitted: false
  };

  if (!descriptor.owners.includes(owner)) return Object.freeze({ ...base, allowed: false, reason: 'owner_not_entitled_to_capability' });
  if (source_owner !== target_owner || owner !== source_owner || owner !== target_owner) {
    return Object.freeze({ ...base, allowed: false, reason: 'cross_runtime_privilege_inheritance_denied' });
  }
  if (input.company_scope_verified !== true) return Object.freeze({ ...base, allowed: false, reason: 'company_scope_verification_required' });
  if (input.owner_scope_verified !== true) return Object.freeze({ ...base, allowed: false, reason: 'owner_scope_verification_required' });
  return Object.freeze({ ...base, allowed: true, reason: 'owner_capability_scope_satisfied' });
}

export function evaluateOwnedSensitiveCapability(input = {}) {
  const ownership = evaluateCapabilityOwnership(input);
  if (!ownership.allowed) return Object.freeze({
    schema: CAPABILITY_OWNERSHIP_POLICY_SCHEMA,
    company_id: ownership.company_id,
    owner: ownership.owner,
    capability: ownership.capability,
    allowed: false,
    reason: ownership.reason,
    ownership_decision: ownership,
    sensitive_decision: null,
    authority_neutral: true,
    permission_confers_authority: false,
    privilege_inheritance_permitted: false
  });

  if (!['scripting', 'activeTab', 'clipboardRead', 'navigation', 'requestObservation'].includes(ownership.capability)) {
    return Object.freeze({
      schema: CAPABILITY_OWNERSHIP_POLICY_SCHEMA,
      company_id: ownership.company_id,
      owner: ownership.owner,
      capability: ownership.capability,
      allowed: true,
      reason: 'owner_capability_scope_satisfied',
      ownership_decision: ownership,
      sensitive_decision: null,
      authority_neutral: true,
      permission_confers_authority: false,
      privilege_inheritance_permitted: false
    });
  }

  const sensitive = evaluateRestrictedSensitiveCapability({ ...input, capability: ownership.capability });
  return Object.freeze({
    schema: CAPABILITY_OWNERSHIP_POLICY_SCHEMA,
    company_id: ownership.company_id,
    owner: ownership.owner,
    capability: ownership.capability,
    allowed: sensitive.allowed === true,
    reason: sensitive.reason,
    ownership_decision: ownership,
    sensitive_decision: sensitive,
    authority_neutral: true,
    permission_confers_authority: false,
    privilege_inheritance_permitted: false
  });
}

export function getCapabilityOwnershipMatrix() {
  return Object.freeze(Object.fromEntries(Object.entries(CAPABILITY_OWNERSHIP).map(([key, value]) => [key, Object.freeze({ owners: [...value.owners], inheritance: false })])));
}
