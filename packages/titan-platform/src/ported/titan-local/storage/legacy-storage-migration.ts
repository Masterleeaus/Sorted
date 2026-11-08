// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-local/storage/legacy-storage-migration.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { normalizeCompanyContext, normalizeLegacyCompanyContext } from '../kernel/company-context.js';
import { LEGACY_STORAGE_CONTRACTS } from './legacy-storage-bridge.js';

const PROTOCOL = 'titan.legacy.storage.migration.v1';
const CHECKPOINT_VERSION = 1;
const STORAGE_CHECKPOINT_PREFIX = 'legacy-storage';
const HISTORY_CHECKPOINT_ID = 'legacy-history';
const RECEIPT_SCHEMA = 'titan.legacy.storage.migration.receipt.v1';
const QUARANTINE_MODULE = 'titan.compatibility';
const QUARANTINE_COLLECTION = 'migration_quarantine';


function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  return value === undefined ? '__titan_undefined__' : value;
}

function fingerprint(value) {
  const input = JSON.stringify(stableValue(value)) || '';
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
  return `${input.length}-${(hash >>> 0).toString(16)}`;
}

function safeError(error) {
  const message = String(error?.message || error || 'legacy-migration-rejected');
  if (/legacy tenant boundary/i.test(message)) return { reason_code: 'legacy-boundary-conflict', message: 'Legacy tenant boundary conflicts with company_id authority' };
  if (/cross-company/i.test(message)) return { reason_code: 'cross-company-conflict', message: 'Legacy data conflicts with company_id authority' };
  return { reason_code: 'malformed-legacy-data', message: message.slice(0, 240) };
}

async function quarantine(database, context, descriptor, updatedAt) {
  if (typeof database.putRecord !== 'function') throw new Error('Titan business database record authority is required for migration quarantine');
  const evidence = {
    kind: String(descriptor.kind || 'legacy-data'),
    source_key: String(descriptor.source_key || 'unknown'),
    reason_code: String(descriptor.reason_code || 'malformed-legacy-data'),
    message: String(descriptor.message || 'Legacy data rejected from canonical migration').slice(0, 240),
    source_index: Number.isInteger(descriptor.source_index) ? descriptor.source_index : null,
    evidence_fingerprint: String(descriptor.evidence_fingerprint || fingerprint(descriptor)),
    retained_at_source: true,
  };
  const recordId = `${evidence.kind}:${evidence.source_key}:${evidence.source_index ?? 'na'}:${evidence.evidence_fingerprint}`;
  return database.putRecord(context, {
    module_id: QUARANTINE_MODULE,
    collection: QUARANTINE_COLLECTION,
    record_id: recordId,
    updated_at: Number(updatedAt ?? Date.now()),
    data: evidence,
    provenance: {
      compatibility: true,
      source: 'chrome.storage.local',
      migration_protocol: PROTOCOL,
      quarantine: true,
    },
  });
}

function normalizeSourceKeys(sourceKeys) {
  const supported = Object.keys(LEGACY_STORAGE_CONTRACTS);
  if (sourceKeys == null) return supported;
  if (!Array.isArray(sourceKeys)) throw new Error('sourceKeys must be an array when provided');
  const unique = [...new Set(sourceKeys.map(value => String(value || '').trim()).filter(Boolean))];
  for (const key of unique) {
    if (!Object.prototype.hasOwnProperty.call(LEGACY_STORAGE_CONTRACTS, key)) {
      throw new Error(`Unsupported legacy storage key: ${key}`);
    }
  }
  return unique;
}

function storageCheckpointId(sourceKey) {
  return `${STORAGE_CHECKPOINT_PREFIX}:${sourceKey}`;
}

function makeReceipt(context, checkpointId, source, target, summary, appliedAt) {
  return {
    schema: RECEIPT_SCHEMA,
    receipt_id: `${context.company_id}:${checkpointId}:v${CHECKPOINT_VERSION}`,
    company_id: context.company_id,
    migration_id: checkpointId,
    checkpoint_version: CHECKPOINT_VERSION,
    source,
    target,
    applied_at: Number(appliedAt),
    summary,
  };
}

function storageReceiptSummary(result = {}) {
  return {
    found: result.found === true,
    deleted: result.deleted === true,
    source_result: result.source || null,
    source_key: result.source_key || null,
  };
}

function historyReceiptSummary(result = {}) {
  const summary = {};
  for (const key of ['hydrated_count', 'activity_count', 'outcome_count', 'skipped_count', 'preserved_count']) {
    if (Number.isFinite(Number(result?.[key]))) summary[key] = Number(result[key]);
  }
  return summary;
}

export function createLegacyStorageMigrationAdapter({ legacyBridge, historyReconciler, database } = {}) {
  if (!legacyBridge || typeof legacyBridge.readValue !== 'function') throw new Error('Titan legacy storage bridge is required');
  if (!historyReconciler || typeof historyReconciler.reconcile !== 'function') throw new Error('Titan business history reconciler is required');
  if (!database || typeof database.getMigrationCheckpoint !== 'function' || typeof database.putMigrationCheckpoint !== 'function') {
    throw new Error('Titan business database migration checkpoints are required');
  }

  const normalizeContext = input => normalizeCompanyContext(normalizeLegacyCompanyContext(input || {}));

  const migrate = async (contextInput, options = {}) => {
    const context = normalizeContext(contextInput);
    const sourceKeys = normalizeSourceKeys(options.sourceKeys);
    const includeHistory = options.includeHistory !== false;
    const results = {};
    const checkpointSkippedKeys = [];
    const checkpointAppliedKeys = [];
    const provenanceReceipts = [];
    const quarantineRecords = [];

    for (const key of sourceKeys) {
      const checkpointId = storageCheckpointId(key);
      const existingCheckpoint = await database.getMigrationCheckpoint(context, checkpointId);
      if (existingCheckpoint) {
        checkpointSkippedKeys.push(key);
        if (existingCheckpoint.receipt) provenanceReceipts.push(existingCheckpoint.receipt);
        results[key] = {
          ok: true,
          found: null,
          deleted: false,
          source: 'migration-checkpoint',
          source_key: key,
          company_id: context.company_id,
          checkpoint: existingCheckpoint,
        };
        continue;
      }

      let result;
      try {
        result = await legacyBridge.readValue(context, key, null, {
          hydrate: true,
          updated_at: options.updated_at,
        });
      } catch (error) {
        const rejection = safeError(error);
        const descriptor = {
          kind: 'legacy-storage',
          source_key: key,
          ...rejection,
          evidence_fingerprint: fingerprint({ source_key: key, reason_code: rejection.reason_code, message: rejection.message }),
        };
        const quarantineRecord = await quarantine(database, context, descriptor, options.updated_at);
        quarantineRecords.push(quarantineRecord);
        results[key] = {
          ok: false,
          quarantined: true,
          source_key: key,
          company_id: context.company_id,
          reason_code: rejection.reason_code,
          quarantine_record_id: quarantineRecord.record_id,
        };
        continue;
      }
      results[key] = result;
      if (!result?.ok) {
        return {
          ok: false,
          protocol: PROTOCOL,
          company_id: context.company_id,
          stage: 'compatibility-storage',
          failed_source_key: key,
          compatibility: { requested_keys: sourceKeys, results },
          history: null,
          checkpointed: false,
          quarantine_count: quarantineRecords.length,
        };
      }
      const appliedAt = Number(options.updated_at ?? Date.now());
      const receipt = makeReceipt(
        context,
        checkpointId,
        { kind: 'legacy-storage', provider: 'chrome.storage.local', source_key: key },
        { authority: 'TitanBusinessDatabase', store: 'records', module_id: 'titan.compatibility', collection: 'legacy_storage' },
        storageReceiptSummary(result),
        appliedAt,
      );
      const checkpoint = await database.putMigrationCheckpoint(context, checkpointId, CHECKPOINT_VERSION, {
        applied_at: appliedAt,
        provenance: {
          compatibility: true,
          source: 'chrome.storage.local',
          source_key: key,
          migration_protocol: PROTOCOL,
        },
        receipt,
      });
      provenanceReceipts.push(checkpoint.receipt || receipt);
      checkpointAppliedKeys.push(key);
    }

    let history = null;
    let historyCheckpointSkipped = false;
    let historyCheckpointApplied = false;
    if (includeHistory) {
      const existingHistoryCheckpoint = await database.getMigrationCheckpoint(context, HISTORY_CHECKPOINT_ID);
      if (existingHistoryCheckpoint) {
        historyCheckpointSkipped = true;
        if (existingHistoryCheckpoint.receipt) provenanceReceipts.push(existingHistoryCheckpoint.receipt);
        history = {
          ok: true,
          reconciled: false,
          checkpoint_skipped: true,
          company_id: context.company_id,
          checkpoint: existingHistoryCheckpoint,
        };
      } else {
        history = await historyReconciler.reconcile(context);
        if (history && history.ok === false) {
          return {
            ok: false,
            protocol: PROTOCOL,
            company_id: context.company_id,
            stage: 'business-history',
            compatibility: { requested_keys: sourceKeys, results },
            history,
            checkpointed: false,
          };
        }
        for (const descriptor of Array.isArray(history?.quarantine_items) ? history.quarantine_items : []) {
          quarantineRecords.push(await quarantine(database, context, descriptor, options.updated_at));
        }
        const appliedAt = Number(options.updated_at ?? Date.now());
        const receipt = makeReceipt(
          context,
          HISTORY_CHECKPOINT_ID,
          { kind: 'legacy-history', provider: 'chrome.storage.local', source_keys: ['titanBusinessFeed', 'titanOutcomeHistory'] },
          { authority: 'TitanBusinessStateAuthority' },
          historyReceiptSummary(history),
          appliedAt,
        );
        if ((history?.quarantine_items?.length || 0) === 0) {
          const checkpoint = await database.putMigrationCheckpoint(context, HISTORY_CHECKPOINT_ID, CHECKPOINT_VERSION, {
            applied_at: appliedAt,
            provenance: {
              compatibility: true,
              source: 'chrome.storage.local',
              source_keys: ['titanBusinessFeed', 'titanOutcomeHistory'],
              migration_protocol: PROTOCOL,
            },
            receipt,
          });
          provenanceReceipts.push(checkpoint.receipt || receipt);
          historyCheckpointApplied = true;
        }
      }
    }

    const migratedKeys = Object.entries(results)
      .filter(([, result]) => result?.found && result?.source === 'legacy-fallback')
      .map(([key]) => key);
    const nativeKeys = Object.entries(results)
      .filter(([, result]) => result?.found && result?.source === 'native')
      .map(([key]) => key);
    const tombstonedKeys = Object.entries(results)
      .filter(([, result]) => result?.deleted === true)
      .map(([key]) => key);

    return {
      ok: true,
      protocol: PROTOCOL,
      company_id: context.company_id,
      compatibility: {
        requested_keys: sourceKeys,
        migrated_keys: migratedKeys,
        native_keys: nativeKeys,
        tombstoned_keys: tombstonedKeys,
        checkpoint_applied_keys: checkpointAppliedKeys,
        checkpoint_skipped_keys: checkpointSkippedKeys,
        results,
      },
      history,
      checkpointed: true,
      checkpoint_version: CHECKPOINT_VERSION,
      history_checkpoint_applied: historyCheckpointApplied,
      history_checkpoint_skipped: historyCheckpointSkipped,
      provenance_receipt_persisted: provenanceReceipts.length > 0,
      provenance_receipts: provenanceReceipts,
      quarantine_count: quarantineRecords.length,
      quarantined: quarantineRecords.map(record => ({ record_id: record.record_id, company_id: record.company_id, data: record.data })),
    };
  };

  return Object.freeze({
    protocol: PROTOCOL,
    checkpointVersion: CHECKPOINT_VERSION,
    supportedSourceKeys: Object.freeze(Object.keys(LEGACY_STORAGE_CONTRACTS)),
    migrate,
  });
}
