// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/event-ledger/event-ledger.mjs
import { assertCanonicalCompanyId } from '../boundary.js';
import { canonicalJson, sha256Hex } from './canonical-json.js';
import { assertEventCategory } from './event-types.js';

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id']);

function scanLegacyTenantFields(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanLegacyTenantFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-tenant-authority-field:${path}.${key}`);
    scanLegacyTenantFields(child, `${path}.${key}`);
  }
}

function requiredString(value, error) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(error);
  return normalized;
}

function freezeEvent(event) {
  if (event.payload && typeof event.payload === 'object') Object.freeze(event.payload);
  if (Array.isArray(event.evidence_refs)) Object.freeze(event.evidence_refs);
  return Object.freeze(event);
}

export class TitanLocalEventLedger {
  constructor({ database, now = () => new Date().toISOString(), cryptoImpl = globalThis.crypto } = {}) {
    if (!database?.put || !database?.get || !database?.list) throw new Error('platform-database-required');
    this.database = database;
    this.now = now;
    this.crypto = cryptoImpl;
  }

  #company(context) {
    return assertCanonicalCompanyId(context?.company_id);
  }

  async #ordered(companyContext) {
    const rows = await this.database.list('events', companyContext, { sortBy: 'ledger_sequence' });
    return rows.sort((a, b) => Number(a.ledger_sequence || 0) - Number(b.ledger_sequence || 0));
  }

  async append(companyContext, input) {
    const company_id = this.#company(companyContext);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('event-input-required');
    scanLegacyTenantFields(input);
    if (input.company_id != null && String(input.company_id) !== company_id) throw new Error('event-company-mismatch');

    const event_id = requiredString(input.event_id || input.id, 'event-id-required');
    if (await this.database.get('events', companyContext, event_id)) throw new Error(`event-already-exists:${event_id}`);

    const event_type = requiredString(input.event_type, 'event-type-required');
    const category = assertEventCategory(input.category);
    const source = requiredString(input.source, 'event-source-required');
    const occurred_at = String(input.occurred_at || this.now());
    const prior = await this.#ordered(companyContext);
    const previous = prior.at(-1) || null;
    const ledger_sequence = Number(previous?.ledger_sequence || 0) + 1;
    const previous_hash = previous?.event_hash || null;

    const core = {
      schema_version: '1.0',
      event_id,
      event_type,
      category,
      company_id,
      operation_id: input.operation_id ? String(input.operation_id) : undefined,
      request_id: input.request_id ? String(input.request_id) : undefined,
      idempotency_key: input.idempotency_key ? String(input.idempotency_key) : undefined,
      actor_id: input.actor_id ? String(input.actor_id) : undefined,
      capability: input.capability ? String(input.capability) : undefined,
      decision_id: input.decision_id ? String(input.decision_id) : undefined,
      action_id: input.action_id ? String(input.action_id) : undefined,
      correlation_id: input.correlation_id ? String(input.correlation_id) : undefined,
      causation_id: input.causation_id ? String(input.causation_id) : undefined,
      occurred_at,
      source,
      payload: input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? structuredClone(input.payload) : {},
      evidence_refs: Array.isArray(input.evidence_refs) ? input.evidence_refs.map(String) : [],
      authority_ref: input.authority_ref ? String(input.authority_ref) : undefined,
      risk: input.risk ?? undefined,
      reversibility: input.reversibility ?? undefined,
      ledger_sequence,
      previous_hash,
    };
    for (const key of Object.keys(core)) if (core[key] === undefined) delete core[key];

    const event_hash = await sha256Hex(canonicalJson(core), this.crypto);
    const event = freezeEvent({ ...core, event_hash });

    await this.database.put('events', companyContext, {
      ...event,
      id: event_id,
      type: event_type,
    });
    return event;
  }

  async get(companyContext, eventId) {
    const row = await this.database.get('events', companyContext, requiredString(eventId, 'event-id-required'));
    if (!row) return null;
    const { id, type, created_at, updated_at, ...event } = row;
    return freezeEvent(event);
  }

  async list(companyContext, { operation_id, correlation_id, category, event_type } = {}) {
    this.#company(companyContext);
    let rows = await this.#ordered(companyContext);
    if (operation_id != null) rows = rows.filter((row) => row.operation_id === String(operation_id));
    if (correlation_id != null) rows = rows.filter((row) => row.correlation_id === String(correlation_id));
    if (category != null) rows = rows.filter((row) => row.category === String(category));
    if (event_type != null) rows = rows.filter((row) => row.event_type === String(event_type));
    return rows.map(({ id, type, created_at, updated_at, ...event }) => freezeEvent(event));
  }

  async head(companyContext) {
    const rows = await this.#ordered(companyContext);
    const last = rows.at(-1);
    if (!last) return Object.freeze({ company_id: this.#company(companyContext), ledger_sequence: 0, event_id: null, event_hash: null });
    return Object.freeze({ company_id: last.company_id, ledger_sequence: last.ledger_sequence, event_id: last.event_id, event_hash: last.event_hash });
  }

  async verify(companyContext) {
    const rows = await this.#ordered(companyContext);
    let expectedPreviousHash = null;
    let expectedSequence = 1;
    for (const row of rows) {
      if (Number(row.ledger_sequence) !== expectedSequence) {
        return Object.freeze({ valid: false, reason: 'sequence-gap', event_id: row.event_id, expected_sequence: expectedSequence });
      }
      if ((row.previous_hash ?? null) !== expectedPreviousHash) {
        return Object.freeze({ valid: false, reason: 'previous-hash-mismatch', event_id: row.event_id });
      }
      const { id, type, created_at, updated_at, event_hash, ...core } = row;
      const calculated = await sha256Hex(canonicalJson(core), this.crypto);
      if (calculated !== event_hash) {
        return Object.freeze({ valid: false, reason: 'event-hash-mismatch', event_id: row.event_id });
      }
      expectedPreviousHash = event_hash;
      expectedSequence += 1;
    }
    return Object.freeze({ valid: true, company_id: this.#company(companyContext), events: rows.length, head_hash: expectedPreviousHash });
  }
}
