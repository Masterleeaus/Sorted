// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/operation-identity/store.mjs
import { createOperationIdentity, assertOperationIdentity, transitionOperationIdentity, operationStorageRecord } from './identity.js';
import { bindOperationStage, assertOperationContinuity } from './envelope.js';

function stripStorage(row) {
  if (!row) return null;
  const { id, status, stages, ...identity } = row;
  return Object.freeze(identity);
}

export class TitanOperationIdentityStore {
  constructor({ database, now = () => new Date().toISOString() } = {}) {
    if (!database?.put || !database?.get || !database?.list) throw new Error('platform-database-required');
    this.database = database;
    this.now = now;
  }
  async create(input, options = {}) {
    const identity = createOperationIdentity(input, { now: this.now, ...options });
    const context = { company_id: identity.company_id };
    const existing = await this.database.get('operations', context, identity.operation_id);
    if (existing) {
      const current = stripStorage(existing);
      assertOperationIdentity(current, { company_id: identity.company_id, operation_id: identity.operation_id });
      if (current.idempotency_key !== identity.idempotency_key || current.request_id !== identity.request_id) throw new Error(`operation-id-collision:${identity.operation_id}`);
      return current;
    }
    const rows = await this.database.list('operations', context);
    const duplicate = rows.find(row => row.idempotency_key === identity.idempotency_key);
    if (duplicate) return stripStorage(duplicate);
    await this.database.put('operations', context, { ...operationStorageRecord(identity), stages: [] });
    return identity;
  }
  async get(companyContext, operationId) {
    return stripStorage(await this.database.get('operations', companyContext, String(operationId)));
  }
  async transition(companyContext, operationId, nextState, patch = {}) {
    const current = await this.get(companyContext, operationId);
    if (!current) throw new Error(`operation-not-found:${operationId}`);
    const next = transitionOperationIdentity(current, nextState, patch, { now: this.now });
    const row = await this.database.get('operations', companyContext, String(operationId));
    await this.database.put('operations', companyContext, { ...operationStorageRecord(next), stages: [...(row?.stages || [])] });
    return next;
  }
  async bind(companyContext, operationId, stage, payload = {}) {
    const current = await this.get(companyContext, operationId);
    if (!current) throw new Error(`operation-not-found:${operationId}`);
    const envelope = bindOperationStage(current, stage, payload);
    assertOperationContinuity(current, envelope);
    const row = await this.database.get('operations', companyContext, String(operationId));
    const stages = [...(row?.stages || []), envelope];
    await this.database.put('operations', companyContext, { ...(row || operationStorageRecord(current)), ...current, id: current.operation_id, status: stage, stages });
    return envelope;
  }
  async findByIdempotency(companyContext, idempotencyKey) {
    const rows = await this.database.list('operations', companyContext);
    return stripStorage(rows.find(row => row.idempotency_key === String(idempotencyKey)) || null);
  }
  async list(companyContext) {
    return (await this.database.list('operations', companyContext, { sortBy: 'created_at' })).map(stripStorage);
  }
}
