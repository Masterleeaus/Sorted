export interface AssuranceTrace {
  company_id: string;
  operation_id: string;
  constitution_policy_set_id: string;
  authority_decision_ref: string;
  evidence_refs: readonly string[];
  execution_receipt_ref?: string;
  verification_ref?: string;
  recovery_plan_ref?: string;
  rewind_intent_ref?: string;
}

export interface AssuranceReadiness { ready: boolean; missing: readonly string[]; company_id: string; operation_id: string; }

export function assessAssuranceReadiness(trace: AssuranceTrace): AssuranceReadiness {
  const missing: string[] = [];
  if (!trace.company_id) missing.push("company_id");
  if (!trace.operation_id) missing.push("operation_id");
  if (!trace.constitution_policy_set_id) missing.push("constitution_policy_set_id");
  if (!trace.authority_decision_ref) missing.push("authority_decision_ref");
  if (trace.evidence_refs.length === 0) missing.push("evidence_refs");
  if (!trace.execution_receipt_ref) missing.push("execution_receipt_ref");
  if (!trace.verification_ref) missing.push("verification_ref");
  return { ready: missing.length === 0, missing, company_id: trace.company_id, operation_id: trace.operation_id };
}

export function canRewindAsNewIntent(trace: AssuranceTrace): boolean {
  return Boolean(trace.company_id && trace.operation_id && trace.authority_decision_ref && trace.evidence_refs.length && trace.rewind_intent_ref);
}

