export const GO_FIELD_RUNTIME_VERSION = "1.0";

const stages = Object.freeze(["ready", "travel", "arrived", "work", "complete"]);
const transitionStage = Object.freeze({ travel: "travel", arrive: "arrived", start: "work", complete: "complete" });
const requiredStage = Object.freeze({ travel: "ready", arrive: "travel", start: "arrived", complete: "work" });

function required(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`);
  return value.trim();
}

function rejectLegacy(input) {
  if (input && typeof input === "object" && ("tenant_company_id" in input || "tenant_id" in input)) {
    throw new TypeError("tenant_company_id-not-authoritative");
  }
}

function operationId(prefix, session, now) {
  const stamp = String(Date.parse(now) || now).replace(/[^a-z0-9]/gi, "");
  return `${prefix}-${session.job_id}-${stamp}`;
}

function blocker(code, message, recovery) {
  return Object.freeze({ code, message, recovery });
}

export function createGoFieldSession(input) {
  rejectLegacy(input);
  const stage = input.stage ?? "ready";
  if (!stages.includes(stage)) throw new TypeError("go-stage-invalid");
  return Object.freeze({
    schema_version: GO_FIELD_RUNTIME_VERSION,
    company_id: required(input.company_id, "company_id"),
    actor_id: required(input.actor_id, "actor_id"),
    device_id: required(input.device_id, "device_id"),
    job_id: required(input.job_id, "job_id"),
    projection_revision: required(input.projection_revision, "projection_revision"),
    stage,
    route_ready: input.route_ready === true,
    equipment_ready: input.equipment_ready === true,
    access_status: input.access_status ?? "pending",
    checklist: Object.freeze([...(input.checklist ?? [false, false, false])]),
    evidence_count: Number.isInteger(input.evidence_count) ? input.evidence_count : 0,
    required_evidence_count: Number.isInteger(input.required_evidence_count) ? input.required_evidence_count : 2,
    last_receipt_id: input.last_receipt_id ?? null,
    authority_neutral: true,
  });
}

function transitionBlockers(session, action) {
  const blockers = [];
  if (!(action in transitionStage)) return [blocker("operation_not_supported", "This visit action is not supported.", "Open the current job or message dispatch.")];
  if (session.stage !== requiredStage[action]) blockers.push(blocker("stage_out_of_order", `The job is currently ${session.stage}.`, `Complete ${requiredStage[action]} before ${action}.`));
  if (action === "travel") {
    if (!session.route_ready) blockers.push(blocker("route_not_ready", "The route is not ready.", "Refresh the route or message dispatch."));
    if (!session.equipment_ready) blockers.push(blocker("equipment_not_ready", "Required equipment is not confirmed.", "Confirm the vehicle and equipment check."));
    if (session.access_status !== "confirmed") blockers.push(blocker("access_not_confirmed", "Customer access is not confirmed.", "Ask the Access Failure Prevention Specialist to verify access."));
  }
  if (action === "arrive" && session.access_status !== "confirmed") blockers.push(blocker("access_not_confirmed", "Site access changed or is not confirmed.", "Message dispatch before recording arrival."));
  if (action === "start") {
    if (session.access_status !== "confirmed") blockers.push(blocker("access_not_confirmed", "Site access is not confirmed.", "Message dispatch before starting."));
    if (!session.equipment_ready) blockers.push(blocker("equipment_not_ready", "Required equipment is not confirmed.", "Run the vehicle and equipment check."));
  }
  if (action === "complete") {
    if (!session.checklist.every(Boolean)) blockers.push(blocker("checklist_incomplete", "Required job tasks are incomplete.", "Complete or explain every required task."));
    if (session.evidence_count < session.required_evidence_count) blockers.push(blocker("evidence_missing", "Required completion evidence is missing.", `Add ${session.required_evidence_count - session.evidence_count} more evidence item${session.required_evidence_count - session.evidence_count === 1 ? "" : "s"}.`));
  }
  return blockers;
}

function createIntent(session, capability_id, operation, payload, now) {
  const command_id = operationId("go-command", session, now);
  const correlation_id = operationId("go-correlation", session, now);
  return Object.freeze({
    schema_version: GO_FIELD_RUNTIME_VERSION,
    command_id,
    company_id: session.company_id,
    actor_id: session.actor_id,
    device_id: session.device_id,
    surface: "go",
    job_id: session.job_id,
    projection_revision: session.projection_revision,
    capability_id,
    operation,
    idempotency_key: `go:${session.job_id}:${operation}:${String(Date.parse(now) || now)}`,
    correlation_id,
    payload: Object.freeze({ ...payload }),
    transport: "titan-command-bus",
    execution_authorised: false,
    requires_server_acceptance: true,
    requires_receipt: true,
  });
}

function queueItem(session, intent, now) {
  return Object.freeze({
    schema_version: GO_FIELD_RUNTIME_VERSION,
    operation_id: intent.command_id,
    company_id: session.company_id,
    actor_id: session.actor_id,
    device_id: session.device_id,
    job_id: session.job_id,
    base_projection_revision: session.projection_revision,
    occurred_at: now,
    idempotency_key: intent.idempotency_key,
    intent,
    replay_authorised: false,
    requires_revalidation: true,
  });
}

export function prepareGoTransition(session, action, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const blockers = transitionBlockers(session, action);
  if (blockers.length) return Object.freeze({ status: "blocked", session, blockers: Object.freeze(blockers), intent: null, queue_item: null });
  const intent = createIntent(session, "jobs.progress", action, { from_stage: session.stage, requested_stage: transitionStage[action] }, now);
  if (options.online === false) {
    return Object.freeze({ status: "queued_offline", session, blockers: Object.freeze([]), intent, queue_item: queueItem(session, intent, now) });
  }
  return Object.freeze({ status: "awaiting_receipt", session, blockers: Object.freeze([]), intent, queue_item: null });
}

export function applyGoReceipt(session, intent, receipt) {
  rejectLegacy(receipt);
  if (receipt.company_id !== session.company_id || receipt.company_id !== intent.company_id) throw new TypeError("go-receipt-company-mismatch");
  if (receipt.command_id !== intent.command_id) throw new TypeError("go-receipt-command-mismatch");
  if (receipt.correlation_id !== intent.correlation_id) throw new TypeError("go-receipt-correlation-mismatch");
  if (!['accepted', 'completed'].includes(receipt.status)) return session;
  return createGoFieldSession({ ...session, stage: transitionStage[intent.operation] ?? session.stage, last_receipt_id: required(receipt.receipt_id, "receipt_id") });
}

export function revalidateGoQueue(queue, projection) {
  rejectLegacy(projection);
  const ready = [];
  const conflicts = [];
  const seen = new Set();
  for (const item of queue) {
    let reason = null;
    if (item.company_id !== projection.company_id || item.actor_id !== projection.actor_id || item.device_id !== projection.device_id) reason = "scope_changed";
    else if (item.base_projection_revision !== projection.projection_revision) reason = "projection_changed";
    else if (seen.has(item.operation_id)) reason = "duplicate_operation";
    seen.add(item.operation_id);
    (reason ? conflicts : ready).push(reason ? Object.freeze({ item, reason }) : item);
  }
  return Object.freeze({ ready: Object.freeze(ready), conflicts: Object.freeze(conflicts), replay_authorised: false });
}

export function prepareGoIssue(session, issue) {
  rejectLegacy(issue);
  const now = issue.now ?? new Date().toISOString();
  const type = required(issue.type, "issue_type");
  const intent = createIntent(session, "field.issue.report", "report", { type, note: required(issue.note, "issue_note"), stage: session.stage }, now);
  const critical = type === "access_problem" || type === "safety_hazard";
  const signal = Object.freeze({
    schema_version: GO_FIELD_RUNTIME_VERSION,
    signal_id: operationId("go-signal", session, now),
    company_id: session.company_id,
    surface: "go",
    job_id: session.job_id,
    kind: type === "access_problem" ? "field_access_at_risk" : "field_issue_reported",
    severity: critical ? "critical" : "warning",
    correlation_id: intent.correlation_id,
    authority_neutral: true,
  });
  if (issue.online === false) return Object.freeze({ status: "queued_offline", session, intent, signal, queue_item: queueItem(session, intent, now) });
  return Object.freeze({ status: "awaiting_receipt", session, intent, signal, queue_item: null });
}
