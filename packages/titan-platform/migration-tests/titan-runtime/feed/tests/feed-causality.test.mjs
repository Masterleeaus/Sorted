import assert from 'node:assert/strict';
import { buildFeedCausality, attachFeedCausality, projectOperationalEventToFeedEntry } from '../feed-causality.mjs';

const event = {
  event_id:'evt-2', event_type:'job.clean.complete', company_id:'co-1', operation_id:'op-2',
  correlation_id:'corr-1', causation_id:'evt-1', occurred_at:'2026-09-07T00:00:00Z', source:'job-runtime',
  payload:{job_id:'job-77', work_order_id:'wo-11'}
};
const operation = {
  company_id:'co-1', operation_id:'op-2', root_operation_id:'op-root', parent_operation_id:'op-1',
  correlation_id:'corr-1', request_id:'req-1', trace_id:'trace-1', mission_id:'mission-1'
};

const causality = buildFeedCausality({company_id:'co-1', event, operation});
assert.equal(causality.schema, 'titan.feed.causality.v1');
assert.equal(causality.causation_id, 'evt-1');
assert.equal(causality.root_operation_id, 'op-root');
assert.equal(causality.entity_refs.job_id, 'job-77');
assert.equal(causality.entity_refs.work_order_id, 'wo-11');
assert.deepEqual(causality.chain.map(x => x.ref), ['op-root','op-1','op-2','evt-1','evt-2']);
assert.equal(causality.causality_confers_authority, false);

const entry = projectOperationalEventToFeedEntry(event, {title:'Clean completed', severity:'IMPORTANT'});
assert.equal(entry.entry_id, 'event:evt-2');
assert.equal(entry.source_event_id, 'evt-2');
assert.equal(entry.operation_id, 'op-2');
assert.equal(entry.correlation_id, 'corr-1');
assert.equal(entry.causality.entity_refs.job_id, 'job-77');
assert.equal(entry.event_lifecycle_authority, 'event_ledger');
assert.equal(entry.projection_only, true);

const attached = attachFeedCausality({company_id:'co-1', entry_id:'feed-1'}, {company_id:'co-1', operation});
assert.equal(attached.causality.root_operation_id, 'op-root');
assert.equal(attached.authority_neutral, true);

assert.throws(() => buildFeedCausality({company_id:'co-1', tenant_id:'legacy'}), /legacy-tenant-authority-field/);
assert.throws(() => buildFeedCausality({company_id:'co-1', event:{company_id:'co-2'}}), /feed-causality-conflict:company_id/);
assert.throws(() => buildFeedCausality({company_id:'co-1', event:{company_id:'co-1', operation_id:'op-a'}, operation:{company_id:'co-1', operation_id:'op-b'}}), /feed-causality-conflict:operation_id/);

console.log('feed-causality tests passed');
