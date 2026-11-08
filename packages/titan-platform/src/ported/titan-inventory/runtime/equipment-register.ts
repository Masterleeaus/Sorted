// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/equipment-register.mjs
const LEGACY_BOUNDARY_KEYS = ['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];
const ASSET_TYPES = new Set(['equipment','vehicle','tool','ppe_reusable','container','other']);
const LIFECYCLE_STATES = new Set(['registered','available','assigned','in_service','maintenance_due','under_maintenance','damaged','lost','retired']);
const CONDITION_STATES = new Set(['unknown','new','good','fair','poor','damaged','unserviceable']);
const ASSIGNMENT_TYPES = new Set(['worker','vehicle','site']);

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}

function assertNoLegacyBoundary(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of LEGACY_BOUNDARY_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`legacy boundary ${key} is not allowed`);
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizedProvenance(provenance, fallbackKey) {
  const source = assertString(provenance?.source ?? 'inventory_runtime', 'provenance.source');
  const idempotency_key = assertString(provenance?.idempotency_key ?? fallbackKey, 'provenance.idempotency_key');
  const recorded_at = provenance?.recorded_at ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(recorded_at))) throw new TypeError('provenance.recorded_at must be an ISO date-time');
  return {
    source,
    source_ref: provenance?.source_ref ?? null,
    recorded_at,
    idempotency_key,
    trace_id: provenance?.trace_id ?? null,
    correlation_id: provenance?.correlation_id ?? null,
  };
}

function sanitizeAsset(input) {
  assertNoLegacyBoundary(input);
  const asset_id = assertString(input.asset_id, 'asset_id');
  const company_id = assertString(input.company_id, 'company_id');
  const asset_type = assertString(input.asset_type, 'asset_type');
  const name = assertString(input.name, 'name');
  if (!ASSET_TYPES.has(asset_type)) throw new RangeError(`unsupported asset_type: ${asset_type}`);
  const lifecycle_state = input.lifecycle_state ?? 'registered';
  const condition_state = input.condition_state ?? 'unknown';
  if (!LIFECYCLE_STATES.has(lifecycle_state)) throw new RangeError(`unsupported lifecycle_state: ${lifecycle_state}`);
  if (!CONDITION_STATES.has(condition_state)) throw new RangeError(`unsupported condition_state: ${condition_state}`);
  return {
    asset_id,
    company_id,
    asset_type,
    catalog_product_id: input.catalog_product_id ?? null,
    name,
    serial_number: input.serial_number ?? null,
    lifecycle_state,
    condition_state,
    stock_location_id: input.stock_location_id ?? null,
    assigned_worker_id: input.assigned_worker_id ?? null,
    assigned_vehicle_id: input.assigned_vehicle_id ?? null,
    assigned_site_id: input.assigned_site_id ?? null,
    authority: { execution_granted: false, business_authority_granted: false },
    provenance: normalizedProvenance(input.provenance, `register:${company_id}:${asset_id}`),
    version: Number.isInteger(input.version) && input.version > 0 ? input.version : 1,
    updated_at: input.updated_at ?? new Date().toISOString(),
  };
}

export class EquipmentRegister {
  #assets = new Map();
  #applied = new Map();

  constructor({ seed = [] } = {}) {
    for (const raw of seed) {
      const asset = sanitizeAsset(raw);
      this.#assets.set(this.#key(asset.company_id, asset.asset_id), asset);
    }
  }

  #key(company_id, asset_id) { return `${company_id}::${asset_id}`; }

  #dedupe(company_id, idempotencyKey, action) {
    const key = `${company_id}::${assertString(idempotencyKey, 'idempotency_key')}`;
    if (this.#applied.has(key)) return { replayed: true, result: clone(this.#applied.get(key)) };
    const result = action();
    this.#applied.set(key, clone(result));
    return { replayed: false, result };
  }

  register(input) {
    const asset = sanitizeAsset(input);
    return this.#dedupe(asset.company_id, asset.provenance.idempotency_key, () => {
      const key = this.#key(asset.company_id, asset.asset_id);
      const existing = this.#assets.get(key);
      if (existing) return clone(existing);
      this.#assets.set(key, asset);
      return clone(asset);
    });
  }

  get(company_id, asset_id) {
    company_id = assertString(company_id, 'company_id');
    asset_id = assertString(asset_id, 'asset_id');
    return clone(this.#assets.get(this.#key(company_id, asset_id)) ?? null);
  }

  list(company_id, { asset_type, lifecycle_state, condition_state } = {}) {
    company_id = assertString(company_id, 'company_id');
    return [...this.#assets.values()]
      .filter((a) => a.company_id === company_id)
      .filter((a) => !asset_type || a.asset_type === asset_type)
      .filter((a) => !lifecycle_state || a.lifecycle_state === lifecycle_state)
      .filter((a) => !condition_state || a.condition_state === condition_state)
      .sort((a, b) => a.asset_id.localeCompare(b.asset_id))
      .map(clone);
  }

  assign({ company_id, asset_id, assignment_type, assignment_id, provenance }) {
    company_id = assertString(company_id, 'company_id');
    asset_id = assertString(asset_id, 'asset_id');
    assignment_type = assertString(assignment_type, 'assignment_type');
    assignment_id = assertString(assignment_id, 'assignment_id');
    assertNoLegacyBoundary(provenance);
    if (!ASSIGNMENT_TYPES.has(assignment_type)) throw new RangeError(`unsupported assignment_type: ${assignment_type}`);
    const p = normalizedProvenance(provenance, `assign:${company_id}:${asset_id}:${assignment_type}:${assignment_id}`);
    return this.#dedupe(company_id, p.idempotency_key, () => {
      const key = this.#key(company_id, asset_id);
      const asset = this.#assets.get(key);
      if (!asset) throw new Error('asset not found for company_id');
      asset.assigned_worker_id = null;
      asset.assigned_vehicle_id = null;
      asset.assigned_site_id = null;
      if (assignment_type === 'worker') asset.assigned_worker_id = assignment_id;
      if (assignment_type === 'vehicle') asset.assigned_vehicle_id = assignment_id;
      if (assignment_type === 'site') asset.assigned_site_id = assignment_id;
      asset.lifecycle_state = 'assigned';
      asset.provenance = p;
      asset.version += 1;
      asset.updated_at = p.recorded_at;
      asset.authority = { execution_granted: false, business_authority_granted: false };
      return clone(asset);
    });
  }

  unassign({ company_id, asset_id, provenance }) {
    company_id = assertString(company_id, 'company_id');
    asset_id = assertString(asset_id, 'asset_id');
    const p = normalizedProvenance(provenance, `unassign:${company_id}:${asset_id}`);
    return this.#dedupe(company_id, p.idempotency_key, () => {
      const asset = this.#assets.get(this.#key(company_id, asset_id));
      if (!asset) throw new Error('asset not found for company_id');
      asset.assigned_worker_id = null;
      asset.assigned_vehicle_id = null;
      asset.assigned_site_id = null;
      if (asset.lifecycle_state === 'assigned') asset.lifecycle_state = 'available';
      asset.provenance = p;
      asset.version += 1;
      asset.updated_at = p.recorded_at;
      asset.authority = { execution_granted: false, business_authority_granted: false };
      return clone(asset);
    });
  }

  updateCondition({ company_id, asset_id, condition_state, provenance }) {
    company_id = assertString(company_id, 'company_id');
    asset_id = assertString(asset_id, 'asset_id');
    condition_state = assertString(condition_state, 'condition_state');
    if (!CONDITION_STATES.has(condition_state)) throw new RangeError(`unsupported condition_state: ${condition_state}`);
    const p = normalizedProvenance(provenance, `condition:${company_id}:${asset_id}:${condition_state}`);
    return this.#dedupe(company_id, p.idempotency_key, () => {
      const asset = this.#assets.get(this.#key(company_id, asset_id));
      if (!asset) throw new Error('asset not found for company_id');
      asset.condition_state = condition_state;
      if (condition_state === 'damaged') asset.lifecycle_state = 'damaged';
      if (condition_state === 'unserviceable' && asset.lifecycle_state !== 'retired') asset.lifecycle_state = 'under_maintenance';
      asset.provenance = p;
      asset.version += 1;
      asset.updated_at = p.recorded_at;
      asset.authority = { execution_granted: false, business_authority_granted: false };
      return clone(asset);
    });
  }

  updateStatus({ company_id, asset_id, lifecycle_state, provenance }) {
    company_id = assertString(company_id, 'company_id');
    asset_id = assertString(asset_id, 'asset_id');
    lifecycle_state = assertString(lifecycle_state, 'lifecycle_state');
    if (!LIFECYCLE_STATES.has(lifecycle_state)) throw new RangeError(`unsupported lifecycle_state: ${lifecycle_state}`);
    const p = normalizedProvenance(provenance, `status:${company_id}:${asset_id}:${lifecycle_state}`);
    return this.#dedupe(company_id, p.idempotency_key, () => {
      const asset = this.#assets.get(this.#key(company_id, asset_id));
      if (!asset) throw new Error('asset not found for company_id');
      asset.lifecycle_state = lifecycle_state;
      if (['retired','lost','under_maintenance'].includes(lifecycle_state)) {
        asset.assigned_worker_id = null;
        asset.assigned_vehicle_id = null;
        asset.assigned_site_id = null;
      }
      asset.provenance = p;
      asset.version += 1;
      asset.updated_at = p.recorded_at;
      asset.authority = { execution_granted: false, business_authority_granted: false };
      return clone(asset);
    });
  }
}

export function createEquipmentRegister(options) { return new EquipmentRegister(options); }
