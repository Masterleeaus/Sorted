import { assertTitanBusinessWorkflowBoundary } from "./workflow-ownership.js";

export const TITAN_BUSINESS_VARIATION_APPROVAL_SCHEMA = "titan.zero.business.variation-approval/v1" as const;

export type TitanBusinessVariationApprovalStatus = "PENDING" | "APPROVED" | "DENIED" | "EXPIRED";
export type TitanBusinessVariationApprovalDecision = "APPROVE" | "DENY";

export type TitanBusinessAuthoritySnapshot = Readonly<{
  company_id: string;
  actor_id: string;
  authority_revision: string;
  capability: "crm.work_order.update";
  scoped_work_order_id: string;
  captured_at: string;
  expires_at: string;
  identity_grants_authority: false;
}>;

export type TitanBusinessVariationApproval = Readonly<{
  schema: typeof TITAN_BUSINESS_VARIATION_APPROVAL_SCHEMA;
  company_id: string;
  correlation_id: string;
  variation_id: string;
  work_order_id: string;
  revision: number;
  status: TitanBusinessVariationApprovalStatus;
  requested_at: string;
  approval_expires_at: string;
  authority_snapshot: TitanBusinessAuthoritySnapshot;
  decision: Readonly<{
    type: TitanBusinessVariationApprovalDecision;
    decided_at: string;
    reason_code: string | null;
    actor_id: string;
    authority_revision: string;
  }> | null;
  audit: readonly Readonly<{
    event: "REQUESTED" | "APPROVED" | "DENIED" | "EXPIRED";
    at: string;
    actor_id: string;
    authority_revision: string;
    reason_code: string | null;
  }>[];
}>;

function token(value: unknown, code: string, max = 180): string {
  const out = String(value ?? "").trim();
  if (!out || out.length > max || out.includes("/") || out.includes("\\") || out.includes("..")) throw new Error(code);
  return out;
}

function instant(value: unknown, code: string): string {
  const out = token(value, code, 64);
  const ms = Date.parse(out);
  if (!Number.isFinite(ms)) throw new Error(code);
  return new Date(ms).toISOString();
}

function assertSnapshot(snapshot: TitanBusinessAuthoritySnapshot, companyId: string, workOrderId: string, nowIso: string): void {
  if (assertTitanBusinessWorkflowBoundary(snapshot.company_id) !== companyId) throw new Error("variation-approval-authority-company-mismatch");
  if (snapshot.capability !== "crm.work_order.update") throw new Error("variation-approval-authority-capability-invalid");
  if (token(snapshot.scoped_work_order_id, "variation-approval-authority-scope-invalid") !== workOrderId) throw new Error("variation-approval-authority-scope-mismatch");
  token(snapshot.actor_id, "variation-approval-authority-actor-required", 128);
  token(snapshot.authority_revision, "variation-approval-authority-revision-required", 128);
  const captured = Date.parse(instant(snapshot.captured_at, "variation-approval-authority-captured-at-invalid"));
  const expires = Date.parse(instant(snapshot.expires_at, "variation-approval-authority-expires-at-invalid"));
  const now = Date.parse(nowIso);
  if (expires <= captured) throw new Error("variation-approval-authority-window-invalid");
  if (now >= expires) throw new Error("variation-approval-authority-expired");
  if (snapshot.identity_grants_authority !== false) throw new Error("variation-approval-identity-authority-forbidden");
}

export function createTitanBusinessVariationApproval(input: Readonly<{
  companyId: string;
  correlationId: string;
  variationId: string;
  workOrderId: string;
  requestedAt: string;
  approvalExpiresAt: string;
  authoritySnapshot: TitanBusinessAuthoritySnapshot;
}>): TitanBusinessVariationApproval {
  const company_id = assertTitanBusinessWorkflowBoundary(input.companyId);
  const work_order_id = token(input.workOrderId, "variation-approval-work-order-required");
  const requested_at = instant(input.requestedAt, "variation-approval-requested-at-invalid");
  const approval_expires_at = instant(input.approvalExpiresAt, "variation-approval-expires-at-invalid");
  if (Date.parse(approval_expires_at) <= Date.parse(requested_at)) throw new Error("variation-approval-expiry-window-invalid");
  assertSnapshot(input.authoritySnapshot, company_id, work_order_id, requested_at);
  const requestedAudit = Object.freeze({
    event: "REQUESTED" as const,
    at: requested_at,
    actor_id: input.authoritySnapshot.actor_id,
    authority_revision: input.authoritySnapshot.authority_revision,
    reason_code: null,
  });
  return Object.freeze({
    schema: TITAN_BUSINESS_VARIATION_APPROVAL_SCHEMA,
    company_id,
    correlation_id: token(input.correlationId, "variation-approval-correlation-required"),
    variation_id: token(input.variationId, "variation-approval-variation-id-required"),
    work_order_id,
    revision: 0,
    status: "PENDING" as const,
    requested_at,
    approval_expires_at,
    authority_snapshot: Object.freeze({ ...input.authoritySnapshot, company_id, scoped_work_order_id: work_order_id, captured_at: instant(input.authoritySnapshot.captured_at, "variation-approval-authority-captured-at-invalid"), expires_at: instant(input.authoritySnapshot.expires_at, "variation-approval-authority-expires-at-invalid"), identity_grants_authority: false as const }),
    decision: null,
    audit: Object.freeze([requestedAudit]),
  });
}

export function transitionTitanBusinessVariationApproval(input: Readonly<{
  approval: TitanBusinessVariationApproval;
  expectedRevision: number;
  now: string;
  decision?: TitanBusinessVariationApprovalDecision;
  reasonCode?: string | null;
  authoritySnapshot?: TitanBusinessAuthoritySnapshot;
}>): TitanBusinessVariationApproval {
  const approval = input.approval;
  if (input.expectedRevision !== approval.revision) throw new Error("variation-approval-revision-conflict");
  if (approval.status !== "PENDING") throw new Error("variation-approval-terminal");
  const now = instant(input.now, "variation-approval-now-invalid");
  const expired = Date.parse(now) >= Date.parse(approval.approval_expires_at);
  if (expired) {
    const audit = Object.freeze([...approval.audit, Object.freeze({ event: "EXPIRED" as const, at: now, actor_id: approval.authority_snapshot.actor_id, authority_revision: approval.authority_snapshot.authority_revision, reason_code: "approval-window-expired" })]);
    return Object.freeze({ ...approval, revision: approval.revision + 1, status: "EXPIRED" as const, audit });
  }
  if (!input.decision) throw new Error("variation-approval-decision-required");
  const snapshot = input.authoritySnapshot;
  if (!snapshot) throw new Error("variation-approval-authority-snapshot-required");
  assertSnapshot(snapshot, approval.company_id, approval.work_order_id, now);
  const reason_code = input.reasonCode ? token(input.reasonCode, "variation-approval-reason-code-invalid", 120) : null;
  const status = input.decision === "APPROVE" ? "APPROVED" as const : "DENIED" as const;
  const event = input.decision === "APPROVE" ? "APPROVED" as const : "DENIED" as const;
  const decision = Object.freeze({
    type: input.decision,
    decided_at: now,
    reason_code,
    actor_id: snapshot.actor_id,
    authority_revision: snapshot.authority_revision,
  });
  const audit = Object.freeze([...approval.audit, Object.freeze({ event, at: now, actor_id: snapshot.actor_id, authority_revision: snapshot.authority_revision, reason_code })]);
  return Object.freeze({ ...approval, revision: approval.revision + 1, status, decision, audit });
}

export function assertTitanBusinessVariationApprovalExecutable(input: Readonly<{
  approval: TitanBusinessVariationApproval;
  companyId: string;
  workOrderId: string;
  now: string;
}>): TitanBusinessVariationApproval {
  if (assertTitanBusinessWorkflowBoundary(input.companyId) !== input.approval.company_id) throw new Error("variation-approval-company-mismatch");
  if (token(input.workOrderId, "variation-approval-work-order-required") !== input.approval.work_order_id) throw new Error("variation-approval-work-order-mismatch");
  if (input.approval.status !== "APPROVED") throw new Error("variation-approval-not-approved");
  if (Date.parse(instant(input.now, "variation-approval-now-invalid")) >= Date.parse(input.approval.approval_expires_at)) throw new Error("variation-approval-expired-before-execution");
  return input.approval;
}
