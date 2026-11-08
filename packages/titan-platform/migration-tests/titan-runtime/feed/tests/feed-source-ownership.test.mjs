import assert from 'node:assert/strict';
import {
  FEED_SOURCE_ROLES,
  FEED_OWNERSHIP_KINDS,
  feedSourceOwnership,
  listFeedSourceOwnership,
  assertFeedOwnershipCoherence,
  buildFeedSourceInventory
} from '../feed-source-ownership.mjs';
import { DECISION_FEED_SOURCE_OWNERSHIP, UNIFIED_DECISION_FEED_VERSION } from '../../../titan-intelligence/decision/unified-decision-feed.js';
import { WORKFORCE_NOTIFICATION_SOURCE_OWNERSHIP } from '../../../titan-workforce/notifications/workforce-notification-escalation-runtime.mjs';

const coherence = assertFeedOwnershipCoherence();
assert.equal(coherence.coherent, true);
assert.equal(coherence.owners[FEED_OWNERSHIP_KINDS.EVENT_RECORD], FEED_SOURCE_ROLES.EVENT_LEDGER);
assert.equal(coherence.owners[FEED_OWNERSHIP_KINDS.NOTIFICATION_LIFECYCLE], FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION);
assert.equal(coherence.owners[FEED_OWNERSHIP_KINDS.DECISION_RANKING], FEED_SOURCE_ROLES.DECISION_FEED);
assert.equal(coherence.owners[FEED_OWNERSHIP_KINDS.PRESENTATION_READ_STATE], FEED_SOURCE_ROLES.VISIBLE_FEED);
assert.equal(coherence.owners[FEED_OWNERSHIP_KINDS.EXTERNAL_MESSAGE_LIFECYCLE], FEED_SOURCE_ROLES.INBOX);

assert.equal(DECISION_FEED_SOURCE_OWNERSHIP.role, FEED_SOURCE_ROLES.DECISION_FEED);
assert.equal(WORKFORCE_NOTIFICATION_SOURCE_OWNERSHIP.role, FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION);
assert.equal(UNIFIED_DECISION_FEED_VERSION, '1.6.1');
assert.equal(listFeedSourceOwnership().length, 5);
assert.equal(feedSourceOwnership(FEED_SOURCE_ROLES.VISIBLE_FEED).may_grant_authority, false);

const inventory = buildFeedSourceInventory({
  company_id: 'company-a',
  sources: [
    { role: FEED_SOURCE_ROLES.EVENT_LEDGER, producer: 'TitanLocalEventLedger', event_types: ['outcome','anomaly'], projection_targets: ['feed'] },
    { role: FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION, producer: 'workforce-notification-escalation', event_types: ['notification'], projection_targets: ['feed'] },
    { role: FEED_SOURCE_ROLES.DECISION_FEED, producer: 'unified-decision-feed', event_types: ['decision'], projection_targets: ['feed'] },
    { role: FEED_SOURCE_ROLES.VISIBLE_FEED, producer: 'titan-shell', event_types: ['presentation'], projection_targets: ['owner'] },
    { role: FEED_SOURCE_ROLES.INBOX, producer: 'communications', event_types: ['external_message'], projection_targets: ['inbox'] }
  ]
});
assert.equal(inventory.company_id, 'company-a');
assert.equal(inventory.sources.length, 5);
assert.equal(inventory.grants_authority, false);
assert.throws(() => buildFeedSourceInventory({company_id:'company-a', sources:[{role:FEED_SOURCE_ROLES.EVENT_LEDGER, tenant_id:'legacy'}]}), /legacy-tenant-authority-field/);
assert.throws(() => assertFeedOwnershipCoherence([
  {role:'a', owns:[FEED_OWNERSHIP_KINDS.EVENT_RECORD], may_grant_authority:false},
  {role:'b', owns:[FEED_OWNERSHIP_KINDS.EVENT_RECORD], may_grant_authority:false}
]), /duplicate-feed-ownership/);

console.log('feed-source-ownership tests passed');
