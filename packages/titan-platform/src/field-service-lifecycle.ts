export type FieldServiceStage =
  | "REQUESTED"
  | "QUOTED"
  | "APPROVED"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "INVOICING_READY"
  | "PAID"
  | "CANCELLED";

export type FieldServiceLifecycleEvent = Readonly<{
  transition_id: string;
  idempotency_key: string;
  company_id: string;
  from_stage: FieldServiceStage;
  to_stage: FieldServiceStage;
  from_revision: number;
  to_revision: number;
  authority_decision_ref: string;
  execution_receipt_ref: string;
  evidence_refs: readonly string[];
  observed_verification_ref: string | null;
}>;

export type FieldServiceLifecycle = Readonly<{
  schema: "titan.field-service-lifecycle.v2";
  lifecycle_id: string;
  company_id: string;
  customer_ref: string;
  stage: FieldServiceStage;
  revision: number;
  evidence_refs: readonly string[];
  outcome_refs: readonly string[];
  events: readonly FieldServiceLifecycleEvent[];
  authority_granted: false;
}>;

export type FieldServiceLifecycleMutation = Readonly<{
  company_id: string;
  transition_id: string;
  idempotency_key: string;
  next_stage: FieldServiceStage;
  expected_revision: number;
  authority_decision_ref: string;
  execution_receipt_ref: string;
  evidence_refs?: readonly string[];
  observed_verification_ref?: string;
  provider_ack_ref?: string;
}>;

export type VerifiedFieldServiceOutcome = Readonly<{
  company_id: string;
  outcome_ref: string;
  evidence_refs: readonly string[];
  observed_verification_ref: string;
}>;

const transitions: Record<FieldServiceStage, readonly FieldServiceStage[]> = {
  REQUESTED: ["QUOTED", "CANCELLED"],
  QUOTED: ["APPROVED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["INVOICING_READY"],
  INVOICING_READY: ["PAID"],
  PAID: [],
  CANCELLED: [],
};

const requireText = (value: unknown, name: string): string => {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${name}-required`);
  return text;
};

const unique = (values: readonly string[] | undefined): readonly string[] =>
  Object.freeze([...new Set((values ?? []).map((value) => requireText(value, "reference")))]);

const sameMutation = (event: FieldServiceLifecycleEvent, mutation: FieldServiceLifecycleMutation): boolean =>
  event.transition_id === mutation.transition_id &&
  event.idempotency_key === mutation.idempotency_key &&
  event.to_stage === mutation.next_stage &&
  event.from_revision === mutation.expected_revision &&
  event.authority_decision_ref === mutation.authority_decision_ref &&
  event.execution_receipt_ref === mutation.execution_receipt_ref &&
  event.observed_verification_ref === (mutation.observed_verification_ref ?? null) &&
  event.evidence_refs.join("\u0000") === unique(mutation.evidence_refs).join("\u0000");

function validateMutation(mutation: FieldServiceLifecycleMutation): void {
  requireText(mutation.company_id, "company_id");
  requireText(mutation.transition_id, "transition_id");
  requireText(mutation.idempotency_key, "idempotency_key");
  requireText(mutation.authority_decision_ref, "authority_decision_ref");
  requireText(mutation.execution_receipt_ref, "execution_receipt_ref");
  if (!Number.isInteger(mutation.expected_revision) || mutation.expected_revision < 1) {
    throw new Error("expected_revision-invalid");
  }
  if (mutation.provider_ack_ref && !mutation.observed_verification_ref) {
    throw new Error("observed-verification-required");
  }
}

function needsVerification(stage: FieldServiceStage): boolean {
  return stage === "COMPLETED" || stage === "INVOICING_READY" || stage === "PAID";
}

export function createFieldServiceLifecycle(input: {
  lifecycle_id: string;
  company_id: string;
  customer_ref: string;
}): FieldServiceLifecycle {
  return Object.freeze({
    schema: "titan.field-service-lifecycle.v2",
    lifecycle_id: requireText(input.lifecycle_id, "lifecycle_id"),
    company_id: requireText(input.company_id, "company_id"),
    customer_ref: requireText(input.customer_ref, "customer_ref"),
    stage: "REQUESTED" as const,
    revision: 1,
    evidence_refs: Object.freeze([]),
    outcome_refs: Object.freeze([]),
    events: Object.freeze([]),
    authority_granted: false as const,
  });
}

export function assertFieldServiceLifecycleScope(item: FieldServiceLifecycle, company_id: string): true {
  if (item.company_id !== requireText(company_id, "company_id")) throw new Error("company-mismatch");
  return true;
}

export function advanceFieldServiceLifecycle(
  item: FieldServiceLifecycle,
  mutation: FieldServiceLifecycleMutation,
): FieldServiceLifecycle {
  validateMutation(mutation);
  assertFieldServiceLifecycleScope(item, mutation.company_id);

  const prior = item.events.find((event) => event.idempotency_key === mutation.idempotency_key);
  if (prior) {
    if (!sameMutation(prior, mutation)) throw new Error("idempotency-conflict");
    return item;
  }
  if (mutation.expected_revision !== item.revision) throw new Error("revision-conflict");
  if (!transitions[item.stage].includes(mutation.next_stage)) throw new Error("transition-invalid");

  const evidence_refs = unique(mutation.evidence_refs);
  const observed_verification_ref = mutation.observed_verification_ref
    ? requireText(mutation.observed_verification_ref, "observed_verification_ref")
    : null;
  if (needsVerification(mutation.next_stage) && evidence_refs.length === 0) {
    throw new Error("evidence-required");
  }
  if (needsVerification(mutation.next_stage) && !observed_verification_ref) {
    throw new Error("observed-verification-required");
  }

  const next_revision = item.revision + 1;
  const event: FieldServiceLifecycleEvent = Object.freeze({
    transition_id: requireText(mutation.transition_id, "transition_id"),
    idempotency_key: requireText(mutation.idempotency_key, "idempotency_key"),
    company_id: item.company_id,
    from_stage: item.stage,
    to_stage: mutation.next_stage,
    from_revision: item.revision,
    to_revision: next_revision,
    authority_decision_ref: requireText(mutation.authority_decision_ref, "authority_decision_ref"),
    execution_receipt_ref: requireText(mutation.execution_receipt_ref, "execution_receipt_ref"),
    evidence_refs,
    observed_verification_ref,
  });
  return Object.freeze({
    ...item,
    stage: mutation.next_stage,
    revision: next_revision,
    evidence_refs: Object.freeze([...new Set([...item.evidence_refs, ...evidence_refs])]),
    events: Object.freeze([...item.events, event]),
  });
}

export function recordVerifiedOutcome(
  item: FieldServiceLifecycle,
  outcome: VerifiedFieldServiceOutcome,
): FieldServiceLifecycle {
  assertFieldServiceLifecycleScope(item, outcome.company_id);
  requireText(outcome.outcome_ref, "outcome_ref");
  requireText(outcome.observed_verification_ref, "observed_verification_ref");
  const evidence_refs = unique(outcome.evidence_refs);
  if (evidence_refs.length === 0) throw new Error("evidence-required");
  if (item.stage !== "COMPLETED" && item.stage !== "INVOICING_READY" && item.stage !== "PAID") {
    throw new Error("outcome-stage-invalid");
  }
  if (item.outcome_refs.includes(outcome.outcome_ref)) return item;
  return Object.freeze({
    ...item,
    evidence_refs: Object.freeze([...new Set([...item.evidence_refs, ...evidence_refs])]),
    outcome_refs: Object.freeze([...item.outcome_refs, outcome.outcome_ref]),
  });
}

