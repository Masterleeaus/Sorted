// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/feed/feed-source-ownership.mjs
const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id']);

export const FEED_SOURCE_ROLES = Object.freeze({
  EVENT_LEDGER: 'event_ledger',
  WORKFORCE_NOTIFICATION: 'workforce_notification',
  DECISION_FEED: 'decision_feed',
  VISIBLE_FEED: 'visible_feed',
  INBOX: 'inbox'
});

export const FEED_OWNERSHIP_KINDS = Object.freeze({
  EVENT_RECORD: 'event_record',
  NOTIFICATION_LIFECYCLE: 'notification_lifecycle',
  DECISION_RANKING: 'decision_ranking',
  PRESENTATION_READ_STATE: 'presentation_read_state',
  EXTERNAL_MESSAGE_LIFECYCLE: 'external_message_lifecycle'
});

const REGISTRY = Object.freeze({
  [FEED_SOURCE_ROLES.EVENT_LEDGER]: Object.freeze({
    role: FEED_SOURCE_ROLES.EVENT_LEDGER,
    owns: Object.freeze([FEED_OWNERSHIP_KINDS.EVENT_RECORD]),
    projects: Object.freeze([]),
    may_execute: false,
    may_grant_authority: false,
    description: 'Canonical append-only event/evidence record. It does not own user notification delivery or feed presentation state.'
  }),
  [FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION]: Object.freeze({
    role: FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION,
    owns: Object.freeze([FEED_OWNERSHIP_KINDS.NOTIFICATION_LIFECYCLE]),
    projects: Object.freeze([FEED_OWNERSHIP_KINDS.PRESENTATION_READ_STATE]),
    may_execute: false,
    may_grant_authority: false,
    description: 'Owns notification acknowledgement, escalation, suppression and delivery-attempt state; feed cards are projections only.'
  }),
  [FEED_SOURCE_ROLES.DECISION_FEED]: Object.freeze({
    role: FEED_SOURCE_ROLES.DECISION_FEED,
    owns: Object.freeze([FEED_OWNERSHIP_KINDS.DECISION_RANKING]),
    projects: Object.freeze([FEED_OWNERSHIP_KINDS.PRESENTATION_READ_STATE]),
    may_execute: false,
    may_grant_authority: false,
    description: 'Owns deterministic decision ranking/reconciliation projection only; source domain lifecycle remains authoritative elsewhere.'
  }),
  [FEED_SOURCE_ROLES.VISIBLE_FEED]: Object.freeze({
    role: FEED_SOURCE_ROLES.VISIBLE_FEED,
    owns: Object.freeze([FEED_OWNERSHIP_KINDS.PRESENTATION_READ_STATE]),
    projects: Object.freeze([]),
    may_execute: false,
    may_grant_authority: false,
    description: 'Owns visible operational-feed presentation and local read state only. It is not a source-of-truth lifecycle store.'
  }),
  [FEED_SOURCE_ROLES.INBOX]: Object.freeze({
    role: FEED_SOURCE_ROLES.INBOX,
    owns: Object.freeze([FEED_OWNERSHIP_KINDS.EXTERNAL_MESSAGE_LIFECYCLE]),
    projects: Object.freeze([]),
    may_execute: false,
    may_grant_authority: false,
    description: 'Owns external human/customer message lifecycle, not internal operational activity.'
  })
});

function rejectLegacyTenantFields(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectLegacyTenantFields(item, `${path}[${index}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-tenant-authority-field:${path}.${key}`);
    rejectLegacyTenantFields(child, `${path}.${key}`);
  }
}

export function feedSourceOwnership(role) {
  const record = REGISTRY[String(role || '').trim()];
  if (!record) throw new Error('unknown-feed-source-role');
  return record;
}

export function listFeedSourceOwnership() {
  return Object.values(REGISTRY);
}

export function assertFeedOwnershipCoherence(records = listFeedSourceOwnership()) {
  const owners = new Map();
  for (const record of records) {
    rejectLegacyTenantFields(record);
    for (const kind of record.owns || []) {
      if (owners.has(kind)) throw new Error(`duplicate-feed-ownership:${kind}:${owners.get(kind)}:${record.role}`);
      owners.set(kind, record.role);
    }
    if (record.may_grant_authority !== false) throw new Error(`feed-source-may-grant-authority:${record.role}`);
  }
  const required = Object.values(FEED_OWNERSHIP_KINDS);
  const missing = required.filter(kind => !owners.has(kind));
  if (missing.length) throw new Error(`missing-feed-ownership:${missing.join(',')}`);
  return Object.freeze({ coherent: true, owners: Object.freeze(Object.fromEntries(owners)) });
}

export function buildFeedSourceInventory({ company_id, sources = [] } = {}) {
  const companyId = String(company_id || '').trim();
  if (!companyId) throw new Error('company_id-required');
  rejectLegacyTenantFields(sources);
  const observed = sources.map(source => {
    const role = String(source?.role || '').trim();
    const ownership = feedSourceOwnership(role);
    return Object.freeze({
      role,
      company_id: companyId,
      producer: String(source?.producer || '').trim() || role,
      event_types: Object.freeze([...(Array.isArray(source?.event_types) ? source.event_types : [])].map(String)),
      projection_targets: Object.freeze([...(Array.isArray(source?.projection_targets) ? source.projection_targets : [])].map(String)),
      ownership,
      source_of_truth: ownership.owns.length > 0,
      authority_effect: false
    });
  });
  return Object.freeze({
    schema: 'titan.feed.source-inventory.v1',
    company_id: companyId,
    sources: Object.freeze(observed),
    ownership: assertFeedOwnershipCoherence(),
    authority_granted: false,
    execution_permitted: false,
    grants_authority: false,
    authority_effect: false
  });
}
