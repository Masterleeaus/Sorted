// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/storage/business-history-reconciliation.mjs
import { normalizeCompanyContext, normalizeLegacyCompanyContext, normalizeLegacyCompanyPayload } from '../kernel/company-context.js';

const LEGACY_SOURCES = Object.freeze({
  activity: 'titanBusinessFeed',
  outcome: 'titanOutcomeHistory',
});

const clone = value => value == null ? value : globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value));

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value === undefined ? '__titan_undefined__' : value;
}

function fingerprint(value) {
  const input = JSON.stringify(stableValue(value)) || '';
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `${input.length}-${(hash >>> 0).toString(16)}`;
}

function entityId(domain, record) {
  const raw = record?.operation_id ?? record?.outcome_id ?? record?.id;
  const value = String(raw ?? '').trim();
  if (value) return value;
  return `legacy-${domain}-${fingerprint(record)}`;
}

function recordCompany(record) {
  const value = record?.company_id ?? record?.context?.company_id ?? record?.business?.company_id ?? null;
  return value == null || value === '' ? null : String(value).trim();
}

export function createBusinessHistoryReconciler({ authority, chromeStorage, clock = () => Date.now() } = {}) {
  if (!authority || typeof authority.commit !== 'function' || typeof authority.read !== 'function') throw new Error('Titan business state authority is required');
  if (!chromeStorage || typeof chromeStorage.get !== 'function') throw new Error('chromeStorage.get is required');

  const reconcile = async contextInput => {
    const context = normalizeCompanyContext(normalizeLegacyCompanyContext(contextInput || {}));
    const data = await chromeStorage.get(Object.values(LEGACY_SOURCES));
    const seen = new Set();
    let hydrated_count = 0;
    let skipped_count = 0;
    let preserved_count = 0;
    let duplicate_count = 0;
    let foreign_company_skipped = 0;
    let new_receipts = 0;
    const quarantine_items = [];

    for (const [domain, sourceKey] of Object.entries(LEGACY_SOURCES)) {
      const items = Array.isArray(data?.[sourceKey]) ? data[sourceKey] : [];
      for (let index = 0; index < items.length; index += 1) {
        const raw = items[index];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          skipped_count += 1;
          quarantine_items.push({ kind: 'legacy-history', source_key: sourceKey, source_index: index, reason_code: 'malformed-history-record', message: 'Legacy history entry is not an object', evidence_fingerprint: fingerprint(raw) });
          continue;
        }
        const sourceCompany = recordCompany(raw);
        if (sourceCompany && sourceCompany !== context.company_id) {
          foreign_company_skipped += 1;
          quarantine_items.push({ kind: 'legacy-history', source_key: sourceKey, source_index: index, reason_code: 'cross-company-conflict', message: 'Legacy history entry conflicts with company_id authority', evidence_fingerprint: fingerprint(raw) });
          continue;
        }
        const canonical = { ...normalizeLegacyCompanyPayload(raw, context.company_id), company_id: context.company_id };
        const id = entityId(domain, canonical);
        const recordFingerprint = fingerprint(canonical);
        const reconciliationKey = `reconcile:${domain}:${id}:${recordFingerprint}`;
        if (seen.has(reconciliationKey)) { duplicate_count += 1; continue; }
        seen.add(reconciliationKey);

        const existing = await authority.read(context, domain, id);
        if (existing && existing.source && existing.source !== 'legacy-reconciliation') {
          preserved_count += 1;
          quarantine_items.push({ kind: 'legacy-history', source_key: sourceKey, source_index: index, reason_code: 'existing-authority-conflict', message: 'Canonical business state already has non-legacy authority for this entity', evidence_fingerprint: fingerprint(raw) });
          continue;
        }

        const result = await authority.commit(
          { ...context, operation_id: `reconcile:${domain}:${id}`, idempotency_key: reconciliationKey },
          domain,
          canonical,
          { entity_id: id, idempotency_key: reconciliationKey, source: 'legacy-reconciliation', updated_at: Number(clock()) }
        );
        if (result?.committed) { hydrated_count += 1; new_receipts += 1; }
        else if (result?.idempotent) { /* already reconciled */ }
        else if (result?.conflict) {
          preserved_count += 1;
          quarantine_items.push({ kind: 'legacy-history', source_key: sourceKey, source_index: index, reason_code: 'authority-commit-conflict', message: 'Legacy history commit conflicted with canonical business-state authority', evidence_fingerprint: fingerprint(raw) });
        }
        else skipped_count += 1;
      }
    }

    return {
      ok: true,
      reconciled: true,
      company_id: context.company_id,
      hydrated_count,
      skipped_count,
      preserved_count,
      duplicate_count,
      foreign_company_skipped,
      new_receipts,
      quarantine_count: quarantine_items.length,
      quarantine_items,
      source_keys: clone(LEGACY_SOURCES),
      durable_index: 'titan.business-state receipts/idempotency records in IndexedDB',
    };
  };

  return Object.freeze({ protocol: 'titan.business.history.reconciliation.v1', reconcile });
}
