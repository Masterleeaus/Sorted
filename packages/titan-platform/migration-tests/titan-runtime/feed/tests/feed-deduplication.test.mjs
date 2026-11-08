import assert from 'node:assert/strict';
import { buildFeedDeduplicationKey, collapseRepeatedFeedEntries } from '../feed-deduplication.mjs';

const base = {
  company_id:'company-a', kind:'job_event', operation_id:'op-1', correlation_id:'corr-1',
  title:'Cleaner arrived', body:'Job 42', severity:'NORMAL'
};

const exact = collapseRepeatedFeedEntries([
  {...base, entry_id:'e1', source_event_id:'evt-1', occurred_at:'2026-09-07T10:00:00Z'},
  {...base, entry_id:'e2', source_event_id:'evt-1', occurred_at:'2026-09-07T10:00:02Z'}
]);
assert.equal(exact.input_count, 2);
assert.equal(exact.output_count, 1);
assert.equal(exact.entries[0].deduplication.occurrence_count, 2);
assert.deepEqual(exact.entries[0].deduplication.source_event_ids, ['evt-1']);

const related = collapseRepeatedFeedEntries([
  {...base, entry_id:'e1', source_event_id:'evt-1', occurred_at:'2026-09-07T10:00:00Z'},
  {...base, entry_id:'e2', source_event_id:'evt-2', occurred_at:'2026-09-07T10:02:00Z', severity:'URGENT'}
]);
assert.equal(related.output_count, 1);
assert.equal(related.entries[0].deduplication.occurrence_count, 2);
assert.equal(related.entries[0].severity, 'URGENT');
assert.deepEqual(related.entries[0].deduplication.source_event_ids, ['evt-2','evt-1']);
assert.equal(related.preserved_occurrence_count, 2);

const outsideWindow = collapseRepeatedFeedEntries([
  {...base, source_event_id:'evt-1', occurred_at:'2026-09-07T10:00:00Z'},
  {...base, source_event_id:'evt-2', occurred_at:'2026-09-07T10:08:00Z'}
]);
assert.equal(outsideWindow.output_count, 2);

const differentKind = collapseRepeatedFeedEntries([
  {...base, source_event_id:'evt-1'},
  {...base, source_event_id:'evt-2', kind:'approval'}
]);
assert.equal(differentKind.output_count, 2);

const crossCompany = collapseRepeatedFeedEntries([
  {...base, source_event_id:'evt-1'},
  {...base, company_id:'company-b', source_event_id:'evt-2'}
]);
assert.equal(crossCompany.output_count, 2);

const inboxVsFeed = collapseRepeatedFeedEntries([
  {...base, source_event_id:'evt-1', presentation_surface:'feed'},
  {...base, source_event_id:'evt-2', presentation_surface:'inbox'}
]);
assert.equal(inboxVsFeed.output_count, 2);

assert.throws(() => buildFeedDeduplicationKey({...base, tenant_id:'legacy'}), /legacy-tenant-authority-field/);
assert.equal(buildFeedDeduplicationKey(base).deduplication_confers_authority, false);
assert.equal(related.deduplication_confers_authority, false);
console.log('feed-deduplication.test.mjs PASS');
