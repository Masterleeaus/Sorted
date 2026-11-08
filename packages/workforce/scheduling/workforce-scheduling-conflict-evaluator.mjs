const SCHEMA = 'titan.workforce.scheduling-conflict-evaluation.v1';

const list = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
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

function assertCompany(record, companyId, label) {
  rejectLegacyBoundary(record, label);
  if (record?.company_id && record.company_id !== companyId) {
    throw new Error(`${label}-cross-company-rejected`);
  }
}

function interval(start, end, label) {
  const s = Number(start);
  const e = Number(end);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) {
    throw new Error(`${label}-invalid-window`);
  }
  return { start: s, end: e };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function availabilityIndex(state, companyId) {
  if (!state) return new Map();
  assertCompany(state, companyId, 'availability-capacity-state');
  const result = new Map();
  for (const worker of list(state.workers)) {
    assertCompany(worker, companyId, 'availability-capacity-worker');
    const workerId = clean(worker.worker_id);
    if (!workerId) continue;
    result.set(workerId, {
      eligible: worker.eligible_for_scheduling_proposal === true,
      blockers: uniq(worker.blockers)
    });
  }
  return result;
}

function candidateIndex(state, companyId) {
  if (!state) return new Map();
  assertCompany(state, companyId, 'candidate-match');
  const result = new Map();
  for (const worker of list(state.workers)) {
    assertCompany(worker, companyId, 'candidate-match-worker');
    const workerId = clean(worker.worker_id);
    if (!workerId) continue;
    result.set(workerId, {
      eligible: worker.eligible_for_scheduling_proposal === true,
      blockers: uniq(worker.blockers)
    });
  }
  return result;
}

function hierarchyIndex(hierarchy, companyId) {
  if (!hierarchy) return new Map();
  assertCompany(hierarchy, companyId, 'assignment-hierarchy');
  const result = new Map();
  for (const team of list(hierarchy.mission_teams)) {
    const teamId = clean(team.mission_team_id);
    for (const candidate of list(team.candidate_workers)) {
      const workerId = clean(candidate.worker_id);
      if (!workerId) continue;
      if (!result.has(workerId)) result.set(workerId, new Set());
      if (teamId) result.get(workerId).add(teamId);
    }
  }
  return result;
}

function travelEvidenceIndex(records, companyId) {
  const result = new Map();
  for (const record of list(records)) {
    assertCompany(record, companyId, 'travel-evidence');
    const workerId = clean(record.worker_id);
    const fromSiteId = clean(record.from_site_id);
    const toSiteId = clean(record.to_site_id);
    const minutes = Number(record.travel_minutes);
    if (!workerId || !fromSiteId || !toSiteId || !Number.isFinite(minutes) || minutes < 0) {
      throw new Error('travel-evidence-invalid');
    }
    const key = `${workerId}|${fromSiteId}|${toSiteId}`;
    result.set(key, {
      travel_minutes: minutes,
      source_ref: record.source_ref ?? null
    });
  }
  return result;
}

function travelGapConflict(proposed, existing, evidenceIndex) {
  if (!proposed.site_id || !existing.site_id || proposed.site_id === existing.site_id) return null;

  let earlier;
  let later;
  if (existing.window.end <= proposed.window.start) {
    earlier = existing;
    later = proposed;
  } else if (proposed.window.end <= existing.window.start) {
    earlier = proposed;
    later = existing;
  } else {
    return null;
  }

  const key = `${proposed.worker_id}|${earlier.site_id}|${later.site_id}`;
  const evidence = evidenceIndex.get(key);
  if (!evidence) {
    return {
      type: 'TRAVEL_EVIDENCE_MISSING',
      severity: 'REVIEW',
      existing_assignment_id: existing.assignment_id,
      source_ref: null
    };
  }

  const availableGapMinutes = (later.window.start - earlier.window.end) / 60000;
  if (availableGapMinutes < evidence.travel_minutes) {
    return {
      type: 'TRAVEL_OVERLAP',
      severity: 'BLOCK',
      existing_assignment_id: existing.assignment_id,
      required_travel_minutes: evidence.travel_minutes,
      available_gap_minutes: availableGapMinutes,
      source_ref: evidence.source_ref
    };
  }
  return null;
}

export function evaluateWorkforceSchedulingConflicts(input = {}) {
  rejectLegacyBoundary(input, 'input');
  const companyId = requireCompanyId(input.company_id);
  const availability = availabilityIndex(input.availability_capacity_state, companyId);
  const candidates = candidateIndex(input.candidate_match, companyId);
  const hierarchy = hierarchyIndex(input.assignment_hierarchy, companyId);
  const travel = travelEvidenceIndex(input.travel_evidence, companyId);

  const proposed = {
    company_id: companyId,
    assignment_id: clean(input.proposed_assignment?.assignment_id) || null,
    worker_id: clean(input.proposed_assignment?.worker_id),
    site_id: clean(input.proposed_assignment?.site_id),
    mission_team_id: clean(input.proposed_assignment?.mission_team_id) || null,
    window: interval(
      input.proposed_assignment?.start_ms,
      input.proposed_assignment?.end_ms,
      'proposed-assignment'
    )
  };
  assertCompany(input.proposed_assignment, companyId, 'proposed-assignment');
  if (!proposed.worker_id) throw new Error('proposed-assignment-worker_id-required');
  if (!proposed.site_id) throw new Error('proposed-assignment-site_id-required');

  const conflicts = [];

  const availabilityRecord = availability.get(proposed.worker_id);
  if (!availabilityRecord) {
    conflicts.push({ type: 'AVAILABILITY_EVIDENCE_MISSING', severity: 'REVIEW' });
  } else if (!availabilityRecord.eligible) {
    const unavailable = availabilityRecord.blockers.some((blocker) =>
      blocker === 'AVAILABILITY_UNAVAILABLE' ||
      blocker.startsWith('AVAILABILITY_') ||
      blocker === 'NO_AVAILABLE_CAPACITY'
    );
    conflicts.push({
      type: unavailable ? 'WORKER_UNAVAILABLE' : 'WORKER_CAPACITY_BLOCKED',
      severity: 'BLOCK',
      blockers: availabilityRecord.blockers
    });
  }

  const candidateRecord = candidates.get(proposed.worker_id);
  if (!candidateRecord) {
    conflicts.push({ type: 'CANDIDATE_MATCH_EVIDENCE_MISSING', severity: 'REVIEW' });
  } else if (!candidateRecord.eligible) {
    conflicts.push({
      type: 'WORKER_MATCH_BLOCKED',
      severity: 'BLOCK',
      blockers: candidateRecord.blockers
    });
  }

  if (proposed.mission_team_id) {
    const workerTeams = hierarchy.get(proposed.worker_id);
    if (!workerTeams) {
      conflicts.push({ type: 'TEAM_HIERARCHY_EVIDENCE_MISSING', severity: 'REVIEW' });
    } else if (!workerTeams.has(proposed.mission_team_id)) {
      conflicts.push({
        type: 'TEAM_MEMBERSHIP_MISMATCH',
        severity: 'BLOCK',
        mission_team_id: proposed.mission_team_id
      });
    }
  }

  for (const raw of list(input.existing_assignments)) {
    assertCompany(raw, companyId, 'existing-assignment');
    if (clean(raw.worker_id) !== proposed.worker_id) continue;
    const existing = {
      assignment_id: clean(raw.assignment_id),
      worker_id: clean(raw.worker_id),
      site_id: clean(raw.site_id),
      window: interval(raw.start_ms, raw.end_ms, 'existing-assignment')
    };

    if (overlaps(proposed.window, existing.window)) {
      conflicts.push({
        type: 'DOUBLE_BOOKING',
        severity: 'BLOCK',
        existing_assignment_id: existing.assignment_id
      });
      continue;
    }

    const travelConflict = travelGapConflict(proposed, existing, travel);
    if (travelConflict) conflicts.push(travelConflict);
  }

  const normalized = conflicts
    .map((conflict) => ({ ...conflict, type: clean(conflict.type), severity: clean(conflict.severity) }))
    .sort((a, b) => `${a.severity}:${a.type}:${a.existing_assignment_id || ''}`.localeCompare(
      `${b.severity}:${b.type}:${b.existing_assignment_id || ''}`
    ));

  const blocking = normalized.filter((conflict) => conflict.severity === 'BLOCK');
  const review = normalized.filter((conflict) => conflict.severity === 'REVIEW');

  return {
    schema: SCHEMA,
    company_id: companyId,
    proposed_assignment: proposed,
    conflicts: normalized,
    summary: {
      conflicts_total: normalized.length,
      blocking_conflicts: blocking.length,
      review_conflicts: review.length
    },
    state: blocking.length ? 'BLOCKED' : review.length ? 'REVIEW_REQUIRED' : 'CLEAR_FOR_PROPOSAL_REVIEW',
    travel_time_inferred: false,
    calendar_truth_created: false,
    proposal_only: true,
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    automatic_reschedule: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as WORKFORCE_SCHEDULING_CONFLICT_EVALUATION_SCHEMA };
