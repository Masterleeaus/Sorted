// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/scheduling/scheduling-approval-escalation-runtime.mjs
import { evaluateDecisionRight } from '../decision/decision-rights-runtime.js';

const SCHEMA = 'titan.workforce.scheduling-approval-escalation.v1';
const clean = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const list = (value) => Array.isArray(value) ? value : [];
const uniq = (values) => [...new Set(list(values).map((value) => clean(value)).filter(Boolean))].sort();

function rejectLegacyBoundary(value, label) {
  if (value && (Object.hasOwn(value, 'tenant_id') || Object.hasOwn(value, 'tenant_company_id'))) {
    throw new Error(`${label}-legacy-tenant-boundary-rejected`);
  }
}

function requireCompanyId(value) {
  const companyId = clean(value, 128);
  if (!/^[A-Za-z0-9._:-]{2,128}$/.test(companyId)) throw new Error('approval-escalation-company_id-required');
  return companyId;
}

function assertCompany(value, companyId, label) {
  rejectLegacyBoundary(value, label);
  if (value?.company_id && clean(value.company_id, 128) !== companyId) {
    throw new Error(`${label}-cross-company-rejected`);
  }
}

function selectSuggestion(result, companyId, missionTeamId) {
  if (!result || result.schema !== 'titan.workforce.cleaning-assignment-requirement-suggestions.v1') {
    throw new Error('approval-escalation-cleaning-suggestion-result-required');
  }
  assertCompany(result, companyId, 'cleaning-suggestion-result');
  const suggestions = list(result.suggestions);
  const selected = missionTeamId
    ? suggestions.find((item) => clean(item?.mission_team_id) === missionTeamId)
    : result.best_suggestion || suggestions[0];
  if (!selected) throw new Error('approval-escalation-selected-suggestion-required');
  return selected;
}

function normalizeReassignment(input, companyId) {
  const value = input.reassignment || {};
  assertCompany(value, companyId, 'reassignment');
  const requested = value.requested === true || clean(value.assignment_id) !== '';
  if (!requested) return { requested: false, assignment_id: null, from_worker_ids: [], to_worker_ids: [], reason_ref: null };
  const assignmentId = clean(value.assignment_id);
  const reasonRef = clean(value.reason_ref || value.evidence_ref);
  if (!assignmentId) throw new Error('approval-escalation-reassignment-assignment_id-required');
  if (!reasonRef) throw new Error('approval-escalation-reassignment-reason_ref-required');
  return {
    requested: true,
    assignment_id: assignmentId,
    from_worker_ids: uniq(value.from_worker_ids),
    to_worker_ids: uniq(value.to_worker_ids),
    reason_ref: reasonRef
  };
}

function riskReasons(suggestion, reassignment) {
  const reasons = [];
  if (reassignment.requested) reasons.push('REASSIGNMENT_REQUESTED');
  for (const blocker of list(suggestion.blockers)) reasons.push(`SCHEDULING_BLOCKER:${clean(blocker)}`);
  for (const reason of list(suggestion.review_reasons)) reasons.push(`SCHEDULING_REVIEW:${clean(reason)}`);
  if (clean(suggestion.state) !== 'READY_FOR_ASSIGNMENT_PROPOSAL_REVIEW') reasons.push(`SUGGESTION_STATE:${clean(suggestion.state) || 'UNKNOWN'}`);
  return uniq(reasons);
}

function evaluateRight(policy, right, input, graph, missionTeams, supervisorRecords) {
  return evaluateDecisionRight(policy, {
    company_id: input.company_id,
    worker_id: input.actor_worker_id,
    decision_class: input.decision_class,
    right,
    scope_ref: input.scope_ref || null
  }, graph, missionTeams, supervisorRecords);
}

export function evaluateSchedulingApprovalEscalation(input = {}) {
  rejectLegacyBoundary(input, 'input');
  const companyId = requireCompanyId(input.company_id);
  const actorWorkerId = clean(input.actor_worker_id);
  if (!actorWorkerId) throw new Error('approval-escalation-actor_worker_id-required');
  const missionTeamId = clean(input.mission_team_id);
  const suggestion = selectSuggestion(input.cleaning_suggestions, companyId, missionTeamId);
  const reassignment = normalizeReassignment(input, companyId);

  assertCompany(input.decision_policy, companyId, 'decision-policy');
  assertCompany(input.workforce_graph, companyId, 'workforce-graph');
  for (const team of list(input.mission_teams)) assertCompany(team, companyId, 'mission-team');
  for (const record of list(input.supervisor_records)) assertCompany(record, companyId, 'supervisor-record');

  const decisionClass = clean(input.decision_class, 120) || (reassignment.requested ? 'workforce_reassignment' : 'workforce_assignment');
  const scopeRef = clean(input.scope_ref) || (reassignment.assignment_id ? `assignment:${reassignment.assignment_id}` : (clean(suggestion.mission_team_id) ? `mission_team:${clean(suggestion.mission_team_id)}` : null));
  const evalInput = { company_id: companyId, actor_worker_id: actorWorkerId, decision_class: decisionClass, scope_ref: scopeRef };
  const approval = evaluateRight(input.decision_policy, 'APPROVE', evalInput, input.workforce_graph, input.mission_teams, input.supervisor_records);
  const escalation = evaluateRight(input.decision_policy, 'ESCALATE', evalInput, input.workforce_graph, input.mission_teams, input.supervisor_records);

  const risks = riskReasons(suggestion, reassignment);
  const schedulingBlocked = list(suggestion.blockers).length > 0 || clean(suggestion.state) === 'BLOCKED';
  const approvalSensitive = reassignment.requested || risks.length > 0;

  let state = 'STANDARD_ASSIGNMENT_REVIEW';
  if (schedulingBlocked) state = 'BLOCKED_BY_SCHEDULING_EVIDENCE';
  else if (approvalSensitive && approval.decision_right_permitted) state = 'APPROVAL_RIGHT_CONFIRMED_FOR_REVIEW';
  else if (approvalSensitive && escalation.decision_right_permitted) state = 'ESCALATION_REQUIRED';
  else if (approvalSensitive) state = 'BLOCKED_NO_APPROVAL_OR_ESCALATION_RIGHT';

  const escalationDraft = state === 'ESCALATION_REQUIRED' ? {
    schema: 'titan.workforce.scheduling-escalation-draft.v1',
    company_id: companyId,
    escalation_id: clean(input.escalation_id) || `scheduling-escalation:${reassignment.assignment_id || clean(suggestion.mission_team_id) || 'proposal'}`,
    target_ref: scopeRef,
    severity: reassignment.requested ? 'high' : 'review',
    reason_codes: risks,
    requested_by_worker_id: actorWorkerId,
    coordination_only: true,
    grants_authority: false
  } : null;

  return {
    schema: SCHEMA,
    company_id: companyId,
    actor_worker_id: actorWorkerId,
    mission_team_id: clean(suggestion.mission_team_id) || null,
    decision_class: decisionClass,
    scope_ref: scopeRef,
    reassignment,
    risk_reasons: risks,
    scheduling_blocked: schedulingBlocked,
    approval_sensitive: approvalSensitive,
    approval_evaluation: approval,
    escalation_evaluation: escalation,
    escalation_draft: escalationDraft,
    state,
    proposal_only: true,
    requires_external_assignment_decision: true,
    approval_right_is_not_execution_authority: true,
    supervisor_identity_confers_authority: false,
    manager_identity_confers_authority: false,
    automatic_assignment: false,
    automatic_reassignment: false,
    execution_permitted: false,
    grants_authority: false
  };
}

export { SCHEMA as SCHEDULING_APPROVAL_ESCALATION_SCHEMA };
