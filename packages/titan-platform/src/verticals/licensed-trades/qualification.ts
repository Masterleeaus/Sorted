import { LICENSED_TRADE_SERVICE_CATALOGUE, type LicensedTradeServiceDefinition } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_QUALIFICATION_SCHEMA = 'titan.zero.vertical.licensed-trades.qualification.v1' as const;

export interface LicensedTradeQualificationRecord {
  company_id: string;
  worker_id: string;
  qualification_tag: string;
  verification_state?: 'VERIFIED' | 'UNVERIFIED' | 'REVOKED';
  certificate_ref?: string | null;
  evidence_refs?: readonly string[];
  valid_from?: number | null;
  expires_at?: number | null;
  configured_scope_refs?: readonly string[];
}

export interface LicensedTradeAssignmentQualificationInput {
  company_id: string;
  worker_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  site_id?: string | null;
  now?: number;
  qualification_records?: readonly LicensedTradeQualificationRecord[];
  configured_policy_reference?: string | null;
  required_certificate_refs?: readonly string[];
  required_evidence_refs?: readonly string[];
  base_scheduling_eligible?: boolean;
}

const LEGACY_BOUNDARY_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','workspace_tenant_id']);
function rejectLegacyBoundary(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((entry, index) => rejectLegacyBoundary(entry, `${path}[${index}]`));
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_BOUNDARY_KEYS.has(key)) throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is required`);
    rejectLegacyBoundary(nested, `${path}.${key}`);
  }
}
function requireText(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}
function list(value: readonly string[] | undefined): string[] {
  return [...new Set((value ?? []).map((entry) => String(entry).trim()).filter(Boolean))].sort();
}
function findService(trade: LicensedTradeKey, service_key: string): LicensedTradeServiceDefinition {
  const key = requireText(service_key, 'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === key);
  if (!service) throw new Error(`unknown licensed-trade service: ${key}`);
  if (service.trade !== trade) throw new Error(`service ${key} does not belong to trade ${trade}`);
  return service;
}

export function buildLicensedTradeAssignmentRequirements(input: {
  company_id: string;
  trade: LicensedTradeKey;
  service_key: string;
  site_id?: string | null;
  configured_policy_reference?: string | null;
}) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const service = findService(input.trade, input.service_key);
  const configured_policy_reference = String(input.configured_policy_reference ?? '').trim() || null;
  const blockers: string[] = [];
  if (service.configured_policy_reference_required && !configured_policy_reference) blockers.push('CONFIGURED_POLICY_REFERENCE_REQUIRED');

  return Object.freeze({
    schema: LICENSED_TRADES_QUALIFICATION_SCHEMA,
    company_id,
    trade: input.trade,
    service_key: service.service_key,
    site_id: String(input.site_id ?? '').trim() || null,
    required_qualification_tags: Object.freeze([...service.qualification_tags]),
    required_completion_evidence: Object.freeze([...service.evidence_requirements]),
    configured_policy_reference,
    blockers: Object.freeze(blockers),
    qualification_owner: 'shared_workforce_qualification_owner',
    assignment_owner: 'shared_workforce_assignment_owner',
    scheduling_owner: 'shared_scheduling_owner',
    jobs_evidence_owner: 'shared_jobs_owner',
    certificate_registry_owner: 'company_configured_qualification_registry_owner',
    scheduling_metadata_only: true,
    qualification_metadata_grants_authority: false,
    certificate_grants_authority: false,
    evidence_grants_authority: false,
    automatic_assignment: false,
    execution_permitted: false,
    grants_authority: false,
    requires_fresh_assignment_authority: true,
  });
}

export function evaluateLicensedTradeWorkerQualification(input: LicensedTradeAssignmentQualificationInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const worker_id = requireText(input.worker_id, 'worker_id');
  const service = findService(input.trade, input.service_key);
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const blockers: string[] = [];
  const records = input.qualification_records ?? [];
  const matched: Array<Record<string, unknown>> = [];

  for (const record of records) {
    rejectLegacyBoundary(record);
    if (requireText(record.company_id, 'qualification_record.company_id') !== company_id) throw new Error('cross-company qualification record');
    if (requireText(record.worker_id, 'qualification_record.worker_id') !== worker_id) throw new Error('qualification record belongs to another worker');
  }

  for (const tag of service.qualification_tags) {
    const candidates = records.filter((record) => String(record.qualification_tag ?? '').trim() === tag);
    const valid = candidates.find((record) => {
      if ((record.verification_state ?? 'UNVERIFIED') !== 'VERIFIED') return false;
      if (record.valid_from != null && Number(record.valid_from) > now) return false;
      if (record.expires_at != null && Number(record.expires_at) <= now) return false;
      return true;
    });
    if (!valid) {
      blockers.push(`MISSING_VERIFIED_QUALIFICATION:${tag}`);
      matched.push({ qualification_tag: tag, satisfied: false, certificate_ref: null, evidence_refs: [] });
    } else {
      matched.push({
        qualification_tag: tag,
        satisfied: true,
        certificate_ref: String(valid.certificate_ref ?? '').trim() || null,
        evidence_refs: list(valid.evidence_refs),
        configured_scope_refs: list(valid.configured_scope_refs),
      });
    }
  }

  const configured_policy_reference = String(input.configured_policy_reference ?? '').trim() || null;
  if (service.configured_policy_reference_required && !configured_policy_reference) blockers.push('CONFIGURED_POLICY_REFERENCE_REQUIRED');
  for (const ref of list(input.required_certificate_refs)) {
    const found = records.some((record) => String(record.certificate_ref ?? '').trim() === ref && record.verification_state === 'VERIFIED');
    if (!found) blockers.push(`REQUIRED_CERTIFICATE_REFERENCE_NOT_VERIFIED:${ref}`);
  }
  const evidence_refs = new Set<string>();
  for (const record of records) for (const ref of list(record.evidence_refs)) evidence_refs.add(ref);
  for (const ref of list(input.required_evidence_refs)) if (!evidence_refs.has(ref)) blockers.push(`REQUIRED_QUALIFICATION_EVIDENCE_MISSING:${ref}`);
  if (input.base_scheduling_eligible === false) blockers.push('BASE_SCHEDULING_INELIGIBLE');

  const uniqueBlockers = Object.freeze([...new Set(blockers)].sort());
  return Object.freeze({
    schema: LICENSED_TRADES_QUALIFICATION_SCHEMA,
    company_id,
    worker_id,
    trade: input.trade,
    service_key: service.service_key,
    site_id: String(input.site_id ?? '').trim() || null,
    matched_qualifications: Object.freeze(matched),
    blockers: uniqueBlockers,
    eligible_for_scheduling_proposal: uniqueBlockers.length === 0,
    assignment_permitted: false,
    execution_permitted: false,
    grants_authority: false,
    scheduling_metadata_only: true,
    identity_is_not_authority: true,
    qualification_is_not_authority: true,
    certificate_is_not_authority: true,
    evidence_is_not_authority: true,
    assignment_owner: 'shared_workforce_assignment_owner',
    scheduling_owner: 'shared_scheduling_owner',
    qualification_owner: 'shared_workforce_qualification_owner',
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
  });
}
