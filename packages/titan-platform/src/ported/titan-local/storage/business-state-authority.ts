// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/storage/business-state-authority.mjs
import { normalizeCompanyContext } from '../kernel/company-context.js';

const PROTOCOL = 'titan.business.state.v2';
const MODULE_ID = 'titan.business-state';
const DOMAINS = Object.freeze(new Set(['activity', 'outcome']));
const SUMMARY_COLLECTION = 'summary';
const RECEIPTS_COLLECTION = 'receipts';
const CONFLICTS_COLLECTION = 'conflicts';
const SUMMARY_ID = 'state';

const clone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value === undefined ? '__titan_undefined__' : value;
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function fingerprint(value) {
  const input = stableStringify(value) || '';
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${input.length}-${(hash >>> 0).toString(16)}`;
}

function cleanContext(input) {
  const context = normalizeCompanyContext(input || {});
  return {
    company_id: context.company_id,
    actor_id: context.actor_id,
    operation_id: context.operation_id,
    authority_grants: context.authority_grants,
  };
}

function assertDomain(domain) {
  const normalized = String(domain || '').trim().toLowerCase();
  if (!DOMAINS.has(normalized)) throw new Error(`Unsupported business-state domain: ${normalized || '<empty>'}`);
  return normalized;
}

function entityIdFor(domain, record, options = {}) {
  const value = options.entity_id ?? record?.operation_id ?? record?.outcome_id ?? record?.id;
  const entityId = String(value ?? '').trim();
  if (!entityId) throw new Error(`entity_id is required for ${domain}`);
  return entityId;
}

function locator(collection, record_id) {
  return { module_id: MODULE_ID, collection, record_id };
}

function receiptRecordId(idempotencyKey) {
  return `idem-${fingerprint(String(idempotencyKey))}`;
}

function conflictRecordId(conflict) {
  return `conflict-${fingerprint({
    domain: conflict.domain,
    entity_id: conflict.entity_id,
    idempotency_key: conflict.idempotency_key,
    record_fingerprint: conflict.record_fingerprint,
    reason: conflict.reason,
    at: conflict.at,
  })}`;
}

function defaultSummary(company_id) {
  return {
    protocol: PROTOCOL,
    company_id,
    activityCount: 0,
    outcomeCount: 0,
    commitCount: 0,
    idempotentCount: 0,
    conflictCount: 0,
    lastReceipt: null,
    lastConflict: null,
    updated_at: null,
  };
}

function summaryData(record, company_id) {
  return record?.data ? { ...defaultSummary(company_id), ...clone(record.data), company_id } : defaultSummary(company_id);
}

function publicReceipt(data) {
  if (!data) return null;
  return {
    receipt_id: data.receipt_id,
    status: data.status,
    domain: data.domain,
    entity_id: data.entity_id,
    revision: data.revision,
    expected_revision: data.expected_revision ?? null,
    actual_revision: data.actual_revision ?? null,
    idempotency_key: data.idempotency_key,
    reason: data.reason ?? null,
    at: data.at,
  };
}

async function readSummaryTx(tx, company_id) {
  return summaryData(await tx.getRecord(locator(SUMMARY_COLLECTION, SUMMARY_ID)), company_id);
}

async function writeSummaryTx(tx, context, summary, now) {
  const next = { ...summary, protocol: PROTOCOL, company_id: context.company_id, updated_at: now };
  await tx.putRecord({
    ...locator(SUMMARY_COLLECTION, SUMMARY_ID),
    updated_at: now,
    data: next,
    provenance: { source: 'titan-business-state-authority', compatibility: false },
  });
  return next;
}

export function createBusinessStateAuthority({ database, clock = () => Date.now(), emit = () => {} } = {}) {
  if (!database || typeof database.transaction !== 'function' || typeof database.getRecord !== 'function') {
    throw new Error('Titan business database is required');
  }
  if (typeof emit !== 'function') throw new Error('emit must be a function');

  const commit = async (contextInput, domainInput, recordInput, options = {}) => {
    const context = cleanContext(contextInput);
    const domain = assertDomain(domainInput);
    if (!recordInput || typeof recordInput !== 'object' || Array.isArray(recordInput)) throw new Error('Business-state record must be an object');
    if (recordInput.company_id != null && String(recordInput.company_id).trim() !== context.company_id) {
      throw new Error('Cross-company business-state payload rejected');
    }
    const entity_id = entityIdFor(domain, recordInput, options);
    const canonicalRecord = { ...clone(recordInput), company_id: context.company_id };
    const record_fingerprint = fingerprint(canonicalRecord);
    const idempotency_key = String(options.idempotency_key ?? contextInput?.idempotency_key ?? recordInput.idempotency_key ?? `${domain}:${entity_id}:${record_fingerprint}`).trim();
    if (!idempotency_key) throw new Error('idempotency_key is required');
    const expected_revision = Number.isInteger(options.expected_revision) && options.expected_revision >= 0 ? options.expected_revision : null;
    const now = Number(options.updated_at ?? clock());
    const receiptId = receiptRecordId(idempotency_key);

    const result = await database.transaction(context, { stores: ['records'], mode: 'readwrite' }, async tx => {
      const priorReceiptRecord = await tx.getRecord(locator(RECEIPTS_COLLECTION, receiptId));
      const priorReceipt = priorReceiptRecord?.data || null;
      const currentRecord = await tx.getRecord(locator(domain, entity_id), { includeDeleted: true });
      const currentEnvelope = currentRecord?.deleted ? null : currentRecord?.data || null;
      const actual_revision = Number(currentEnvelope?.revision || 0);

      if (priorReceipt?.status === 'committed') {
        if (priorReceipt.record_fingerprint === record_fingerprint && priorReceipt.domain === domain && priorReceipt.entity_id === entity_id) {
          const summary = await readSummaryTx(tx, context.company_id);
          const idempotentReceipt = { ...priorReceipt, status: 'idempotent', idempotent: true, committed: false, at: now };
          summary.idempotentCount += 1;
          summary.lastReceipt = publicReceipt(idempotentReceipt);
          await writeSummaryTx(tx, context, summary, now);
          return {
            ok: true,
            committed: false,
            idempotent: true,
            conflict: false,
            company_id: context.company_id,
            domain,
            entity_id,
            revision: Number(priorReceipt.revision || actual_revision),
            receipt: idempotentReceipt,
          };
        }

        const conflict = {
          protocol: PROTOCOL,
          receipt_id: `business-conflict-${fingerprint({ idempotency_key, record_fingerprint, now })}`,
          status: 'conflict', conflict: true, committed: false, idempotent: false,
          company_id: context.company_id, domain, entity_id, idempotency_key,
          expected_revision, actual_revision, revision: actual_revision,
          reason: 'idempotency_key_reused', record_fingerprint, at: now,
        };
        await tx.putRecord({
          ...locator(CONFLICTS_COLLECTION, conflictRecordId(conflict)), updated_at: now,
          data: conflict, provenance: { source: 'titan-business-state-authority', compatibility: false },
        });
        const summary = await readSummaryTx(tx, context.company_id);
        summary.conflictCount += 1;
        summary.lastConflict = publicReceipt(conflict);
        summary.lastReceipt = publicReceipt(conflict);
        await writeSummaryTx(tx, context, summary, now);
        return { ok: false, error: 'idempotency_conflict', ...conflict };
      }

      if (expected_revision !== null && expected_revision !== actual_revision) {
        const conflict = {
          protocol: PROTOCOL,
          receipt_id: `business-conflict-${fingerprint({ domain, entity_id, idempotency_key, expected_revision, actual_revision, now })}`,
          status: 'conflict', conflict: true, committed: false, idempotent: false,
          company_id: context.company_id, domain, entity_id, idempotency_key,
          expected_revision, actual_revision, revision: actual_revision,
          reason: 'revision_mismatch', record_fingerprint, at: now,
        };
        await tx.putRecord({
          ...locator(CONFLICTS_COLLECTION, conflictRecordId(conflict)), updated_at: now,
          data: conflict, provenance: { source: 'titan-business-state-authority', compatibility: false },
        });
        const summary = await readSummaryTx(tx, context.company_id);
        summary.conflictCount += 1;
        summary.lastConflict = publicReceipt(conflict);
        summary.lastReceipt = publicReceipt(conflict);
        await writeSummaryTx(tx, context, summary, now);
        return { ok: false, error: 'revision_conflict', ...conflict };
      }

      const revision = actual_revision + 1;
      const envelope = {
        protocol: PROTOCOL,
        company_id: context.company_id,
        domain,
        entity_id,
        revision,
        previous_revision: actual_revision,
        idempotency_key,
        record_fingerprint,
        record: canonicalRecord,
        source: String(options.source || 'titan-business-state-authority'),
        created_at: currentEnvelope?.created_at || now,
        updated_at: now,
      };
      await tx.putRecord({
        ...locator(domain, entity_id), updated_at: now, data: envelope,
        provenance: { source: envelope.source, compatibility: false },
      });
      const receipt = {
        protocol: PROTOCOL,
        receipt_id: `business-receipt-${fingerprint({ domain, entity_id, idempotency_key, revision })}`,
        status: 'committed', conflict: false, committed: true, idempotent: false,
        company_id: context.company_id, domain, entity_id, revision,
        previous_revision: actual_revision, expected_revision, actual_revision,
        idempotency_key, record_fingerprint, source: envelope.source, at: now,
      };
      await tx.putRecord({
        ...locator(RECEIPTS_COLLECTION, receiptId), updated_at: now, data: receipt,
        provenance: { source: 'titan-business-state-authority', compatibility: false },
      });
      const summary = await readSummaryTx(tx, context.company_id);
      if (!currentEnvelope) summary[domain === 'activity' ? 'activityCount' : 'outcomeCount'] += 1;
      summary.commitCount += 1;
      summary.lastReceipt = publicReceipt(receipt);
      await writeSummaryTx(tx, context, summary, now);
      return { ok: true, committed: true, idempotent: false, conflict: false, company_id: context.company_id, domain, entity_id, revision, receipt };
    });

    const eventType = result.conflict ? 'titan.business.commit.conflict' : result.idempotent ? 'titan.business.commit.idempotent' : 'titan.business.commit.committed';
    emit(eventType, {
      company_id: context.company_id,
      domain,
      entity_id,
      revision: result.revision,
      idempotency_key,
      receipt_id: result.receipt_id || result.receipt?.receipt_id || null,
      reason: result.reason || null,
      source: String(options.source || 'titan-business-state-authority'),
    });
    return clone(result);
  };

  const read = async (contextInput, domainInput, entityId) => {
    const context = cleanContext(contextInput);
    const domain = assertDomain(domainInput);
    const entity_id = String(entityId ?? '').trim();
    if (!entity_id) throw new Error('entity_id is required');
    const stored = await database.getRecord(context, locator(domain, entity_id));
    return stored?.data ? clone(stored.data) : null;
  };

  const snapshot = async contextInput => {
    const context = cleanContext(contextInput);
    const stored = await database.getRecord(context, locator(SUMMARY_COLLECTION, SUMMARY_ID));
    return clone(summaryData(stored, context.company_id));
  };

  const list = async (contextInput, domainInput, options = {}) => {
    const context = cleanContext(contextInput);
    const domain = assertDomain(domainInput);
    const stored = await database.listRecords(context, {
      module_id: MODULE_ID,
      collection: domain,
      includeDeleted: false,
      limit: Number.isInteger(options.limit) && options.limit > 0 ? Math.min(options.limit, 10000) : 10000,
    });
    return stored
      .map(item => item?.data?.record)
      .filter(record => record && record.company_id === context.company_id)
      .map(clone);
  };

  const clear = async (contextInput, domainInput, options = {}) => {
    const context = cleanContext(contextInput);
    const domain = assertDomain(domainInput);
    const existing = await database.listRecords(context, { module_id: MODULE_ID, collection: domain, includeDeleted: false, limit: 10000 });
    const now = Number(options.updated_at ?? clock());
    const cleared = await database.transaction(context, { stores: ['records'], mode: 'readwrite' }, async tx => {
      for (const item of existing) {
        await tx.deleteRecord(locator(domain, item.record_id), {
          updated_at: now,
          provenance: { source: 'titan-business-state-authority-clear', compatibility: false },
        });
      }
      const summary = await readSummaryTx(tx, context.company_id);
      summary[domain === 'activity' ? 'activityCount' : 'outcomeCount'] = Math.max(0, summary[domain === 'activity' ? 'activityCount' : 'outcomeCount'] - existing.length);
      await writeSummaryTx(tx, context, summary, now);
      return existing.length;
    });
    emit('titan.business.state.cleared', { company_id: context.company_id, domain, cleared, source: 'titan-business-state-authority' });
    return { ok: true, company_id: context.company_id, domain, cleared };
  };

  return Object.freeze({
    protocol: PROTOCOL,
    module_id: MODULE_ID,
    domains: Object.freeze([...DOMAINS]),
    commit,
    read,
    list,
    snapshot,
    clear,
  });
}
