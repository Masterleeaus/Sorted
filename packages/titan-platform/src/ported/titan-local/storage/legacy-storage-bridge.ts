// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-local/storage/legacy-storage-bridge.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { normalizeCompanyContext, normalizeLegacyCompanyContext, normalizeLegacyCompanyPayload } from '../kernel/company-context.js';
const LEGACY_MODULE = 'titan.compatibility';
const LEGACY_COLLECTION = 'legacy_storage';

export const LEGACY_STORAGE_CONTRACTS = Object.freeze({
  conversationList: 'conversations',
  conversationListV2: 'conversations_v2',
  conversationIds: 'conversation_ids',
  taskListMap: 'tasks',
  taskOptionsMap: 'task_options',
  localTaskCache: 'work_tasks',
  workspaceList: 'workspaces',
  memoryV2: 'memory',
  imageHistoryMap: 'image_history',
  agentDiscoverFeeds: 'agent_discovery',
  runToolData: 'tool_runs',
  syncToolData: 'tool_sync',
  lastActiveConversation: 'active_conversation',
  workflow_config_list: 'workflow_configs',
});

function assertLegacySourceKey(sourceKey) {
  const key = String(sourceKey || '').trim();
  if (!Object.prototype.hasOwnProperty.call(LEGACY_STORAGE_CONTRACTS, key)) throw new Error(`Unsupported legacy storage key: ${key || '<empty>'}`);
  return key;
}

export function createLegacyStorageBridge({ database, chromeStorage } = {}) {
  if (!database || typeof database.getRecord !== 'function') throw new Error('Titan business database is required');
  if (!chromeStorage || typeof chromeStorage.get !== 'function') throw new Error('chromeStorage.get is required');

  const locator = sourceKey => ({ module_id: LEGACY_MODULE, collection: LEGACY_COLLECTION, record_id: sourceKey });
  const normalizeContext = contextInput => normalizeCompanyContext(normalizeLegacyCompanyContext(contextInput || {}));

  const mirrorLegacyKey = async (contextInput, sourceKey, value, options = {}) => {
    const context = normalizeContext(contextInput);
    const key = assertLegacySourceKey(sourceKey);
    if (options.deleted) return database.deleteRecord(context, locator(key), { updated_at: options.updated_at, provenance: { source: 'chrome.storage.local', compatibility: true } });
    return database.putRecord(context, {
      ...locator(key),
      updated_at: options.updated_at,
      data: {
        source_key: key,
        namespace: LEGACY_STORAGE_CONTRACTS[key],
        compatibility: true,
        value: normalizeLegacyCompanyPayload(value, context.company_id),
      },
      provenance: { source: 'chrome.storage.local', compatibility: true },
    });
  };

  const readValue = async (contextInput, sourceKey, fallbackValue = null, options = {}) => {
    const context = normalizeContext(contextInput);
    const key = assertLegacySourceKey(sourceKey);
    const native = await database.getRecord(context, locator(key), { includeDeleted: true });
    if (native) {
      if (native.deleted) return { ok: true, found: false, deleted: true, value: fallbackValue, source: 'native-tombstone', source_key: key, company_id: native.company_id };
      return { ok: true, found: true, deleted: false, value: native.data?.value, source: 'native', source_key: key, company_id: native.company_id };
    }

    const legacy = await chromeStorage.get([key]);
    if (legacy && Object.prototype.hasOwnProperty.call(legacy, key)) {
      const value = legacy[key];
      if (options.hydrate !== false) await mirrorLegacyKey(context, key, value, { updated_at: options.updated_at });
      return { ok: true, found: true, deleted: false, value, source: 'legacy-fallback', source_key: key, company_id: context.company_id };
    }
    return { ok: true, found: false, deleted: false, value: fallbackValue, source: 'none', source_key: key, company_id: context.company_id };
  };

  const readMany = async (contextInput, sourceKeys, options = {}) => {
    const context = normalizeContext(contextInput);
    const keys = [...new Set((Array.isArray(sourceKeys) ? sourceKeys : []).map(assertLegacySourceKey))];
    const entries = await Promise.all(keys.map(async key => [key, await readValue(context, key, null, options)]));
    return { ok: entries.every(([, value]) => value.ok), company_id: context.company_id, results: Object.fromEntries(entries) };
  };

  return Object.freeze({
    legacyContracts: LEGACY_STORAGE_CONTRACTS,
    mirrorLegacyKey,
    readValue,
    readMany,
  });
}
