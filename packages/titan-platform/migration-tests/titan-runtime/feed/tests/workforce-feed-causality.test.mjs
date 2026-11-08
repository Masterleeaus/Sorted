import assert from 'node:assert/strict';
import {
  buildWorkforceNotificationEscalation,
  transitionWorkforceNotification,
  summarizeWorkforceNotificationEscalation
} from '../../../titan-workforce/notifications/workforce-notification-escalation-runtime.mjs';

const snapshot = buildWorkforceNotificationEscalation({
  company_id:'co-clean',
  now:1000,
  notifications:[{
    notification_id:'n-job-1',
    topic:'JOB_BLOCKED',
    urgency:'HIGH',
    recipient_refs:['manager-1'],
    source_ref:'job:77',
    event_id:'evt-job-blocked',
    causation_id:'evt-job-started',
    operation_id:'op-job-77',
    root_operation_id:'op-booking-55',
    correlation_id:'journey-55',
    job_id:'job-77',
    work_order_id:'wo-77'
  }]
});

assert.equal(snapshot.causality_contract, 'titan.feed.causality.v1');
assert.equal(snapshot.notifications[0].causality.event_id, 'evt-job-blocked');
assert.equal(snapshot.notifications[0].causality.causation_id, 'evt-job-started');
assert.equal(snapshot.notifications[0].causality.root_operation_id, 'op-booking-55');
assert.equal(snapshot.notifications[0].causality.entity_refs.job_id, 'job-77');
assert.equal(snapshot.notifications[0].operation_id, 'op-job-77');
assert.equal(snapshot.notifications[0].source_event_id, 'evt-job-blocked');
assert.equal(snapshot.notifications[0].recipient_assignment_does_not_grant_authority, true);

const acknowledged = transitionWorkforceNotification(snapshot, {
  company_id:'co-clean', notification_id:'n-job-1', action:'ACKNOWLEDGE', actor_ref:'manager-1', now:2000
});
assert.equal(acknowledged.notifications[0].causality.event_id, 'evt-job-blocked');
assert.equal(acknowledged.notifications[0].state, 'ACKNOWLEDGED');
assert.equal(acknowledged.notifications[0].causality.causality_confers_authority, false);

const summary = summarizeWorkforceNotificationEscalation(acknowledged);
assert.equal(summary.causality_contract, 'titan.feed.causality.v1');

assert.throws(() => buildWorkforceNotificationEscalation({
  company_id:'co-clean',
  notifications:[{notification_id:'n-bad',recipient_refs:['m'],event_id:'e',company_id:'co-other'}]
}), /notification-cross-company-item|feed-causality-conflict/);

console.log('workforce-feed-causality tests passed');
