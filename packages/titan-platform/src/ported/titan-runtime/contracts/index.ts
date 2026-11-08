// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/contracts/index.mjs
import registry from './registry.json' with { type: 'json' };
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../boundary.js';

export const TITAN_CONTRACT_REGISTRY_VERSION = registry.version;
export const listContracts = () => registry.contracts.map((entry) => ({ ...entry }));
export const getContract = (name) => registry.contracts.find((entry) => entry.name === name) || null;

export function assertContractEnvelope(value, { requireCompany = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('contract-envelope-object-required');
  rejectLegacyTenantAuthority(value, 'contract');
  if (requireCompany) assertCanonicalCompanyId(value.company_id);
  return value;
}

export function createContractEnvelope(type, value) {
  if (!getContract(type)) throw new Error(`unknown-contract:${type}`);
  const checked = assertContractEnvelope(value);
  return Object.freeze({ contract: type, registry_version: TITAN_CONTRACT_REGISTRY_VERSION, ...checked });
}
