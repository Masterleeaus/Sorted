import assert from 'node:assert/strict';
import { normalizeFeedSeverity, feedSeverityProfile, workforceUrgencyForSeverity } from '../feed-severity.mjs';
import { decisionFeedSortMetadata } from '../../../titan-intelligence/decision/unified-decision-feed.js';
import { buildWorkforceNotificationEscalation } from '../../../titan-workforce/notifications/workforce-notification-escalation-runtime.mjs';

assert.equal(normalizeFeedSeverity('low'), 'INFO');
assert.equal(normalizeFeedSeverity('medium'), 'IMPORTANT');
assert.equal(normalizeFeedSeverity('high'), 'URGENT');
assert.equal(normalizeFeedSeverity('immediate'), 'CRITICAL');
assert.deepEqual([feedSeverityProfile('info').rank, feedSeverityProfile('normal').rank, feedSeverityProfile('important').rank, feedSeverityProfile('urgent').rank, feedSeverityProfile('critical').rank], [1,2,3,4,5]);
assert.equal(workforceUrgencyForSeverity('IMPORTANT'), 'HIGH');
assert.equal(workforceUrgencyForSeverity('URGENT'), 'HIGH');

const packet = { risk:'high', urgency:'medium', significance:{level:'critical'}, generated_at:'2026-09-06T00:00:00Z', domain:'operations', packet_id:'p1' };
const sort = decisionFeedSortMetadata(packet);
assert.equal(sort.risk_severity, 'URGENT');
assert.equal(sort.risk_rank, 4);
assert.equal(sort.urgency_severity, 'IMPORTANT');
assert.equal(sort.urgency_rank, 3);
assert.equal(sort.significance_severity, 'CRITICAL');
assert.equal(sort.significance_rank, 5);

const snapshot = buildWorkforceNotificationEscalation({ company_id:'company-a', notifications:[{ notification_id:'n1', recipient_refs:['owner'], severity:'URGENT' }] });
assert.equal(snapshot.notifications[0].urgency, 'HIGH');
assert.equal(snapshot.notifications[0].severity.severity, 'URGENT');
assert.equal(snapshot.notifications[0].severity.presentation, 'red');
assert.equal(snapshot.severity_contract, 'titan.feed.severity.v1');
assert.throws(() => normalizeFeedSeverity({severity:'HIGH', tenant_id:'bad'}), /legacy-tenant-authority-field/);
console.log('feed-severity.test.mjs PASS');
