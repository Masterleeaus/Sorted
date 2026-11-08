// @ts-nocheck
// Ported from Titan Zero extension (ui-or-browser-adaptation): titan-runtime/feed/feed-deduplication.mjs
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { feedSeverityProfile } from './feed-severity.js';

const LEGACY_TENANT_KEYS = new Set(['tenant_id', 'tenant_company_id', 'tenantId', 'tenantCompanyId']);
export const FEED_DEDUPLICATION_SCHEMA = 'titan.feed.deduplication.v1';
export const DEFAULT_COLLAPSE_WINDOW_MS = 5 * 60 * 1000;

function rejectLegacyTenantFields(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((item, index) => rejectLegacyTenantFields(item, `${path}[${index}]`));
  for (const [key, child] of Object.entries(value)) {
    if (LEGACY_TENANT_KEYS.has(key)) throw new Error(`legacy-tenant-authority-field:${path}.${key}`);
    rejectLegacyTenantFields(child, `${path}.${key}`);
  }
}

const text = value => String(value ?? '').trim();
const lower = value => text(value).toLowerCase();
const first = (...values) => values.find(value => text(value)) ?? null;

function timestampOf(entry) {
  const raw = first(entry.occurred_at, entry.created_at, entry.updated_at, entry.received_at, entry.sent_at, entry.timestamp);
  if (!raw) return null;
  const value = Date.parse(String(raw));
  return Number.isFinite(value) ? value : null;
}

function companyIdOf(entry) {
  const ids = [entry?.company_id, entry?.causality?.company_id, entry?.routing?.company_id]
    .map(text).filter(Boolean);
  if (!ids.length) throw new Error('company_id_required');
  if (new Set(ids).size > 1) throw new Error('feed-deduplication-company-mismatch');
  return ids[0];
}

function surfaceOf(entry) {
  return lower(first(entry.presentation_surface, entry.surface, entry.routing?.destination, entry.navigation?.surface, 'feed')) || 'feed';
}

function semanticKind(entry) {
  return lower(first(entry.kind, entry.event_type, entry.type, entry.message_type, entry.category, 'activity')) || 'activity';
}

function causalGroup(entry) {
  return text(first(
    entry.causality?.correlation_id,
    entry.correlation_id,
    entry.causality?.operation_id,
    entry.operation_id,
    entry.causality?.root_operation_id,
    entry.root_operation_id,
    entry.causality?.entity_refs?.job_id,
    entry.job_id,
    entry.causality?.entity_refs?.work_order_id,
    entry.work_order_id,
    entry.thread_id,
    entry.conversation_id,
    entry.navigation?.thread_id,
    entry.navigation?.conversation_id
  ));
}

function exactIdentity(entry) {
  const id = text(first(
    entry.source_event_id,
    entry.event_id,
    entry.notification_id,
    entry.message_id,
    entry.receipt_id,
    entry.entry_id,
    entry.id
  ));
  return id || null;
}

function normalizedContent(entry) {
  return [lower(entry.title), lower(entry.body), lower(entry.summary), lower(entry.status)].join('|');
}

export function buildFeedDeduplicationKey(entry = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('feed-deduplication-entry-required');
  rejectLegacyTenantFields(entry);
  const company_id = companyIdOf(entry);
  const surface = surfaceOf(entry);
  const kind = semanticKind(entry);
  const identity = exactIdentity(entry);
  const group = causalGroup(entry);
  const content = normalizedContent(entry);

  return Object.freeze({
    schema: FEED_DEDUPLICATION_SCHEMA,
    company_id,
    surface,
    kind,
    exact_key: identity ? `${company_id}|${surface}|${kind}|id:${identity}` : null,
    related_key: group ? `${company_id}|${surface}|${kind}|group:${group}|content:${content}` : null,
    causal_group: group || null,
    authority_neutral: true,
    deduplication_confers_authority: false
  });
}

function sameWindow(a, b, collapseWindowMs) {
  const ta = timestampOf(a);
  const tb = timestampOf(b);
  if (ta == null || tb == null) return true;
  return Math.abs(ta - tb) <= collapseWindowMs;
}

function mergeSeverity(entries) {
  return entries.reduce((best, entry) => {
    const candidate = feedSeverityProfile(entry?.severity?.severity ?? entry?.severity ?? entry?.urgency ?? entry?.priority);
    return !best || candidate.rank > best.rank ? candidate : best;
  }, null);
}

function freezeRefs(values) {
  return Object.freeze([...new Set(values.map(text).filter(Boolean))]);
}

function collapseGroup(entries, key) {
  const sorted = [...entries].sort((a, b) => {
    const ta = timestampOf(a); const tb = timestampOf(b);
    if (ta != null && tb != null && ta !== tb) return tb - ta;
    return text(b.entry_id || b.id).localeCompare(text(a.entry_id || a.id));
  });
  const representative = sorted[0];
  const severity = mergeSeverity(sorted);
  const source_event_ids = freezeRefs(sorted.flatMap(item => [item.source_event_id, item.event_id, item.causality?.event_id]));
  const notification_ids = freezeRefs(sorted.map(item => item.notification_id));
  const message_ids = freezeRefs(sorted.map(item => item.message_id));
  const entry_ids = freezeRefs(sorted.flatMap(item => [item.entry_id, item.id]));
  return Object.freeze({
    ...representative,
    ...(severity ? { severity: representative?.severity && typeof representative.severity === 'object' ? { ...representative.severity, severity:severity.severity, rank:severity.rank } : severity.severity } : {}),
    deduplication: Object.freeze({
      schema: FEED_DEDUPLICATION_SCHEMA,
      key,
      collapsed: sorted.length > 1,
      occurrence_count: sorted.length,
      source_event_ids,
      notification_ids,
      message_ids,
      entry_ids,
      first_occurred_at: sorted.map(item => timestampOf(item)).filter(v => v != null).sort((a,b)=>a-b)[0] ?? null,
      last_occurred_at: sorted.map(item => timestampOf(item)).filter(v => v != null).sort((a,b)=>b-a)[0] ?? null,
      authority_neutral: true,
      deduplication_confers_authority: false
    })
  });
}

export function collapseRepeatedFeedEntries(entries = [], { collapseWindowMs = DEFAULT_COLLAPSE_WINDOW_MS } = {}) {
  if (!Array.isArray(entries)) throw new Error('feed-deduplication-entries-array-required');
  if (!Number.isFinite(collapseWindowMs) || collapseWindowMs < 0) throw new Error('feed-deduplication-window-invalid');
  const buckets = [];
  const exactSeen = new Map();

  entries.forEach((entry, index) => {
    const key = buildFeedDeduplicationKey(entry);
    if (key.exact_key && exactSeen.has(key.exact_key)) {
      buckets[exactSeen.get(key.exact_key)].entries.push(entry);
      return;
    }

    let bucketIndex = -1;
    if (key.related_key) {
      bucketIndex = buckets.findIndex(bucket => bucket.related_key === key.related_key && sameWindow(bucket.entries[0], entry, collapseWindowMs));
    }
    if (bucketIndex < 0) {
      bucketIndex = buckets.length;
      buckets.push({ related_key:key.related_key, exact_key:key.exact_key, entries:[entry], first_index:index });
    } else {
      buckets[bucketIndex].entries.push(entry);
    }
    if (key.exact_key) exactSeen.set(key.exact_key, bucketIndex);
  });

  const collapsed = buckets
    .sort((a,b) => a.first_index - b.first_index)
    .map(bucket => collapseGroup(bucket.entries, bucket.exact_key || bucket.related_key || `unique:${bucket.first_index}`));

  return Object.freeze({
    schema: FEED_DEDUPLICATION_SCHEMA,
    entries: Object.freeze(collapsed),
    input_count: entries.length,
    output_count: collapsed.length,
    collapsed_count: entries.length - collapsed.length,
    preserved_occurrence_count: collapsed.reduce((sum, item) => sum + (item.deduplication?.occurrence_count || 1), 0),
    authority_neutral: true,
    deduplication_confers_authority: false
  });
}
