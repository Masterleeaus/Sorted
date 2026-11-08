// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/starter/reception/reception-agent-contract.mjs
const ROLE_DEFINITION_ID = 'titan.customer.receptionist';
const COMPANY_BOUNDARY = 'company_id';
const WORKER_KIND = 'existing_workforce_role';

const CAPABILITIES = Object.freeze([
  'inbound_enquiry_triage',
  'intent_identification',
  'initial_customer_detail_capture',
  'service_request_detail_capture',
  'safe_next_step_routing',
  'structured_worker_handoff'
]);

const HANDOFF_TARGETS = Object.freeze(['sales', 'booking', 'customer_care']);

const CANONICAL_DEPENDENCIES = Object.freeze({
  customer_intake: 'titan-business-services/workflows/new_customer.json',
  booking: 'titan-business-services/workflows/service_booking.json',
  quote: 'titan-business-services/workflows/create_quote.json',
  handoff: 'workforce/contracts/WorkerHandoffPacket.schema.json',
  authority: 'titan-runtime/authority/execution-boundary.js',
  company_boundary: 'titan-runtime/authority/company-boundary.js',
  settings: 'titan-settings/control-plane/workforce-agent-overrides.js'
});

function clean(value, max = 180) {
  return String(value ?? '').trim().slice(0, max);
}

function validCompanyId(value) {
  return /^[A-Za-z0-9._:-]{2,128}$/.test(clean(value, 128));
}

export function createReceptionAgentContract({company_id} = {}) {
  const scopedCompanyId = clean(company_id, 128);
  if (!validCompanyId(scopedCompanyId)) throw new Error('reception-agent-company_id-required');
  return Object.freeze({
    schema: 'titan.zero.starter-workforce.reception.contract.v1',
    company_id: scopedCompanyId,
    role_definition_id: ROLE_DEFINITION_ID,
    worker_kind: WORKER_KIND,
    company_boundary: COMPANY_BOUNDARY,
    identity_grants_authority: false,
    activation_confers_authority: false,
    capabilities: [...CAPABILITIES],
    handoff_targets: [...HANDOFF_TARGETS],
    canonical_dependencies: {...CANONICAL_DEPENDENCIES},
    owns_customer_records: false,
    owns_quote_records: false,
    owns_booking_records: false,
    material_actions_require_governed_execution: true
  });
}

export function validateReceptionAgentRole(role = {}) {
  if (role.role_definition_id !== ROLE_DEFINITION_ID) throw new Error('reception-agent-existing-role-required');
  if (role.company_boundary !== COMPANY_BOUNDARY) throw new Error('reception-agent-company-boundary-mismatch');
  if (role.activation_confers_authority !== false) throw new Error('reception-agent-identity-must-not-grant-authority');
  const domains = Array.isArray(role.operational_domains) ? role.operational_domains : [];
  if (!domains.includes('reception') || !domains.includes('crm')) throw new Error('reception-agent-required-domains-missing');
  return true;
}

export function receptionHandoffTargetForIntent(intent = '') {
  const value = clean(intent, 240).toLowerCase();
  if (/\b(book|booking|appointment|schedule|reschedule)\b/.test(value)) return 'booking';
  if (/\b(sale|sales|quote|estimate|price|pricing|buy|purchase)\b/.test(value)) return 'sales';
  if (/\b(complaint|support|problem|issue|existing job|existing booking|update)\b/.test(value)) return 'customer_care';
  return null;
}

export const RECEPTION_AGENT_CONTRACT = Object.freeze({
  role_definition_id: ROLE_DEFINITION_ID,
  worker_kind: WORKER_KIND,
  company_boundary: COMPANY_BOUNDARY,
  capabilities: CAPABILITIES,
  handoff_targets: HANDOFF_TARGETS,
  canonical_dependencies: CANONICAL_DEPENDENCIES,
  identity_grants_authority: false
});
