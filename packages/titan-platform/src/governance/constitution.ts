export type ConstitutionInvariant = "company_isolation" | "evidence_required" | "authority_ceiling" | "irreversible_action" | "privacy_egress" | "cost_sovereignty" | "factual_boundary" | "recovery_required";

export interface ConstitutionManifest { constitution_id: "titan.constitution"; version: string; policy_set_id: string; invariants: readonly ConstitutionInvariant[]; }
export interface ConstitutionContext { company_id: string; manifest_id: string; manifest_version: string; authority_ceiling: number; requested_authority: number; evidence_refs: readonly string[]; privacy_egress_approved: boolean; cost_budget_cents?: number; estimated_cost_cents?: number; factual: boolean; recovery_plan_ref?: string; active_at: string; expires_at: string; }
export interface ConstitutionDecision { allowed: boolean; reason: string; manifest_id: string; manifest_version: string; invariant: ConstitutionInvariant | "context"; }

const REQUIRED_INVARIANTS: readonly ConstitutionInvariant[] = ["company_isolation", "evidence_required", "authority_ceiling", "irreversible_action", "privacy_egress", "cost_sovereignty", "factual_boundary", "recovery_required"];
export const TITAN_CONSTITUTION_MANIFEST: ConstitutionManifest = Object.freeze({ constitution_id: "titan.constitution", version: "1.0.0", policy_set_id: "titan.constitution.v1", invariants: REQUIRED_INVARIANTS });

export function validateConstitutionManifest(manifest: ConstitutionManifest): void {
  if (manifest.constitution_id !== "titan.constitution" || !manifest.version || !manifest.policy_set_id) throw new Error("invalid constitution manifest identity");
  for (const invariant of REQUIRED_INVARIANTS) if (!manifest.invariants.includes(invariant)) throw new Error(`constitution manifest is missing invariant: ${invariant}`);
}

export function evaluateConstitution(context: ConstitutionContext | undefined, request: { company_id: string; irreversible: boolean; counterfactual?: boolean; requires_egress?: boolean }, now = new Date(), manifest: ConstitutionManifest = TITAN_CONSTITUTION_MANIFEST): ConstitutionDecision {
  validateConstitutionManifest(manifest);
  const deny = (reason: string, invariant: ConstitutionDecision["invariant"] = "context"): ConstitutionDecision => ({ allowed: false, reason, manifest_id: manifest.policy_set_id, manifest_version: manifest.version, invariant });
  if (!context) return deny("constitutional context is required");
  if (context.manifest_id !== manifest.policy_set_id || context.manifest_version !== manifest.version) return deny("constitutional context is stale or incompatible");
  if (!context.company_id || context.company_id !== request.company_id) return deny("company boundary mismatch", "company_isolation");
  const at = now.getTime(); const active = Date.parse(context.active_at); const expires = Date.parse(context.expires_at);
  if (Number.isNaN(active) || Number.isNaN(expires) || at < active || at >= expires) return deny("constitutional context is inactive or expired");
  if (context.evidence_refs.length === 0) return deny("evidence is required", "evidence_required");
  if (context.requested_authority > context.authority_ceiling) return deny("authority exceeds constitutional ceiling", "authority_ceiling");
  if (request.irreversible && !context.recovery_plan_ref) return deny("irreversible action requires recovery plan", "recovery_required");
  if (request.requires_egress && !context.privacy_egress_approved) return deny("privacy/egress approval is required", "privacy_egress");
  if (context.cost_budget_cents !== undefined && context.estimated_cost_cents !== undefined && context.estimated_cost_cents > context.cost_budget_cents) return deny("cost exceeds constitutional budget", "cost_sovereignty");
  if (request.counterfactual && context.factual) return deny("counterfactual execution cannot use factual context", "factual_boundary");
  return { allowed: true, reason: "constitutional invariants satisfied", manifest_id: manifest.policy_set_id, manifest_version: manifest.version, invariant: "context" };
}

