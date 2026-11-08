// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-local/storage/bootstrap.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { createIndexedDbAdapter } from './indexed-db.js';
import { createBusinessDatabase } from './business-database.js';
import { createLegacyStorageBridge } from './legacy-storage-bridge.js';
import { createBusinessStateAuthority } from './business-state-authority.js';
import { createBusinessHistoryReconciler } from './business-history-reconciliation.js';
import { createLegacyStorageMigrationAdapter } from './legacy-storage-migration.js';
import { createFeedPresentationStateStore } from '../../titan-runtime/feed/feed-presentation-state.js';
import { createFeedDeliveryReplayGuard } from '../../titan-runtime/feed/feed-delivery-replay-guard.js';

const adapter = createIndexedDbAdapter();
const database = createBusinessDatabase({ adapter });
const legacyBridge = createLegacyStorageBridge({ database, chromeStorage: chrome.storage.local });
const businessStateAuthority = createBusinessStateAuthority({ database });
const businessHistoryReconciler = createBusinessHistoryReconciler({ authority: businessStateAuthority, chromeStorage: chrome.storage.local });
const legacyStorageMigration = createLegacyStorageMigrationAdapter({ legacyBridge, historyReconciler: businessHistoryReconciler, database });
const feedPresentationState = createFeedPresentationStateStore({ database });
const feedDeliveryReplayGuard = createFeedDeliveryReplayGuard({ database });

const ready = database.open().catch(error => {
  try {
    globalThis.titanDiag?.('error', 'Titan business IndexedDB failed to open', { message: error.message, stack: error.stack });
  } catch (_) {}
  throw error;
});

globalThis.TitanBusinessDatabase = database;
globalThis.TitanBusinessDatabaseReady = ready;
globalThis.TitanLegacyStorageBridge = legacyBridge;
globalThis.TitanBusinessStateAuthority = businessStateAuthority;
globalThis.TitanBusinessHistoryReconciler = businessHistoryReconciler;
globalThis.TitanLegacyStorageMigration = legacyStorageMigration;
globalThis.TitanFeedPresentationState = feedPresentationState;
globalThis.TitanFeedDeliveryReplayGuard = feedDeliveryReplayGuard;

try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'TITAN_BUSINESS_DATABASE' && message?.action === 'health') {
      ready.then(() => database.health())
        .then(health => sendResponse({ ok: true, businessDatabase: health }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type === 'TITAN_FEED_DELIVERY_REPLAY_GUARD') {
      ready.then(async () => {
        const context = message.context || { company_id: message.company_id, actor_id: message.actor_id, operation_id: message.operation_id, idempotency_key: message.idempotency_key };
        switch (message.action) {
          case 'prepare': return feedDeliveryReplayGuard.prepareDelivery(context, message.payload || message);
          case 'delivered': return feedDeliveryReplayGuard.recordDelivered(context, message.payload || message);
          case 'failed': return feedDeliveryReplayGuard.recordFailure(context, message.payload || message);
          case 'replayCandidates': return feedDeliveryReplayGuard.replayCandidates(context, message.payload || message);
          default: throw new Error(`Unknown TITAN_FEED_DELIVERY_REPLAY_GUARD action: ${message.action}`);
        }
      }).then(result => sendResponse({ ok: true, result, authority_granted: false, execution_permitted: false, automatic_effect_replay: false }))
        .catch(error => sendResponse({ ok: false, error: error.message, authority_granted: false, execution_permitted: false, automatic_effect_replay: false }));
      return true;
    }
    if (message?.type === 'TITAN_FEED_PRESENTATION_STATE') {
      ready.then(async () => {
        const context = message.context || { company_id: message.company_id, actor_id: message.actor_id, operation_id: message.operation_id, idempotency_key: message.idempotency_key };
        switch (message.action) {
          case 'read': return feedPresentationState.read(context, message.payload || message);
          case 'transition': return feedPresentationState.transition(context, message.payload || message);
          case 'list': return feedPresentationState.list(context, message.payload || message);
          case 'importLegacyReadIds': return feedPresentationState.importLegacyReadIds(context, message.payload || message);
          default: throw new Error(`Unknown TITAN_FEED_PRESENTATION_STATE action: ${message.action}`);
        }
      }).then(result => sendResponse({ ok: true, result }))
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message?.type !== 'TITAN_BUSINESS_STATE') return;
    ready.then(async () => {
      const context = message.context || { company_id: message.company_id, actor_id: message.actor_id, operation_id: message.operation_id, idempotency_key: message.idempotency_key };
      switch (message.action) {
        case 'commit': return businessStateAuthority.commit(context, message.domain, message.record, message.options || {});
        case 'read': return businessStateAuthority.read(context, message.domain, message.entity_id);
        case 'list': return businessStateAuthority.list(context, message.domain, message.options || {});
        case 'snapshot': return businessStateAuthority.snapshot(context);
        case 'clear': return businessStateAuthority.clear(context, message.domain, message.options || {});
        case 'reconcileLegacy': return businessHistoryReconciler.reconcile(context);
        case 'migrateLegacyStorage': return legacyStorageMigration.migrate(context, message.options || {});
        default: throw new Error(`Unknown TITAN_BUSINESS_STATE action: ${message.action}`);
      }
    }).then(result => sendResponse({ ok: result?.ok !== false, result }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
} catch (_) {}

export { database, legacyBridge, businessStateAuthority, businessHistoryReconciler, legacyStorageMigration, feedPresentationState, feedDeliveryReplayGuard, ready };
