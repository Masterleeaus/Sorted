import assert from 'node:assert/strict';
import {
  FEED_DESTINATIONS,
  INBOX_SOURCE_OWNERSHIP,
  classifyFeedInboxDestination,
  projectExternalMessageToInboxEntry,
  routeFeedInboxRecord,
  splitFeedInboxRecords
} from '../feed-inbox-routing.mjs';

const company_id = 'company-clean-001';

assert.equal(INBOX_SOURCE_OWNERSHIP.owns.includes('external_message_lifecycle'), true);
assert.equal(INBOX_SOURCE_OWNERSHIP.may_grant_authority, false);

const customer = routeFeedInboxRecord({
  company_id,
  event_type:'external_message',
  channel:'sms',
  sender_type:'customer',
  message_id:'msg-1',
  thread_id:'thread-1',
  navigation:{route:'/inbox/thread/thread-1', message_id:'msg-1'}
});
assert.equal(customer.destination, FEED_DESTINATIONS.INBOX);
assert.equal(customer.navigation.surface, 'inbox');
assert.equal(customer.navigation.route, '/inbox/thread/thread-1');
assert.equal(customer.navigation.message_id, 'msg-1');
assert.equal(customer.routing_confers_authority, false);

const operational = routeFeedInboxRecord({
  company_id,
  event_type:'job_event',
  source:'workforce-runtime',
  operation_id:'op-1',
  job_id:'job-1',
  navigation:{route:'/work/jobs/job-1', entity_type:'job', entity_id:'job-1'}
});
assert.equal(operational.destination, FEED_DESTINATIONS.FEED);
assert.equal(operational.navigation.surface, 'feed');
assert.equal(operational.navigation.route, '/work/jobs/job-1');
assert.equal(operational.navigation.entity_id, 'job-1');

const inboxEntry = projectExternalMessageToInboxEntry({
  company_id,
  event_type:'customer_message',
  channel:'email',
  message_id:'msg-2',
  thread_id:'thread-2',
  sender_name:'Casey Customer',
  subject:'Can I move my cleaning booking?',
  body:'Please move Friday to Monday.',
  navigation:{route:'/inbox/thread/thread-2'}
});
assert.equal(inboxEntry.presentation_surface, 'inbox');
assert.equal(inboxEntry.lifecycle_authority, 'inbox');
assert.equal(inboxEntry.navigation.thread_id, 'thread-2');
assert.equal(inboxEntry.authority_neutral, true);

const split = splitFeedInboxRecords([
  {company_id,event_type:'external_message',channel:'whatsapp',message_id:'m-3'},
  {company_id,event_type:'workforce_event',operation_id:'op-2'},
  {company_id,event_type:'execution_result',job_id:'job-2'}
]);
assert.equal(split.inbox.length, 1);
assert.equal(split.feed.length, 2);
assert.equal(split.total, 3);
assert.equal(split.preserved, true);

assert.throws(() => classifyFeedInboxDestination({company_id,event_type:'external_message',operation_id:'op-conflict'}), /routing-conflict/);
assert.throws(() => routeFeedInboxRecord({company_id,event_type:'external_message',url:'javascript:alert(1)'}), /unsafe-feed-inbox-deep-link/);
assert.throws(() => classifyFeedInboxDestination({company_id,tenant_id:'legacy',event_type:'external_message'}), /legacy-tenant-authority-field/);
assert.throws(() => classifyFeedInboxDestination({company_id:'a',payload:{company_id:'b'},event_type:'external_message'}), /company-mismatch/);

console.log('feed-inbox-routing tests passed');
