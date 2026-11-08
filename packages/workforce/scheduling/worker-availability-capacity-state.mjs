const SCHEMA = 'titan.workforce.worker-availability-capacity-state.v1';

function requireCompanyId(value, label = 'input') {
  if (!value || typeof value !== 'string') throw new Error(`${label}.company_id is required`);
  return value;
}

function rejectLegacyBoundary(input) {
  if (input && (Object.hasOwn(input, 'tenant_id') || Object.hasOwn(input, 'tenant_company_id'))) {
    throw new Error('legacy tenant boundary is not permitted; use company_id only');
  }
}

function sameCompany(expected, value, label) {
  if (value == null) return;
  if (value !== expected) throw new Error(`cross-company ${label}`);
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAvailability(entry = {}) {
  const state = String(entry.state || entry.availability || 'UNKNOWN').toUpperCase();
  const known = new Set(['AVAILABLE', 'UNAVAILABLE', 'PARTIAL', 'UNKNOWN']);
  return {
    worker_id: String(entry.worker_id || ''),
    state: known.has(state) ? state : 'UNKNOWN',
    available_from: entry.available_from ?? null,
    available_until: entry.available_until ?? null,
    source_ref: entry.source_ref ?? null,
    revision: entry.revision ?? null
  };
}

export function buildWorkerAvailabilityCapacityState(input = {}) {
  rejectLegacyBoundary(input);
  const companyId = requireCompanyId(input.company_id, 'input');

  const capacity = input.capacity_snapshot;
  if (!capacity || typeof capacity !== 'object') throw new Error('capacity_snapshot is required');
  rejectLegacyBoundary(capacity);
  sameCompany(companyId, requireCompanyId(capacity.company_id, 'capacity_snapshot'), 'capacity_snapshot');

  const availability = Array.isArray(input.availability) ? input.availability : [];
  const availabilityByWorker = new Map();

  for (const raw of availability) {
    rejectLegacyBoundary(raw);
    sameCompany(companyId, raw.company_id, 'availability');
    const normalized = normalizeAvailability(raw);
    if (!normalized.worker_id) throw new Error('availability.worker_id is required');
    availabilityByWorker.set(normalized.worker_id, normalized);
  }

  const workerCapacity = Array.isArray(capacity.worker_capacity) ? capacity.worker_capacity : [];
  const workers = workerCapacity.map((row) => {
    sameCompany(companyId, row.company_id, 'worker_capacity');
    const workerId = String(row.worker_id || '');
    if (!workerId) throw new Error('worker_capacity.worker_id is required');

    const a = availabilityByWorker.get(workerId) || {
      worker_id: workerId,
      state: 'UNKNOWN',
      available_from: null,
      available_until: null,
      source_ref: null,
      revision: null
    };

    const capacityUnits = toFiniteNumber(row.capacity_units, 0);
    const demandUnits = toFiniteNumber(row.demand_units, 0);
    const availableUnits = Math.max(0, toFiniteNumber(
      row.available_capacity_units,
      capacityUnits - demandUnits
    ));

    const capacityState = String(row.state || 'UNKNOWN').toUpperCase();
    const blockers = [];
    if (a.state !== 'AVAILABLE') blockers.push(`AVAILABILITY_${a.state}`);
    if (availableUnits <= 0 || capacityState === 'OVERLOADED') blockers.push('NO_AVAILABLE_CAPACITY');

    return {
      company_id: companyId,
      worker_id: workerId,
      availability: a,
      capacity: {
        state: capacityState,
        capacity_units: capacityUnits,
        demand_units: demandUnits,
        available_capacity_units: availableUnits
      },
      eligible_for_scheduling_proposal: blockers.length === 0,
      blockers
    };
  });

  const eligible = workers.filter((row) => row.eligible_for_scheduling_proposal);
  const unknownAvailability = workers.filter((row) => row.availability.state === 'UNKNOWN');

  return {
    schema: SCHEMA,
    company_id: companyId,
    source_capacity_schema: capacity.schema ?? null,
    source_capacity_revision: capacity.projection_revision ?? capacity.revision ?? null,
    workers,
    summary: {
      workers_total: workers.length,
      workers_eligible: eligible.length,
      workers_blocked: workers.length - eligible.length,
      workers_unknown_availability: unknownAvailability.length
    },
    state: unknownAvailability.length ? 'AVAILABILITY_REVIEW_REQUIRED' : 'READY_FOR_PROPOSAL_EVALUATION',
    proposal_only: true,
    requires_fresh_assignment_authority: true,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as WORKER_AVAILABILITY_CAPACITY_STATE_SCHEMA };
