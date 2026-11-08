// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/storage/business-database.mjs
import { normalizeCompanyContext } from '../kernel/company-context.js';
import { BUSINESS_DB_SCHEMA, BUSINESS_DB_STORE_NAMES, assertKnownBusinessStore } from './schema.js';

const SAFE_ID = /^[^\u0000-\u001f\u007f]{1,256}$/;
const FORBIDDEN_BOUNDARY_KEYS = new Set(['tenant_id', 'tenant_company_id', 'workspace_tenant_id']);
const cloneValue = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function assertNoLegacyBoundary(value, path = 'value') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoLegacyBoundary(child, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_BOUNDARY_KEYS.has(key)) {
      throw new Error(`${path}.${key} is a legacy tenant boundary; company_id is the only company boundary`);
    }
    assertNoLegacyBoundary(child, `${path}.${key}`);
  }
}

function assertCompanyConsistency(value, companyId, path = 'value') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertCompanyConsistency(child, companyId, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'company_id' && child != null && String(child).trim() !== companyId) {
      throw new Error(`Cross-company payload rejected at ${path}.company_id`);
    }
    assertCompanyConsistency(child, companyId, `${path}.${key}`);
  }
}

function scopedPart(value, field, { lower = false } = {}) {
  let out = String(value ?? '').trim();
  if (lower) out = out.toLowerCase();
  if (!SAFE_ID.test(out)) throw new Error(`${field} is required and must be 1-256 printable characters`);
  return out;
}

function keyPart(value) {
  return encodeURIComponent(String(value));
}

export function makeRecordKey(company_id, module_id, collection, record_id) {
  return [company_id, module_id, collection, record_id].map(keyPart).join('|');
}

export function makeAttachmentKey(company_id, attachment_id) {
  return [company_id, attachment_id].map(keyPart).join('|');
}

export function makeIdempotencyKey(company_id, idempotency_key) {
  return [company_id, idempotency_key].map(keyPart).join('|');
}

export function makeMigrationKey(company_id, migration_id) {
  return [company_id, migration_id].map(keyPart).join('|');
}

function normalizeRecordInput(context, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Record input must be an object');
  if (input.company_id && String(input.company_id).trim() !== context.company_id) throw new Error('Cross-company record write rejected');
  assertNoLegacyBoundary(input.data, 'record.data');
  assertNoLegacyBoundary(input.provenance, 'record.provenance');
  assertCompanyConsistency(input.data, context.company_id, 'record.data');
  assertCompanyConsistency(input.provenance, context.company_id, 'record.provenance');
  const module_id = scopedPart(input.module_id, 'module_id', { lower: true });
  const collection = scopedPart(input.collection, 'collection', { lower: true });
  const record_id = scopedPart(input.record_id, 'record_id');
  const attachment_refs = [...new Set((Array.isArray(input.attachment_refs) ? input.attachment_refs : [])
    .map(value => scopedPart(value, 'attachment_ref')))].sort();
  return { module_id, collection, record_id, attachment_refs };
}

function normalizeRecordLocator(context, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Record locator must be an object');
  if (input.company_id && String(input.company_id).trim() !== context.company_id) throw new Error('Cross-company record access rejected');
  return {
    module_id: scopedPart(input.module_id, 'module_id', { lower: true }),
    collection: scopedPart(input.collection, 'collection', { lower: true }),
    record_id: scopedPart(input.record_id, 'record_id'),
  };
}

function normalizeAttachmentInput(context, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Attachment input must be an object');
  if (input.company_id && String(input.company_id).trim() !== context.company_id) throw new Error('Cross-company attachment write rejected');
  assertNoLegacyBoundary(input.metadata, 'attachment.metadata');
  assertCompanyConsistency(input.metadata, context.company_id, 'attachment.metadata');
  const attachment_id = scopedPart(input.attachment_id, 'attachment_id');
  const module_id = scopedPart(input.module_id, 'module_id', { lower: true });
  return { attachment_id, module_id };
}

function normalizeContext(input) {
  return normalizeCompanyContext(input || {});
}

function sortRecords(records, orderBy = 'record_id', direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const allowed = new Set(['record_id', 'created_at', 'updated_at', 'version']);
  const field = allowed.has(orderBy) ? orderBy : 'record_id';
  return records.sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return String(a.pk).localeCompare(String(b.pk)) * dir;
  });
}

export function createBusinessDatabase({ adapter, clock = () => Date.now() } = {}) {
  if (!adapter || typeof adapter.transaction !== 'function') throw new Error('A Titan business database adapter is required');

  const readRecordWithTx = async (rawTx, context, locator, { includeDeleted = false } = {}) => {
    const normalized = normalizeRecordLocator(context, locator);
    const pk = makeRecordKey(context.company_id, normalized.module_id, normalized.collection, normalized.record_id);
    const record = await rawTx.get('records', pk);
    if (!record || (record.deleted && !includeDeleted)) return null;
    return cloneValue(record);
  };

  const putRecordWithTx = async (rawTx, context, input = {}) => {
    const normalized = normalizeRecordInput(context, input);
    const pk = makeRecordKey(context.company_id, normalized.module_id, normalized.collection, normalized.record_id);

    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      const receipt = await rawTx.get('idempotency', idempotencyPk);
      if (receipt?.result_store === 'records' && receipt.result_pk) {
        const prior = await rawTx.get('records', receipt.result_pk);
        if (prior) return cloneValue(prior);
      }
    }

    const prior = await rawTx.get('records', pk);
    const now = Number(input.updated_at ?? clock());
    const createdAt = Number(prior?.created_at ?? input.created_at ?? now);
    const record = {
      pk,
      company_id: context.company_id,
      module_id: normalized.module_id,
      collection: normalized.collection,
      record_id: normalized.record_id,
      version: Number(prior?.version || 0) + 1,
      created_at: createdAt,
      updated_at: now,
      deleted: false,
      data: cloneValue(input.data ?? null),
      attachment_refs: normalized.attachment_refs,
      actor_id: context.actor_id,
      operation_id: context.operation_id,
      provenance: cloneValue(input.provenance ?? null),
    };
    await rawTx.put('records', record);

    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      await rawTx.put('idempotency', {
        pk: idempotencyPk,
        company_id: context.company_id,
        idempotency_key: context.idempotency_key,
        result_store: 'records',
        result_pk: pk,
        created_at: now,
      });
    }
    return cloneValue(record);
  };

  const deleteRecordWithTx = async (rawTx, context, locator, options = {}) => {
    const normalized = normalizeRecordLocator(context, locator);
    const pk = makeRecordKey(context.company_id, normalized.module_id, normalized.collection, normalized.record_id);
    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      const receipt = await rawTx.get('idempotency', idempotencyPk);
      if (receipt?.result_store === 'records' && receipt.result_pk) {
        const priorResult = await rawTx.get('records', receipt.result_pk);
        if (priorResult) return cloneValue(priorResult);
      }
    }
    const prior = await rawTx.get('records', pk);
    if (prior?.deleted) return cloneValue(prior);
    const now = Number(options.updated_at ?? clock());
    const tombstone = {
      pk,
      company_id: context.company_id,
      module_id: normalized.module_id,
      collection: normalized.collection,
      record_id: normalized.record_id,
      version: Number(prior?.version || 0) + 1,
      created_at: Number(prior?.created_at ?? now),
      updated_at: now,
      deleted: true,
      data: null,
      attachment_refs: cloneValue(prior?.attachment_refs || []),
      actor_id: context.actor_id,
      operation_id: context.operation_id,
      provenance: cloneValue(options.provenance ?? prior?.provenance ?? null),
    };
    await rawTx.put('records', tombstone);
    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      await rawTx.put('idempotency', {
        pk: idempotencyPk, company_id: context.company_id, idempotency_key: context.idempotency_key,
        result_store: 'records', result_pk: pk, created_at: now,
      });
    }
    return cloneValue(tombstone);
  };

  const putAttachmentWithTx = async (rawTx, context, input = {}) => {
    const normalized = normalizeAttachmentInput(context, input);
    const pk = makeAttachmentKey(context.company_id, normalized.attachment_id);
    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      const receipt = await rawTx.get('idempotency', idempotencyPk);
      if (receipt?.result_store === 'attachments' && receipt.result_pk) {
        const priorResult = await rawTx.get('attachments', receipt.result_pk);
        if (priorResult) return cloneValue(priorResult);
      }
    }
    const prior = await rawTx.get('attachments', pk);
    const now = Number(input.updated_at ?? clock());
    const attachment = {
      pk,
      company_id: context.company_id,
      module_id: normalized.module_id,
      attachment_id: normalized.attachment_id,
      version: Number(prior?.version || 0) + 1,
      created_at: Number(prior?.created_at ?? input.created_at ?? now),
      updated_at: now,
      name: String(input.name || normalized.attachment_id),
      mime_type: String(input.mime_type || 'application/octet-stream'),
      size: Number.isFinite(Number(input.size)) ? Number(input.size) : null,
      checksum: input.checksum == null ? null : String(input.checksum),
      metadata: cloneValue(input.metadata ?? null),
      content: cloneValue(input.content ?? null),
      actor_id: context.actor_id,
      operation_id: context.operation_id,
    };
    await rawTx.put('attachments', attachment);
    if (context.idempotency_key) {
      const idempotencyPk = makeIdempotencyKey(context.company_id, context.idempotency_key);
      await rawTx.put('idempotency', {
        pk: idempotencyPk, company_id: context.company_id, idempotency_key: context.idempotency_key,
        result_store: 'attachments', result_pk: pk, created_at: now,
      });
    }
    return cloneValue(attachment);
  };

  const createScopedTransaction = (rawTx, context) => Object.freeze({
    company_id: context.company_id,
    getRecord: (locator, options) => readRecordWithTx(rawTx, context, locator, options),
    putRecord: input => putRecordWithTx(rawTx, context, input),
    deleteRecord: (locator, options) => deleteRecordWithTx(rawTx, context, locator, options),
    getAttachment: async attachmentId => {
      const id = scopedPart(attachmentId, 'attachment_id');
      const value = await rawTx.get('attachments', makeAttachmentKey(context.company_id, id));
      return value ? cloneValue(value) : null;
    },
    putAttachment: input => putAttachmentWithTx(rawTx, context, input),
  });

  const api = {
    schema: BUSINESS_DB_SCHEMA,
    async open() { await adapter.open?.(); return api; },
    async close() { await adapter.close?.(); },
    async health() {
      const adapterHealth = typeof adapter.health === 'function' ? await adapter.health() : { ok: true };
      return { ...adapterHealth, authority: 'indexeddb_local_primary', company_boundary: 'company_id', schema_version: BUSINESS_DB_SCHEMA.version };
    },
    async transaction(contextInput, options = {}, work) {
      const context = normalizeContext(contextInput);
      if (typeof work !== 'function') throw new Error('Transaction work function is required');
      const requested = Array.isArray(options.stores) && options.stores.length ? options.stores : ['records'];
      const stores = [...new Set(requested.map(assertKnownBusinessStore))];
      if (context.idempotency_key && options.mode !== 'readonly' && !stores.includes('idempotency')) stores.push('idempotency');
      const mode = options.mode === 'readwrite' ? 'readwrite' : 'readonly';
      return adapter.transaction(stores, mode, rawTx => work(createScopedTransaction(rawTx, context)));
    },
    async putRecord(contextInput, input) {
      const context = normalizeContext(contextInput);
      const stores = ['records'];
      if (context.idempotency_key) stores.push('idempotency');
      return adapter.transaction(stores, 'readwrite', rawTx => putRecordWithTx(rawTx, context, input));
    },
    async getRecord(contextInput, locator, options = {}) {
      const context = normalizeContext(contextInput);
      return adapter.transaction(['records'], 'readonly', rawTx => readRecordWithTx(rawTx, context, locator, options));
    },
    async listRecords(contextInput, query = {}) {
      const context = normalizeContext(contextInput);
      const moduleId = query.module_id == null ? null : scopedPart(query.module_id, 'module_id', { lower: true });
      const collection = query.collection == null ? null : scopedPart(query.collection, 'collection', { lower: true });
      if (collection && !moduleId) throw new Error('module_id is required when collection is provided');
      return adapter.transaction(['records'], 'readonly', async rawTx => {
        let rows;
        if (moduleId && collection) rows = await rawTx.getAllByIndex('records', 'by_company_collection', [context.company_id, moduleId, collection]);
        else if (moduleId) rows = await rawTx.getAllByIndex('records', 'by_company_module', [context.company_id, moduleId]);
        else rows = await rawTx.getAllByIndex('records', 'by_company', context.company_id);
        const filtered = rows.filter(row => row.company_id === context.company_id && (query.includeDeleted || !row.deleted));
        const sorted = sortRecords(filtered, query.order_by, query.direction);
        const offset = Math.max(0, Number(query.offset) || 0);
        const limit = Math.min(10000, Math.max(0, query.limit == null ? 1000 : Number(query.limit) || 0));
        return cloneValue(sorted.slice(offset, offset + limit));
      });
    },
    async deleteRecord(contextInput, locator, options = {}) {
      const context = normalizeContext(contextInput);
      const stores = ['records'];
      if (context.idempotency_key) stores.push('idempotency');
      return adapter.transaction(stores, 'readwrite', rawTx => deleteRecordWithTx(rawTx, context, locator, options));
    },
    async putAttachment(contextInput, input) {
      const context = normalizeContext(contextInput);
      const stores = ['attachments'];
      if (context.idempotency_key) stores.push('idempotency');
      return adapter.transaction(stores, 'readwrite', rawTx => putAttachmentWithTx(rawTx, context, input));
    },
    async getAttachment(contextInput, attachmentId) {
      const context = normalizeContext(contextInput);
      const id = scopedPart(attachmentId, 'attachment_id');
      return adapter.transaction(['attachments'], 'readonly', async rawTx => {
        const value = await rawTx.get('attachments', makeAttachmentKey(context.company_id, id));
        return value ? cloneValue(value) : null;
      });
    },
    async listAttachments(contextInput, query = {}) {
      const context = normalizeContext(contextInput);
      const moduleId = query.module_id == null ? null : scopedPart(query.module_id, 'module_id', { lower: true });
      return adapter.transaction(['attachments'], 'readonly', async rawTx => {
        const rows = moduleId
          ? await rawTx.getAllByIndex('attachments', 'by_company_module', [context.company_id, moduleId])
          : await rawTx.getAllByIndex('attachments', 'by_company', context.company_id);
        return cloneValue(rows.filter(row => row.company_id === context.company_id).sort((a,b)=>String(a.attachment_id).localeCompare(String(b.attachment_id))));
      });
    },
    async getMigrationCheckpoint(contextInput, migrationId) {
      const context = normalizeContext(contextInput);
      const id = scopedPart(migrationId, 'migration_id', { lower: true });
      return adapter.transaction(['migrations'], 'readonly', async rawTx => {
        const value = await rawTx.get('migrations', makeMigrationKey(context.company_id, id));
        return value ? cloneValue(value) : null;
      });
    },
    async putMigrationCheckpoint(contextInput, migrationId, version = 1, options = {}) {
      const context = normalizeContext(contextInput);
      const id = scopedPart(migrationId, 'migration_id', { lower: true });
      const normalizedVersion = Number(version);
      if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1) throw new Error(`Migration ${id} version must be a positive integer`);
      return adapter.transaction(['migrations'], 'readwrite', async rawTx => {
        const pk = makeMigrationKey(context.company_id, id);
        const existing = await rawTx.get('migrations', pk);
        if (existing) {
          if (Number(existing.version) !== normalizedVersion) throw new Error(`Migration checkpoint version conflict: ${id}`);
          return cloneValue(existing);
        }
        const checkpoint = {
          pk,
          company_id: context.company_id,
          migration_id: id,
          version: normalizedVersion,
          applied_at: Number(options.applied_at ?? clock()),
          provenance: cloneValue(options.provenance ?? null),
          receipt: cloneValue(options.receipt ?? null),
        };
        await rawTx.put('migrations', checkpoint);
        return cloneValue(checkpoint);
      });
    },
    async runMigrations(contextInput, migrations = []) {
      const context = normalizeContext(contextInput);
      if (!Array.isArray(migrations)) throw new Error('migrations must be an array');
      const normalized = migrations.map((migration, index) => {
        if (!migration || typeof migration !== 'object' || typeof migration.up !== 'function') throw new Error(`Migration ${index} must define up()`);
        const id = scopedPart(migration.id, `migrations[${index}].id`, { lower: true });
        const version = Number(migration.version);
        if (!Number.isInteger(version) || version < 1) throw new Error(`Migration ${id} version must be a positive integer`);
        const stores = [...new Set((Array.isArray(migration.stores) ? migration.stores : []).map(assertKnownBusinessStore))];
        return { ...migration, id, version, stores };
      }).sort((a,b)=>a.version-b.version || a.id.localeCompare(b.id));
      const seen = new Set();
      for (const migration of normalized) {
        if (seen.has(migration.id)) throw new Error(`Duplicate migration id: ${migration.id}`);
        seen.add(migration.id);
      }
      const applied = [], skipped = [];
      for (const migration of normalized) {
        const stores = ['migrations', ...migration.stores];
        const outcome = await adapter.transaction([...new Set(stores)], 'readwrite', async rawTx => {
          const pk = makeMigrationKey(context.company_id, migration.id);
          if (await rawTx.get('migrations', pk)) return 'skipped';
          await migration.up({ tx: createScopedTransaction(rawTx, context), context: cloneValue(context) });
          await rawTx.put('migrations', {
            pk,
            company_id: context.company_id,
            migration_id: migration.id,
            version: migration.version,
            applied_at: Number(clock()),
          });
          return 'applied';
        });
        (outcome === 'applied' ? applied : skipped).push(migration.id);
      }
      return { company_id: context.company_id, applied, skipped };
    },
  };
  return Object.freeze(api);
}

export { BUSINESS_DB_STORE_NAMES };
