const SCHEMA = 'titan.workforce.cleaning-assignment-requirement-suggestions.v1';

const list = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 220) => String(value ?? '').trim().slice(0, max);
const uniq = (values) => [...new Set(list(values).map((value) => clean(value)).filter(Boolean))].sort();

function rejectLegacyBoundary(value, label) {
  if (value && (Object.hasOwn(value, 'tenant_id') || Object.hasOwn(value, 'tenant_company_id'))) {
    throw new Error(`${label}-legacy-tenant-boundary-rejected`);
  }
}

function requireCompanyId(value, label = 'input') {
  const companyId = clean(value, 128);
  if (!/^[A-Za-z0-9._:-]{2,128}$/.test(companyId)) throw new Error(`${label}-company_id-required`);
  return companyId;
}

function assertCompany(value, companyId, label) {
  rejectLegacyBoundary(value, label);
  if (value?.company_id && clean(value.company_id, 128) !== companyId) {
    throw new Error(`${label}-cross-company-rejected`);
  }
}

function positiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label}-positive-integer-required`);
  return n;
}

function normalizeRequirements(input, companyId) {
  const source = input.cleaning_requirements || {};
  assertCompany(source, companyId, 'cleaning-requirements');
  const sourceRef = clean(source.source_ref);
  if (!sourceRef) throw new Error('cleaning-requirements-source_ref-required');

  const durationMinutes = positiveInt(source.duration_minutes, 'cleaning-duration-minutes');
  const crewSize = positiveInt(source.crew_size, 'cleaning-crew-size');

  const equipment = list(source.equipment).map((item, index) => {
    assertCompany(item, companyId, `cleaning-equipment-requirement-${index}`);
    const equipmentId = clean(item.equipment_id || item.asset_type || item.capability_id);
    const quantity = positiveInt(item.quantity ?? 1, `cleaning-equipment-quantity-${index}`);
    const itemSourceRef = clean(item.source_ref);
    if (!equipmentId) throw new Error(`cleaning-equipment-id-required-${index}`);
    if (!itemSourceRef) throw new Error(`cleaning-equipment-source_ref-required-${index}`);
    return { equipment_id: equipmentId, quantity, source_ref: itemSourceRef };
  });

  return {
    company_id: companyId,
    service_id: clean(source.service_id) || null,
    job_id: clean(source.job_id) || null,
    site_id: clean(source.site_id) || null,
    duration_minutes: durationMinutes,
    crew_size: crewSize,
    equipment,
    source_ref: sourceRef
  };
}

function candidateIndex(candidateMatch, companyId) {
  if (!candidateMatch) return new Map();
  assertCompany(candidateMatch, companyId, 'candidate-match');
  const index = new Map();
  for (const worker of list(candidateMatch.workers)) {
    assertCompany(worker, companyId, 'candidate-match-worker');
    const workerId = clean(worker.worker_id);
    if (!workerId) continue;
    index.set(workerId, {
      eligible: worker.eligible_for_scheduling_proposal === true,
      blockers: uniq(worker.blockers)
    });
  }
  return index;
}

function conflictIndex(conflictEvaluations, companyId) {
  const index = new Map();
  for (const evaluation of list(conflictEvaluations)) {
    assertCompany(evaluation, companyId, 'conflict-evaluation');
    const workerId = clean(evaluation.proposed_assignment?.worker_id);
    if (!workerId) continue;
    const blocking = list(evaluation.conflicts).filter((conflict) => conflict?.severity === 'BLOCK');
    const review = list(evaluation.conflicts).filter((conflict) => conflict?.severity === 'REVIEW');
    index.set(workerId, {
      state: clean(evaluation.state) || null,
      blocking_types: uniq(blocking.map((conflict) => conflict.type)),
      review_types: uniq(review.map((conflict) => conflict.type)),
      clear: blocking.length === 0 && review.length === 0
    });
  }
  return index;
}

function equipmentIndex(evidence, companyId) {
  const index = new Map();
  for (const item of list(evidence)) {
    assertCompany(item, companyId, 'equipment-availability');
    const equipmentId = clean(item.equipment_id || item.asset_type || item.capability_id);
    if (!equipmentId) throw new Error('equipment-availability-id-required');
    const availableQuantity = Number(item.available_quantity);
    if (!Number.isInteger(availableQuantity) || availableQuantity < 0) {
      throw new Error('equipment-availability-quantity-invalid');
    }
    const sourceRef = clean(item.source_ref);
    if (!sourceRef) throw new Error('equipment-availability-source_ref-required');
    index.set(equipmentId, { available_quantity: availableQuantity, source_ref: sourceRef });
  }
  return index;
}

function normalizeHierarchy(hierarchy, companyId) {
  if (!hierarchy) throw new Error('assignment-hierarchy-required');
  assertCompany(hierarchy, companyId, 'assignment-hierarchy');
  if (hierarchy.schema !== 'titan.workforce.manager-supervisor-team-assignment-hierarchy.v1') {
    throw new Error('assignment-hierarchy-schema-invalid');
  }
  return list(hierarchy.mission_teams);
}

function equipmentAssessment(requirements, availability) {
  const missing = [];
  const items = requirements.map((requirement) => {
    const evidence = availability.get(requirement.equipment_id);
    const available = evidence?.available_quantity ?? 0;
    const shortage = Math.max(0, requirement.quantity - available);
    if (shortage > 0) missing.push(`${requirement.equipment_id}:${shortage}`);
    return {
      equipment_id: requirement.equipment_id,
      required_quantity: requirement.quantity,
      available_quantity: available,
      shortage_quantity: shortage,
      requirement_source_ref: requirement.source_ref,
      availability_source_ref: evidence?.source_ref ?? null
    };
  });
  return { items, missing: missing.sort(), satisfied: missing.length === 0 };
}

export function buildCleaningAssignmentRequirementSuggestions(input = {}) {
  rejectLegacyBoundary(input, 'input');
  const companyId = requireCompanyId(input.company_id);
  const requirements = normalizeRequirements(input, companyId);
  const candidates = candidateIndex(input.candidate_match, companyId);
  const conflicts = conflictIndex(input.conflict_evaluations, companyId);
  const equipment = equipmentIndex(input.equipment_availability, companyId);
  const teams = normalizeHierarchy(input.assignment_hierarchy, companyId);
  const equipmentCheck = equipmentAssessment(requirements.equipment, equipment);

  const suggestions = teams.map((team) => {
    const teamId = clean(team.mission_team_id);
    const workers = list(team.candidate_workers)
      .map((worker) => clean(worker.worker_id))
      .filter(Boolean);

    const workerEvidence = workers.map((workerId) => {
      const candidate = candidates.get(workerId);
      const conflict = conflicts.get(workerId);
      const blockers = [
        ...(candidate && !candidate.eligible ? candidate.blockers : []),
        ...(conflict?.blocking_types || []).map((type) => `CONFLICT:${type}`),
        ...(conflict?.review_types || []).map((type) => `REVIEW:${type}`)
      ];
      if (!candidate) blockers.push('CANDIDATE_MATCH_EVIDENCE_MISSING');
      if (!conflict) blockers.push('CONFLICT_EVALUATION_MISSING');
      return {
        worker_id: workerId,
        eligible_for_cleaning_assignment_proposal:
          candidate?.eligible === true && conflict?.clear === true,
        blockers: uniq(blockers)
      };
    });

    const eligibleWorkerIds = workerEvidence
      .filter((worker) => worker.eligible_for_cleaning_assignment_proposal)
      .map((worker) => worker.worker_id)
      .sort();

    const selectedWorkerIds = eligibleWorkerIds.slice(0, requirements.crew_size);
    const crewGap = Math.max(0, requirements.crew_size - selectedWorkerIds.length);

    const blockers = [];
    if (crewGap > 0) blockers.push(`CREW_SIZE_SHORTAGE:${crewGap}`);
    if (!equipmentCheck.satisfied) blockers.push(...equipmentCheck.missing.map((item) => `EQUIPMENT_SHORTAGE:${item}`));

    const reviewReasons = [];
    if (workerEvidence.some((worker) => worker.blockers.includes('CONFLICT_EVALUATION_MISSING'))) {
      reviewReasons.push('CONFLICT_EVIDENCE_INCOMPLETE');
    }
    if (workerEvidence.some((worker) => worker.blockers.some((blocker) => blocker.startsWith('REVIEW:')))) {
      reviewReasons.push('WORKER_CONFLICT_REVIEW_REQUIRED');
    }

    const ready = blockers.length === 0 && reviewReasons.length === 0;

    return {
      mission_team_id: teamId || null,
      supervisor_worker_id: clean(team.supervisor_worker_id) || null,
      coordinator_worker_id: clean(team.coordinator_worker_id) || null,
      required_duration_minutes: requirements.duration_minutes,
      required_crew_size: requirements.crew_size,
      eligible_worker_ids: eligibleWorkerIds,
      suggested_worker_ids: selectedWorkerIds,
      crew_size_shortage: crewGap,
      equipment: equipmentCheck.items,
      blockers: uniq(blockers),
      review_reasons: uniq(reviewReasons),
      state: ready ? 'READY_FOR_ASSIGNMENT_PROPOSAL_REVIEW' : blockers.length ? 'BLOCKED' : 'REVIEW_REQUIRED',
      deterministic_rank_score:
        (ready ? 100000 : 0) +
        Math.min(eligibleWorkerIds.length, 999) * 100 -
        crewGap * 1000 -
        equipmentCheck.missing.length * 500 -
        reviewReasons.length * 250,
      proposal_only: true,
      grants_authority: false
    };
  }).sort((a, b) =>
    b.deterministic_rank_score - a.deterministic_rank_score ||
    String(a.mission_team_id).localeCompare(String(b.mission_team_id))
  );

  return {
    schema: SCHEMA,
    company_id: companyId,
    cleaning_requirements: requirements,
    suggestions,
    best_suggestion: suggestions[0] || null,
    requirements_inferred: false,
    duration_inferred: false,
    crew_size_inferred: false,
    equipment_inferred: false,
    proposal_only: true,
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as CLEANING_ASSIGNMENT_REQUIREMENT_SUGGESTIONS_SCHEMA };
