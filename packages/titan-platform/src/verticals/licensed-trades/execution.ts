import { LICENSED_TRADE_SERVICE_CATALOGUE } from './catalogue.js';
import type { LicensedTradeKey } from './contracts.js';

export const LICENSED_TRADES_EXECUTION_SCHEMA = 'titan.zero.vertical.licensed-trades.execution-pack.v1' as const;

type EvidenceKind = 'BEFORE_CONDITION' | 'ISOLATION_SAFE_STATE' | 'TEST_RESULT' | 'WORK_PERFORMED' | 'MATERIALS_USED' | 'COMMISSIONING' | 'QUALIFIED_SIGN_OFF' | 'EXCEPTION' | 'CUSTOMER_SUMMARY';

export interface LicensedTradeExecutionEvidenceInput {
  evidence_kind: EvidenceKind;
  evidence_ref?: string | null;
  status?: 'PENDING' | 'CAPTURED' | 'NOT_APPLICABLE';
  note?: string | null;
}
export interface LicensedTradeMaterialUseInput {
  material_ref: string;
  quantity?: number;
  unit?: string | null;
  evidence_ref?: string | null;
}
export interface LicensedTradeFollowUpInput {
  follow_up_ref: string;
  summary: string;
  priority?: 'ROUTINE' | 'PRIORITY' | 'URGENT_REVIEW';
  owner_hint?: 'JOBS' | 'CUSTOMER_CARE' | 'QUOTE' | 'ASSETS';
}
export interface LicensedTradeExecutionPackInput {
  company_id: string;
  job_ref: string;
  trade: LicensedTradeKey;
  service_key: string;
  worker_ref?: string | null;
  asset_refs?: readonly string[];
  checklist_completed_keys?: readonly string[];
  evidence?: readonly LicensedTradeExecutionEvidenceInput[];
  materials_used?: readonly LicensedTradeMaterialUseInput[];
  follow_up_work?: readonly LicensedTradeFollowUpInput[];
  exception_note?: string | null;
  customer_completion_summary?: string | null;
  configured_policy_reference?: string | null;
}

const LEGACY_BOUNDARY_KEYS = new Set(['tenant_id','tenant_company_id','tenantId','tenantCompanyId','workspace_tenant_id','business_id','account_id','workspace_id']);
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
function optionalText(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}
function frozenStrings(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map((value) => String(value).trim()).filter(Boolean))].sort());
}
function findService(trade: LicensedTradeKey, service_key: string) {
  const key = requireText(service_key, 'service_key');
  const service = LICENSED_TRADE_SERVICE_CATALOGUE.find((entry) => entry.service_key === key);
  if (!service) throw new Error(`unknown licensed-trade service: ${key}`);
  if (service.trade !== trade) throw new Error(`service ${key} does not belong to trade ${trade}`);
  return service;
}
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function requiredEvidenceKinds(trade: LicensedTradeKey, service: ReturnType<typeof findService>): readonly EvidenceKind[] {
  const kinds = new Set<EvidenceKind>(['WORK_PERFORMED','CUSTOMER_SUMMARY']);
  if (service.service_class === 'INSTALLATION') kinds.add('BEFORE_CONDITION');
  if (trade === 'electrical' || service.evidence_requirements.some((x) => /isolation|safe-state/i.test(x))) kinds.add('ISOLATION_SAFE_STATE');
  if (service.evidence_requirements.some((x) => /test|inspection/i.test(x))) kinds.add('TEST_RESULT');
  if (service.evidence_requirements.some((x) => /commission/i.test(x))) kinds.add('COMMISSIONING');
  if (service.compliance_oriented || service.evidence_requirements.some((x) => /sign-off/i.test(x))) kinds.add('QUALIFIED_SIGN_OFF');
  return Object.freeze([...kinds]);
}

export function buildLicensedTradeExecutionPack(input: LicensedTradeExecutionPackInput) {
  rejectLegacyBoundary(input);
  const company_id = requireText(input.company_id, 'company_id');
  const job_ref = requireText(input.job_ref, 'job_ref');
  const service = findService(input.trade, input.service_key);
  const configured_policy_reference = optionalText(input.configured_policy_reference);
  const completed = new Set(frozenStrings(input.checklist_completed_keys));
  const checklist = Object.freeze(service.common_scope.map((scope, index) => {
    const checklist_key = `${service.service_key}:${String(index + 1).padStart(2,'0')}:${slug(scope)}`;
    return Object.freeze({ checklist_key, label: scope, required: true, completed: completed.has(checklist_key) });
  }));

  const evidence = Object.freeze((input.evidence ?? []).map((entry, index) => {
    rejectLegacyBoundary(entry, `evidence[${index}]`);
    return Object.freeze({
      evidence_kind: entry.evidence_kind,
      evidence_ref: optionalText(entry.evidence_ref),
      status: entry.status ?? (optionalText(entry.evidence_ref) ? 'CAPTURED' : 'PENDING'),
      note: optionalText(entry.note),
    });
  }));
  const required_evidence_kinds = requiredEvidenceKinds(input.trade, service);
  const blockers: string[] = [];
  for (const item of checklist) if (item.required && !item.completed) blockers.push(`CHECKLIST_INCOMPLETE:${item.checklist_key}`);
  for (const kind of required_evidence_kinds) {
    const captured = evidence.some((entry) => entry.evidence_kind === kind && entry.status === 'CAPTURED' && !!entry.evidence_ref);
    if (!captured) blockers.push(`REQUIRED_EVIDENCE_MISSING:${kind}`);
  }
  if (service.configured_policy_reference_required && !configured_policy_reference) blockers.push('CONFIGURED_POLICY_REFERENCE_REQUIRED');

  const materials_used = Object.freeze((input.materials_used ?? []).map((entry, index) => {
    rejectLegacyBoundary(entry, `materials_used[${index}]`);
    const quantity = entry.quantity == null ? 1 : Number(entry.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error(`materials_used[${index}].quantity must be > 0`);
    return Object.freeze({ material_ref: requireText(entry.material_ref, `materials_used[${index}].material_ref`), quantity, unit: optionalText(entry.unit), evidence_ref: optionalText(entry.evidence_ref) });
  }));
  const follow_up_work = Object.freeze((input.follow_up_work ?? []).map((entry, index) => {
    rejectLegacyBoundary(entry, `follow_up_work[${index}]`);
    return Object.freeze({
      follow_up_ref: requireText(entry.follow_up_ref, `follow_up_work[${index}].follow_up_ref`),
      summary: requireText(entry.summary, `follow_up_work[${index}].summary`),
      priority: entry.priority ?? 'ROUTINE',
      owner_hint: entry.owner_hint ?? 'JOBS',
    });
  }));
  const exception_note = optionalText(input.exception_note);
  if (follow_up_work.some((entry) => entry.priority === 'URGENT_REVIEW') && !exception_note) blockers.push('URGENT_FOLLOW_UP_EXCEPTION_NOTE_REQUIRED');
  const customer_completion_summary = optionalText(input.customer_completion_summary);
  if (!customer_completion_summary) blockers.push('CUSTOMER_COMPLETION_SUMMARY_REQUIRED');

  const unique_blockers = Object.freeze([...new Set(blockers)].sort());
  return Object.freeze({
    schema: LICENSED_TRADES_EXECUTION_SCHEMA,
    company_id,
    job_ref,
    trade: input.trade,
    service_key: service.service_key,
    service_class: service.service_class,
    worker_ref: optionalText(input.worker_ref),
    asset_refs: frozenStrings(input.asset_refs),
    checklist,
    required_evidence_kinds,
    evidence,
    materials_used,
    follow_up_work,
    exception_note,
    customer_completion_summary,
    configured_policy_reference,
    blockers: unique_blockers,
    ready_for_shared_jobs_evidence_review: unique_blockers.length === 0,
    jobs_owner: 'shared_jobs_owner',
    evidence_owner: 'shared_jobs_evidence_owner',
    materials_owner: 'shared_assets_inventory_owner',
    follow_up_owner: 'shared_jobs_customer_care_quote_owner',
    qualification_owner: 'shared_workforce_qualification_owner',
    vertical_execution_is_projection: true,
    marks_job_complete: false,
    mutates_job: false,
    mutates_asset_history: false,
    mutates_inventory: false,
    creates_follow_up_job: false,
    issues_compliance_certificate: false,
    declares_safe_state: false,
    grants_authority: false,
    execution_permitted: false,
    requires_fresh_authority_evaluation: true,
  });
}
