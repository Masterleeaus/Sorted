// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/feed/feed-inbox-routing.mjs
import { FEED_SOURCE_ROLES, feedSourceOwnership } from './feed-source-ownership.js';
import { attachFeedCausality } from './feed-causality.js';

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id']);
const EXTERNAL_CHANNELS = new Set(['email','sms','whatsapp','messenger','instagram','telegram','webchat','chat','phone','voicemail','customer_portal']);
const EXTERNAL_ACTORS = new Set(['customer','client','lead','prospect','contact','external','vendor','supplier','partner']);
const OPERATIONAL_ACTORS = new Set(['worker','employee','staff','agent','workforce','supervisor','manager','system','runtime']);
const OPERATIONAL_TYPES = new Set(['operation','operational_event','job_event','work_order_event','workforce_event','decision','approval','execution_result','anomaly','recovery','outcome','evidence','authority','signal','system']);
const EXTERNAL_TYPES = new Set(['external_message','customer_message','client_message','lead_message','conversation_message','inbound_message','outbound_message']);

export const FEED_DESTINATIONS = Object.freeze({
  FEED: 'feed',
  INBOX: 'inbox'
});

export const FEED_INBOX_ROUTING_SCHEMA = 'titan.feed.inbox-routing.v1';
export const INBOX_SOURCE_OWNERSHIP = feedSourceOwnership(FEED_SOURCE_ROLES.INBOX);

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

const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();
const first = (...values) => values.find(value => text(value)) ?? null;

function companyIdOf(record) {
  const ids = [record?.company_id, record?.payload?.company_id, record?.metadata?.company_id]
    .map(text).filter(Boolean);
  if (!ids.length) throw new Error('company_id_required');
  if (new Set(ids).size > 1) throw new Error('feed-inbox-company-mismatch');
  return ids[0];
}

function signalSet(record) {
  const eventType = lower(first(record.event_type, record.type, record.kind, record.message_type, record.payload?.event_type));
  const channel = lower(first(record.channel, record.payload?.channel, record.metadata?.channel));
  const actor = lower(first(record.actor_type, record.sender_type, record.participant_type, record.payload?.actor_type, record.metadata?.actor_type));
  const source = lower(first(record.source, record.producer, record.origin, record.payload?.source));
  const hasOperationRefs = Boolean(first(
    record.operation_id, record.job_id, record.work_order_id, record.mission_id,
    record.payload?.operation_id, record.payload?.job_id, record.payload?.work_order_id
  ));
  const hasMessageRefs = Boolean(first(
    record.message_id, record.thread_id, record.conversation_id,
    record.payload?.message_id, record.payload?.thread_id, record.payload?.conversation_id
  ));
  const explicitExternal = record.external === true || record.is_external === true || record.customer_facing === true;
  const explicitOperational = record.operational === true || record.is_operational === true;

  const external = explicitExternal || EXTERNAL_TYPES.has(eventType) || EXTERNAL_CHANNELS.has(channel) || EXTERNAL_ACTORS.has(actor) || (hasMessageRefs && !hasOperationRefs);
  const operational = explicitOperational || OPERATIONAL_TYPES.has(eventType) || OPERATIONAL_ACTORS.has(actor) || hasOperationRefs || source.includes('workforce') || source.includes('operation');

  return Object.freeze({ event_type:eventType || null, channel:channel || null, actor_type:actor || null, source:source || null, has_operation_refs:hasOperationRefs, has_message_refs:hasMessageRefs, external, operational });
}

export function classifyFeedInboxDestination(record = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('feed-inbox-record-required');
  rejectLegacyTenantFields(record);
  const company_id = companyIdOf(record);
  const signals = signalSet(record);
  if (signals.external && signals.operational) throw new Error('feed-inbox-routing-conflict');

  const destination = signals.external ? FEED_DESTINATIONS.INBOX : FEED_DESTINATIONS.FEED;
  return Object.freeze({
    schema: FEED_INBOX_ROUTING_SCHEMA,
    company_id,
    destination,
    source_role: destination === FEED_DESTINATIONS.INBOX ? FEED_SOURCE_ROLES.INBOX : FEED_SOURCE_ROLES.VISIBLE_FEED,
    signals,
    authority_neutral: true,
    identity_confers_authority: false,
    routing_confers_authority: false
  });
}

function normalizeNavigation(record, destination) {
  const nav = record?.navigation && typeof record.navigation === 'object' ? record.navigation : {};
  const deep = record?.deep_link && typeof record.deep_link === 'object' ? record.deep_link : {};
  const route = text(first(nav.route, deep.route, record.route));
  const view = text(first(nav.view, deep.view, record.view));
  const url = text(first(nav.url, deep.url, record.url));
  const thread_id = text(first(nav.thread_id, deep.thread_id, record.thread_id, record.payload?.thread_id));
  const message_id = text(first(nav.message_id, deep.message_id, record.message_id, record.payload?.message_id));
  const conversation_id = text(first(nav.conversation_id, deep.conversation_id, record.conversation_id, record.payload?.conversation_id));
  const entity_type = text(first(nav.entity_type, deep.entity_type, record.entity_type));
  const entity_id = text(first(nav.entity_id, deep.entity_id, record.entity_id));

  if (url && !/^(https?:\/\/|chrome-extension:\/\/|\/|#)/i.test(url)) throw new Error('unsafe-feed-inbox-deep-link');

  return Object.freeze({
    surface: destination,
    route: route || null,
    view: view || (destination === FEED_DESTINATIONS.INBOX ? 'inbox' : 'feed'),
    url: url || null,
    thread_id: thread_id || null,
    message_id: message_id || null,
    conversation_id: conversation_id || null,
    entity_type: entity_type || null,
    entity_id: entity_id || null
  });
}

export function routeFeedInboxRecord(record = {}) {
  const classification = classifyFeedInboxDestination(record);
  const navigation = normalizeNavigation(record, classification.destination);
  return Object.freeze({ ...classification, navigation });
}

export function projectExternalMessageToInboxEntry(message = {}, presentation = {}) {
  rejectLegacyTenantFields(message);
  rejectLegacyTenantFields(presentation);
  const routed = routeFeedInboxRecord({ ...message, external: true });
  if (routed.destination !== FEED_DESTINATIONS.INBOX) throw new Error('external-message-not-routed-to-inbox');

  const message_id = text(first(message.message_id, message.id, message.payload?.message_id));
  const thread_id = text(first(message.thread_id, message.conversation_id, message.payload?.thread_id));
  const entry = {
    entry_id: text(presentation.entry_id) || (message_id ? `message:${message_id}` : thread_id ? `thread:${thread_id}` : `message:${Date.now()}`),
    company_id: routed.company_id,
    kind: text(presentation.kind) || 'external_message',
    title: text(presentation.title) || text(message.subject) || text(message.sender_name) || 'External message',
    body: text(presentation.body) || text(message.body) || text(message.text),
    occurred_at: text(first(message.occurred_at, message.received_at, message.sent_at, message.created_at)) || null,
    source: text(first(message.source, message.channel)) || null,
    message_id: message_id || null,
    thread_id: thread_id || null,
    projection_only: true,
    lifecycle_authority: 'inbox',
    presentation_surface: 'inbox',
    navigation: routed.navigation,
    authority_neutral: true,
    routing_confers_authority: false
  };
  return attachFeedCausality(entry, { company_id:routed.company_id, feed:entry });
}

export function splitFeedInboxRecords(records = []) {
  if (!Array.isArray(records)) throw new Error('feed-inbox-records-array-required');
  const feed = [];
  const inbox = [];
  for (const record of records) {
    const routed = routeFeedInboxRecord(record);
    (routed.destination === FEED_DESTINATIONS.INBOX ? inbox : feed).push(Object.freeze({ record, routing:routed }));
  }
  return Object.freeze({
    schema: FEED_INBOX_ROUTING_SCHEMA,
    feed: Object.freeze(feed),
    inbox: Object.freeze(inbox),
    total: records.length,
    preserved: feed.length + inbox.length === records.length,
    authority_neutral: true
  });
}
