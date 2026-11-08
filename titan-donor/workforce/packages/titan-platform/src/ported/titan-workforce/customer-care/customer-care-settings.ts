// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/customer-care/customer-care-settings.mjs
import { CUSTOMER_CARE_CONTRACT } from './customer-care-contract.js';

const TONES = Object.freeze(['PROFESSIONAL', 'WARM', 'CONCISE', 'EMPATHETIC']);
const CHANNELS = Object.freeze(['SMS', 'EMAIL', 'WHATSAPP', 'VOICE', 'IN_APP']);
const SEVERITY_RANK = Object.freeze({ LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });
const ISSUE_CLASSES = Object.freeze(['SAFETY', 'PRIVACY', 'PROPERTY_DAMAGE']);
const ESCALATION_ROLES = Object.freeze(['MANAGER', 'SAFETY', 'PRIVACY', 'FINANCE', 'LEGAL']);
const REMEDIATION_MODES = Object.freeze(['NONE', 'PROPOSE_ONLY', 'REQUIRE_APPROVAL']);

export const CUSTOMER_CARE_SETTINGS_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.settings-contract.v1',
  company_boundary: 'company_id',
  settings_source: 'existing_workforce_settings_override',
  shared_settings_registry_modified: false,
  authority_rule: 'settings_never_grant_execution_authority',
  supported_tones: TONES,
  supported_channels: CHANNELS,
  remediation_modes: REMEDIATION_MODES,
  protected_actions_remain_governed: CUSTOMER_CARE_CONTRACT.remediation.never_self_authorized,
  output_mode: 'POLICY_INPUT_ONLY'
});

const DEFAULTS = Object.freeze({
  tone: 'EMPATHETIC',
  response_sla_minutes: Object.freeze({ LOW: 1440, MEDIUM: 480, HIGH: 120, CRITICAL: 15 }),
  complaint_thresholds: Object.freeze({
    human_review_severity: 'HIGH',
    manager_review_severity: 'CRITICAL',
    mandatory_issue_classes: Object.freeze(['SAFETY', 'PRIVACY', 'PROPERTY_DAMAGE'])
  }),
  remediation: Object.freeze({
    mode: 'REQUIRE_APPROVAL',
    allowed_proposals: CUSTOMER_CARE_CONTRACT.remediation.allowed_proposals,
    never_executable_by_customer_care: CUSTOMER_CARE_CONTRACT.remediation.never_self_authorized
  }),
  review_timing: Object.freeze({ minimum_delay_minutes: 1440, maximum_delay_minutes: 10080, require_satisfactory_outcome: true }),
  allowed_channels: Object.freeze(['SMS', 'EMAIL'])
});

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} is required`);
  return value.trim();
}

function normalize(value) { return typeof value === 'string' ? value.trim().toUpperCase() : ''; }
function unique(values) { return Object.freeze([...new Set(values)]); }
function integer(value, fallback, min, max, field) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new TypeError(`${field} must be an integer between ${min} and ${max}`);
  return value;
}
function rejectLegacyCompanyKeys(input) {
  for (const key of ['tenant_company_id', 'companyId', 'tenantId', 'tenant_id']) {
    if (Object.prototype.hasOwnProperty.call(input, key)) throw new Error(`legacy company boundary key rejected: ${key}`);
  }
}
function enumValue(value, allowed, fallback, field) {
  if (value == null) return fallback;
  const normalized = normalize(value);
  if (!allowed.includes(normalized)) throw new TypeError(`unsupported ${field}`);
  return normalized;
}
function normalizeEnumArray(values, allowed, fallback, field) {
  if (values == null) return Object.freeze([...fallback]);
  if (!Array.isArray(values)) throw new TypeError(`${field} must be an array`);
  const normalized = values.map((value) => enumValue(value, allowed, null, field));
  return unique(normalized);
}
function normalizeContacts(companyId, contacts = []) {
  if (!Array.isArray(contacts)) throw new TypeError('escalation_contacts must be an array');
  return Object.freeze(contacts.map((contact, index) => {
    if (!contact || typeof contact !== 'object' || Array.isArray(contact)) throw new TypeError(`escalation_contacts[${index}] must be an object`);
    rejectLegacyCompanyKeys(contact);
    const contactCompany = requireString(contact.company_id, `escalation_contacts[${index}].company_id`);
    if (contactCompany !== companyId) throw new Error('cross-company escalation contact rejected');
    const roles = normalizeEnumArray(contact.roles, ESCALATION_ROLES, [], `escalation_contacts[${index}].roles`);
    if (roles.length === 0) throw new TypeError(`escalation_contacts[${index}].roles requires at least one role`);
    return Object.freeze({ contact_id: requireString(contact.contact_id, `escalation_contacts[${index}].contact_id`), company_id: contactCompany, roles });
  }));
}

export function normalizeCustomerCareSettings(input = {}) {
  rejectLegacyCompanyKeys(input);
  const company_id = requireString(input.company_id, 'company_id');
  const settings = input.settings ?? {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('settings must be an object');
  rejectLegacyCompanyKeys(settings);

  const tone = enumValue(settings.tone, TONES, DEFAULTS.tone, 'tone');
  const sla = settings.response_sla_minutes ?? {};
  const response_sla_minutes = Object.freeze({
    LOW: integer(sla.LOW, DEFAULTS.response_sla_minutes.LOW, 1, 10080, 'response_sla_minutes.LOW'),
    MEDIUM: integer(sla.MEDIUM, DEFAULTS.response_sla_minutes.MEDIUM, 1, 4320, 'response_sla_minutes.MEDIUM'),
    HIGH: integer(sla.HIGH, DEFAULTS.response_sla_minutes.HIGH, 1, 1440, 'response_sla_minutes.HIGH'),
    CRITICAL: integer(sla.CRITICAL, DEFAULTS.response_sla_minutes.CRITICAL, 1, 60, 'response_sla_minutes.CRITICAL')
  });
  if (!(response_sla_minutes.CRITICAL <= response_sla_minutes.HIGH && response_sla_minutes.HIGH <= response_sla_minutes.MEDIUM && response_sla_minutes.MEDIUM <= response_sla_minutes.LOW)) {
    throw new Error('response SLA must tighten as severity increases');
  }

  const thresholds = settings.complaint_thresholds ?? {};
  const complaint_thresholds = Object.freeze({
    human_review_severity: enumValue(thresholds.human_review_severity, ['MEDIUM', 'HIGH', 'CRITICAL'], DEFAULTS.complaint_thresholds.human_review_severity, 'human_review_severity'),
    manager_review_severity: enumValue(thresholds.manager_review_severity, ['HIGH', 'CRITICAL'], DEFAULTS.complaint_thresholds.manager_review_severity, 'manager_review_severity'),
    mandatory_issue_classes: normalizeEnumArray(thresholds.mandatory_issue_classes, ISSUE_CLASSES, DEFAULTS.complaint_thresholds.mandatory_issue_classes, 'mandatory_issue_classes')
  });
  if (SEVERITY_RANK[complaint_thresholds.manager_review_severity] < SEVERITY_RANK[complaint_thresholds.human_review_severity]) {
    throw new Error('manager review threshold cannot be less severe than human review threshold');
  }
  for (const mandatory of CUSTOMER_CARE_CONTRACT.escalation.mandatory_issue_classes) {
    if (!complaint_thresholds.mandatory_issue_classes.includes(mandatory)) throw new Error(`mandatory escalation issue class cannot be disabled: ${mandatory}`);
  }

  const remediationInput = settings.remediation ?? {};
  const remediation = Object.freeze({
    mode: enumValue(remediationInput.mode, REMEDIATION_MODES, DEFAULTS.remediation.mode, 'remediation mode'),
    allowed_proposals: normalizeEnumArray(remediationInput.allowed_proposals, CUSTOMER_CARE_CONTRACT.remediation.allowed_proposals, DEFAULTS.remediation.allowed_proposals, 'allowed remediation proposal'),
    never_executable_by_customer_care: Object.freeze([...CUSTOMER_CARE_CONTRACT.remediation.never_self_authorized])
  });

  const timing = settings.review_timing ?? {};
  const minimum_delay_minutes = integer(timing.minimum_delay_minutes, DEFAULTS.review_timing.minimum_delay_minutes, 0, 43200, 'review_timing.minimum_delay_minutes');
  const maximum_delay_minutes = integer(timing.maximum_delay_minutes, DEFAULTS.review_timing.maximum_delay_minutes, 1, 129600, 'review_timing.maximum_delay_minutes');
  if (maximum_delay_minutes < minimum_delay_minutes) throw new Error('review maximum delay cannot be earlier than minimum delay');
  if (timing.require_satisfactory_outcome === false) throw new Error('satisfactory outcome requirement cannot be disabled');
  const review_timing = Object.freeze({ minimum_delay_minutes, maximum_delay_minutes, require_satisfactory_outcome: true });

  const allowed_channels = normalizeEnumArray(settings.allowed_channels, CHANNELS, DEFAULTS.allowed_channels, 'allowed channel');
  if (allowed_channels.length === 0) throw new Error('at least one Customer Care channel must be allowed');
  const escalation_contacts = normalizeContacts(company_id, settings.escalation_contacts ?? []);

  return Object.freeze({
    schema: 'titan.workforce.customer-care.settings-policy.v1',
    company_id,
    tone,
    response_sla_minutes,
    complaint_thresholds,
    remediation,
    review_timing,
    escalation_contacts,
    allowed_channels,
    source: 'workforce_agent_override_projection',
    authority_granted: false,
    execution_permitted: false,
    grants_authority: false
  });
}

export function isCustomerCareChannelAllowed(policy, channel) {
  const company_id = requireString(policy?.company_id, 'company_id');
  void company_id;
  const normalized = enumValue(channel, CHANNELS, null, 'channel');
  return policy.allowed_channels.includes(normalized);
}

export function evaluateCustomerCareSettingsForCase(policy, caseRecord = {}) {
  const company_id = requireString(policy?.company_id, 'policy.company_id');
  const caseCompany = requireString(caseRecord.company_id, 'case.company_id');
  if (company_id !== caseCompany) throw new Error('cross-company Customer Care settings application rejected');
  const severity = enumValue(caseRecord.severity, ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], 'LOW', 'case severity');
  const issue_class = normalize(caseRecord.issue_class || 'OTHER');
  const human_review_required = SEVERITY_RANK[severity] >= SEVERITY_RANK[policy.complaint_thresholds.human_review_severity]
    || policy.complaint_thresholds.mandatory_issue_classes.includes(issue_class);
  const manager_review_required = SEVERITY_RANK[severity] >= SEVERITY_RANK[policy.complaint_thresholds.manager_review_severity]
    || policy.complaint_thresholds.mandatory_issue_classes.includes(issue_class);
  return Object.freeze({
    schema: 'titan.workforce.customer-care.settings-evaluation.v1',
    company_id,
    case_id: caseRecord.case_id ?? null,
    severity,
    response_sla_minutes: policy.response_sla_minutes[severity],
    human_review_required,
    manager_review_required,
    allowed_channels: policy.allowed_channels,
    remediation_mode: policy.remediation.mode,
    authority_granted: false,
    execution_permitted: false
  });
}
