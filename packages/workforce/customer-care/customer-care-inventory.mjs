const REQUIRED_SERVICE_OWNERS = Object.freeze({
  crm: 'Titan CRM',
  communications: 'Titan Connect',
  jobs_work_orders: 'Titan Field',
  governance: 'Titan Governance',
  advanced_intelligence_workforce: 'Titan AI Workforce'
});

export const CUSTOMER_CARE_SURFACE_INVENTORY = Object.freeze({
  schema: 'titan.workforce.customer-care.inventory.v1',
  company_boundary: 'company_id',
  authority_rule: 'identity_does_not_grant_authority',
  ownership: Object.freeze({
    customer_truth: 'crm',
    conversation_execution: 'communications',
    job_history: 'jobs_work_orders',
    approvals_and_sensitive_remediation: 'governance',
    worker_definition_and_handoffs: 'advanced_intelligence_workforce'
  }),
  existing_surfaces: Object.freeze({
    conversation_state: [
      'titan-runtime/contracts/schemas/ConversationState.schema.json',
      'titan-runtime/interaction-engine/conversation-state-runtime.mjs',
      'titan-regression/monica-retriever/CONVERSATION-RETRIEVER-HANDOFF-CONTRACT.json'
    ],
    customer_and_job_workflows: [
      'titan-business-services/workflows/new_customer.json',
      'titan-business-services/workflows/complete_job.json',
      'titan-business-services/workflows/job_variation_approval.json'
    ],
    workforce_governance: [
      'titan-workforce/decision/decision-rights-runtime.mjs',
      'titan-workforce/gateway/AuthorityAutonomyBinding.schema.json',
      'titan-workforce/gateway/ProposalLifecycle.schema.json',
      'titan-workforce/notifications/workforce-notification-escalation-runtime.mjs'
    ]
  }),
  pass1_gaps: Object.freeze([
    'no dedicated customer-care case contract yet',
    'no canonical complaint/review eligibility state in extension runtime yet',
    'no deterministic post-job customer-care trigger yet',
    'no customer-care specific settings contract yet'
  ])
});

export function validateCustomerCareInventory({ serviceOwners, availablePaths = [] } = {}) {
  const services = Array.isArray(serviceOwners?.services) ? serviceOwners.services : [];
  const ownerByService = new Map(services.map((entry) => [entry.service, entry.canonical_owner]));
  const missingOwners = [];
  const mismatchedOwners = [];
  for (const [service, expected] of Object.entries(REQUIRED_SERVICE_OWNERS)) {
    const actual = ownerByService.get(service);
    if (!actual) missingOwners.push(service);
    else if (actual !== expected) mismatchedOwners.push({ service, expected, actual });
  }

  const pathSet = new Set(availablePaths);
  const referencedPaths = Object.values(CUSTOMER_CARE_SURFACE_INVENTORY.existing_surfaces).flat();
  const missingPaths = referencedPaths.filter((path) => !pathSet.has(path));

  return Object.freeze({
    ok: missingOwners.length === 0 && mismatchedOwners.length === 0 && missingPaths.length === 0,
    company_boundary_ok: serviceOwners?.tenant_boundary === 'company_id',
    authority_neutral: true,
    missingOwners,
    mismatchedOwners,
    missingPaths,
    referencedPaths
  });
}

export function buildCustomerCareExecutionContext(input = {}) {
  if (!input.company_id || typeof input.company_id !== 'string') {
    throw new TypeError('company_id is required for Customer Care context');
  }
  return Object.freeze({
    company_id: input.company_id,
    actor_user_id: input.actor_user_id ?? null,
    worker_id: input.worker_id ?? null,
    authority_granted: false,
    execution_permitted: false
  });
}
