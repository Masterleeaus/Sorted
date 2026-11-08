const SCHEMA = 'titan.workforce.worker-skill-role-site-match.v1';

function rejectLegacyBoundary(input) {
  if (input && (Object.hasOwn(input, 'tenant_id') || Object.hasOwn(input, 'tenant_company_id'))) {
    throw new Error('legacy tenant boundary is not permitted; use company_id only');
  }
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function sameCompany(companyId, value, label) {
  if (value == null) return;
  if (value !== companyId) throw new Error(`cross-company ${label}`);
}

function toSet(value) {
  return new Set((Array.isArray(value) ? value : []).map((item) => String(item)));
}

function normalizeCapabilityRecord(record = {}) {
  return {
    capability_id: String(record.capability_id || record.skill_id || ''),
    proficiency: Number.isFinite(Number(record.proficiency)) ? Number(record.proficiency) : 0,
    verified: record.verified === true || String(record.verification_state || '').toUpperCase() === 'VERIFIED',
    revoked: record.revoked === true || String(record.verification_state || '').toUpperCase() === 'REVOKED',
    expires_at: record.expires_at ?? null,
    source_ref: record.source_ref ?? null
  };
}

function capabilitySatisfied(record, requirement, now) {
  if (!record || !record.capability_id) return false;
  if (record.revoked || !record.verified) return false;
  if (record.expires_at != null && Number(record.expires_at) <= now) return false;
  const minimum = Number.isFinite(Number(requirement.minimum_proficiency))
    ? Number(requirement.minimum_proficiency)
    : 0;
  return record.proficiency >= minimum;
}

export function buildWorkerSkillRoleSiteMatch(input = {}) {
  rejectLegacyBoundary(input);
  const companyId = requireString(input.company_id, 'input.company_id');
  const siteId = requireString(input.site_id, 'input.site_id');
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();

  const availabilityCapacity = input.availability_capacity_state;
  if (!availabilityCapacity || typeof availabilityCapacity !== 'object') {
    throw new Error('availability_capacity_state is required');
  }
  rejectLegacyBoundary(availabilityCapacity);
  sameCompany(companyId, availabilityCapacity.company_id, 'availability_capacity_state');

  const roleAssignments = Array.isArray(input.role_assignments) ? input.role_assignments : [];
  const capabilities = Array.isArray(input.capabilities) ? input.capabilities : [];
  const siteEligibility = Array.isArray(input.site_eligibility) ? input.site_eligibility : [];
  const requiredRoles = toSet(input.required_roles);
  const requiredCapabilities = Array.isArray(input.required_capabilities) ? input.required_capabilities : [];

  const rolesByWorker = new Map();
  for (const assignment of roleAssignments) {
    rejectLegacyBoundary(assignment);
    sameCompany(companyId, assignment.company_id, 'role_assignment');
    const workerId = requireString(assignment.worker_id, 'role_assignment.worker_id');
    const roleId = requireString(assignment.role_id, 'role_assignment.role_id');
    if (!rolesByWorker.has(workerId)) rolesByWorker.set(workerId, new Set());
    rolesByWorker.get(workerId).add(roleId);
  }

  const capabilitiesByWorker = new Map();
  for (const raw of capabilities) {
    rejectLegacyBoundary(raw);
    sameCompany(companyId, raw.company_id, 'capability');
    const workerId = requireString(raw.worker_id, 'capability.worker_id');
    const normalized = normalizeCapabilityRecord(raw);
    if (!normalized.capability_id) throw new Error('capability.capability_id is required');
    if (!capabilitiesByWorker.has(workerId)) capabilitiesByWorker.set(workerId, new Map());
    capabilitiesByWorker.get(workerId).set(normalized.capability_id, normalized);
  }

  const sitesByWorker = new Map();
  for (const eligibility of siteEligibility) {
    rejectLegacyBoundary(eligibility);
    sameCompany(companyId, eligibility.company_id, 'site_eligibility');
    const workerId = requireString(eligibility.worker_id, 'site_eligibility.worker_id');
    const eligibleSites = toSet(eligibility.site_ids);
    sitesByWorker.set(workerId, {
      eligible_sites: eligibleSites,
      source_ref: eligibility.source_ref ?? null,
      explicit: true
    });
  }

  const workers = (Array.isArray(availabilityCapacity.workers) ? availabilityCapacity.workers : []).map((base) => {
    sameCompany(companyId, base.company_id, 'availability_capacity.worker');
    const workerId = requireString(base.worker_id, 'availability_capacity.worker_id');
    const blockers = [...(Array.isArray(base.blockers) ? base.blockers : [])];

    const roles = rolesByWorker.get(workerId) || new Set();
    for (const roleId of requiredRoles) {
      if (!roles.has(roleId)) blockers.push(`MISSING_ROLE:${roleId}`);
    }

    const workerCapabilities = capabilitiesByWorker.get(workerId) || new Map();
    for (const requirement of requiredCapabilities) {
      const capabilityId = requireString(
        requirement.capability_id || requirement.skill_id,
        'required_capabilities.capability_id'
      );
      const record = workerCapabilities.get(capabilityId);
      if (!capabilitySatisfied(record, requirement, now)) {
        blockers.push(`MISSING_VERIFIED_CAPABILITY:${capabilityId}`);
      }
    }

    const site = sitesByWorker.get(workerId);
    if (!site) {
      blockers.push('SITE_ELIGIBILITY_UNKNOWN');
    } else if (!site.eligible_sites.has(siteId)) {
      blockers.push(`SITE_NOT_ELIGIBLE:${siteId}`);
    }

    return {
      company_id: companyId,
      worker_id: workerId,
      site_id: siteId,
      roles: [...roles].sort(),
      matched_capabilities: requiredCapabilities.map((requirement) => {
        const capabilityId = String(requirement.capability_id || requirement.skill_id || '');
        const record = workerCapabilities.get(capabilityId);
        return {
          capability_id: capabilityId,
          satisfied: capabilitySatisfied(record, requirement, now),
          source_ref: record?.source_ref ?? null
        };
      }),
      site_eligibility_source_ref: site?.source_ref ?? null,
      base_scheduling_eligible: base.eligible_for_scheduling_proposal === true,
      blockers: [...new Set(blockers)].sort(),
      eligible_for_scheduling_proposal: blockers.length === 0
    };
  });

  const eligible = workers.filter((worker) => worker.eligible_for_scheduling_proposal);

  return {
    schema: SCHEMA,
    company_id: companyId,
    site_id: siteId,
    workers,
    summary: {
      workers_total: workers.length,
      workers_eligible: eligible.length,
      workers_blocked: workers.length - eligible.length
    },
    state: eligible.length ? 'MATCH_CANDIDATES_READY' : 'NO_ELIGIBLE_MATCH',
    proposal_only: true,
    identity_is_not_authority: true,
    role_is_not_authority: true,
    capability_is_not_authority: true,
    site_match_is_not_authority: true,
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as WORKER_SKILL_ROLE_SITE_MATCH_SCHEMA };
