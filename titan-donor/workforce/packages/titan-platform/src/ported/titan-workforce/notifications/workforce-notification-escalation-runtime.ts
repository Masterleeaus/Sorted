// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/notifications/workforce-notification-escalation-runtime.mjs
import { FEED_SOURCE_ROLES, feedSourceOwnership } from '../../titan-runtime/feed/feed-source-ownership.js';
import { buildFeedSeverityEnvelope, workforceUrgencyForSeverity } from '../../titan-runtime/feed/feed-severity.js';
import { buildFeedCausality } from '../../titan-runtime/feed/feed-causality.js';
import {
  buildWorkforceNotificationEscalation as buildLegacyWorkforceNotificationEscalation,
  transitionWorkforceNotification as transitionLegacyWorkforceNotification,
  evaluateWorkforceEscalationDue as evaluateLegacyWorkforceEscalationDue,
  summarizeWorkforceNotificationEscalation as summarizeLegacyWorkforceNotificationEscalation
} from '../handover/investigation-installation-handover.js';

export const WORKFORCE_NOTIFICATION_SOURCE_OWNERSHIP = feedSourceOwnership(FEED_SOURCE_ROLES.WORKFORCE_NOTIFICATION);

function adaptInput(input = {}) {
  const source = input.notifications || input.escalations;
  if (!Array.isArray(source)) return input;
  const notifications = source.map(item => ({
    ...item,
    urgency: workforceUrgencyForSeverity(item?.severity ?? item?.urgency ?? item?.priority ?? 'NORMAL')
  }));
  return { ...input, notifications, escalations: undefined };
}

function causalSourceMap(input = {}) {
  const source = Array.isArray(input.notifications) ? input.notifications : (Array.isArray(input.escalations) ? input.escalations : []);
  const map = new Map();
  source.forEach((item, index) => {
    const id = String(item?.notification_id ?? item?.id ?? `notification-${index + 1}`).trim();
    if (id) map.set(id, item || {});
  });
  return map;
}

function enrichNotification(notification, causalSource = null) {
  const severity = buildFeedSeverityEnvelope(notification?.severity ?? notification?.urgency);
  let causality = notification?.causality || null;
  const causalCandidate = causalSource || notification;
  const hasCausalSignal = ['event_id','causation_id','operation_id','root_operation_id','parent_operation_id','request_id','correlation_id','trace_id','job_id','work_order_id','booking_id']
    .some(key => causalCandidate?.[key] != null || causalCandidate?.payload?.[key] != null);
  if (!causality && hasCausalSignal) {
    causality = buildFeedCausality({ company_id: notification.company_id, ...causalCandidate });
  }
  return { ...notification, severity, ...(causality ? { causality, operation_id: causality.operation_id || undefined, correlation_id: causality.correlation_id || undefined, source_event_id: causality.event_id || undefined } : {}) };
}

function enrichSnapshot(snapshot = {}, causalMap = null) {
  return {
    ...snapshot,
    severity_contract: 'titan.feed.severity.v1',
    causality_contract: 'titan.feed.causality.v1',
    notifications: Array.isArray(snapshot.notifications) ? snapshot.notifications.map(item => enrichNotification(item, causalMap?.get(item.notification_id) || null)) : []
  };
}

export function buildWorkforceNotificationEscalation(input = {}) {
  const map = causalSourceMap(input);
  return enrichSnapshot(buildLegacyWorkforceNotificationEscalation(adaptInput(input)), map);
}

export function transitionWorkforceNotification(snapshot = {}, input = {}) {
  return enrichSnapshot(transitionLegacyWorkforceNotification(snapshot, input));
}

export function evaluateWorkforceEscalationDue(snapshot = {}, input = {}) {
  const result = evaluateLegacyWorkforceEscalationDue(snapshot, input);
  return {
    ...result,
    severity_contract: 'titan.feed.severity.v1',
    due: Array.isArray(result.due) ? result.due.map(item => ({ ...item, severity: buildFeedSeverityEnvelope(item.urgency) })) : []
  };
}

export function summarizeWorkforceNotificationEscalation(snapshot = {}) {
  return { ...summarizeLegacyWorkforceNotificationEscalation(snapshot), severity_contract: 'titan.feed.severity.v1', causality_contract: 'titan.feed.causality.v1' };
}
