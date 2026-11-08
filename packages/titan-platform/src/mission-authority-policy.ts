export type MissionPolicyRule =
  | { kind: "max_amount"; currency: string; amount: number }
  | { kind: "max_provider_cost"; currency: string; amount: number }
  | { kind: "max_messages"; count: number }
  | { kind: "max_recipients"; count: number }
  | { kind: "requires_approval"; operation: string }
  | { kind: "allowed_capabilities"; capabilities: string[] };

export type MissionPolicyInput = {
  company_id: string;
  policy_id: string;
  version: number;
  statement: string;
  source_ref: string;
  author_id: string;
  approver_id: string;
  scope: { mission_id: string; agent_ids?: string[] };
  effective_from: string;
  effective_until?: string | null;
  rules: MissionPolicyRule[];
};

export type CompiledMissionPolicy = MissionPolicyInput & {
  schema: "titan.mission-authority-policy.v1";
  status: "active";
  compiled_at: string;
};

export type MissionAuthorityContext = {
  company_id: string;
  mission_id: string;
  agent_id?: string;
  operation: string;
  capability: string;
  amount?: number;
  provider_cost?: number;
  messages?: number;
  recipients?: number;
  currency?: string;
  now?: string;
  mission_state?: "active" | "paused" | "closed";
  revoked?: boolean;
  expired?: boolean;
};

export type MissionAuthorityResult = {
  decision: "allow" | "approval_required" | "deny";
  reason: string;
  policy_id: string;
  policy_version: number;
  constraints: readonly string[];
};

const required = (value: unknown, name: string): string => {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`${name}-required`);
  return normalized;
};

const date = (value: unknown, name: string): string => {
  const normalized = required(value, name);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(`${name}-invalid`);
  return normalized;
};

export function compileMissionAuthorityPolicy(input: MissionPolicyInput): CompiledMissionPolicy {
  const company_id = required(input.company_id, "company_id");
  const policy_id = required(input.policy_id, "policy_id");
  const statement = required(input.statement, "statement");
  const source_ref = required(input.source_ref, "source_ref");
  const author_id = required(input.author_id, "author_id");
  const approver_id = required(input.approver_id, "approver_id");
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("policy-version-invalid");
  if (!input.scope || required(input.scope.mission_id, "mission_id") === "") throw new Error("mission_id-required");
  if (author_id === approver_id) throw new Error("author-cannot-approve-own-policy");
  const effective_from = date(input.effective_from, "effective_from");
  const effective_until = input.effective_until == null ? null : date(input.effective_until, "effective_until");
  if (effective_until && Date.parse(effective_until) <= Date.parse(effective_from)) throw new Error("policy-period-invalid");
  if (!Array.isArray(input.rules) || input.rules.length === 0) throw new Error("policy-rules-required");
  const rules = input.rules.map((rule) => {
    if (rule.kind === "max_amount" || rule.kind === "max_provider_cost") {
      if (!Number.isFinite(rule.amount) || rule.amount < 0) throw new Error(rule.kind === "max_amount" ? "policy-amount-invalid" : "policy-provider-cost-invalid");
      return { ...rule, currency: required(rule.currency, "currency").toUpperCase() };
    }
    if (rule.kind === "max_messages" || rule.kind === "max_recipients") {
      if (!Number.isInteger(rule.count) || rule.count < 0) throw new Error(rule.kind === "max_messages" ? "policy-message-count-invalid" : "policy-recipient-count-invalid");
      return { ...rule };
    }
    if (rule.kind === "requires_approval") return { ...rule, operation: required(rule.operation, "operation") };
    if (rule.kind === "allowed_capabilities") {
      const capabilities = [...new Set((rule.capabilities ?? []).map((v) => required(v, "capability")))];
      if (!capabilities.length) throw new Error("policy-capabilities-required");
      return { ...rule, capabilities };
    }
    throw new Error("policy-rule-invalid");
  });
  return Object.freeze({ ...input, company_id, policy_id, statement, source_ref, author_id, approver_id,
    scope: { ...input.scope, mission_id: required(input.scope.mission_id, "mission_id") }, effective_from,
    effective_until, rules, schema: "titan.mission-authority-policy.v1", status: "active", compiled_at: new Date().toISOString() });
}

export function evaluateMissionAuthorityPolicy(policy: CompiledMissionPolicy, context: MissionAuthorityContext): MissionAuthorityResult {
  if (policy.company_id !== required(context.company_id, "company_id")) throw new Error("policy-company-mismatch");
  if (policy.scope.mission_id !== required(context.mission_id, "mission_id")) throw new Error("policy-mission-mismatch");
  const now = Date.parse(context.now ?? new Date().toISOString());
  if (!Number.isFinite(now)) throw new Error("policy-now-invalid");
  if (context.revoked || context.expired || context.mission_state === "paused" || context.mission_state === "closed")
    return result(policy, "deny", context.revoked ? "policy-revoked" : "mission-not-active");
  if (now < Date.parse(policy.effective_from) || (policy.effective_until && now >= Date.parse(policy.effective_until)))
    return result(policy, "deny", "policy-outside-effective-window");
  if (policy.scope.agent_ids?.length && (!context.agent_id || !policy.scope.agent_ids.includes(context.agent_id)))
    return result(policy, "deny", "agent-outside-mission-scope");
  const allowed = policy.rules.find((rule) => rule.kind === "allowed_capabilities");
  if (allowed?.kind === "allowed_capabilities" && !allowed.capabilities.includes(context.capability))
    return result(policy, "deny", "capability-not-allowed");
  const ceiling = policy.rules.find((rule) => rule.kind === "max_amount");
  if (ceiling?.kind === "max_amount" && (context.currency ?? "").toUpperCase() !== ceiling.currency)
    return result(policy, "deny", "currency-mismatch");
  if (ceiling?.kind === "max_amount" && (context.amount == null || !Number.isFinite(context.amount) || context.amount > ceiling.amount))
    return result(policy, "deny", "amount-limit-exceeded");
  const providerCost = policy.rules.find((rule) => rule.kind === "max_provider_cost");
  if (providerCost?.kind === "max_provider_cost" && (context.currency ?? "").toUpperCase() !== providerCost.currency)
    return result(policy, "deny", "provider-cost-currency-mismatch");
  if (providerCost?.kind === "max_provider_cost" && (context.provider_cost == null || !Number.isFinite(context.provider_cost) || context.provider_cost > providerCost.amount))
    return result(policy, "deny", "provider-cost-limit-exceeded");
  const messageLimit = policy.rules.find((rule) => rule.kind === "max_messages");
  if (messageLimit?.kind === "max_messages" && (!Number.isInteger(context.messages) || context.messages! < 0 || context.messages! > messageLimit.count))
    return result(policy, "deny", "message-limit-exceeded");
  const recipientLimit = policy.rules.find((rule) => rule.kind === "max_recipients");
  if (recipientLimit?.kind === "max_recipients" && (!Number.isInteger(context.recipients) || context.recipients! < 0 || context.recipients! > recipientLimit.count))
    return result(policy, "deny", "recipient-limit-exceeded");
  if (policy.rules.some((rule) => rule.kind === "requires_approval" && rule.operation === context.operation))
    return result(policy, "approval_required", "policy-approval-required");
  return result(policy, "allow", "policy-constraints-satisfied");
}

function result(policy: CompiledMissionPolicy, decision: MissionAuthorityResult["decision"], reason: string): MissionAuthorityResult {
  return Object.freeze({ decision, reason, policy_id: policy.policy_id, policy_version: policy.version,
    constraints: Object.freeze(policy.rules.map((rule) => rule.kind)) });
}


export type MissionAuthorityLimitsProjection = Readonly<{
  currency: string | null;
  max_amount: number | null;
  max_provider_cost: number | null;
  max_messages: number | null;
  max_recipients: number | null;
}>;

/**
 * Projects accepted mission policy ceilings into the canonical authority
 * requirement shape. This projection can only add/narrow ceilings; it grants no
 * permission, entitlement, approval or autonomy by itself.
 */
export function projectMissionAuthorityLimits(policy: CompiledMissionPolicy): MissionAuthorityLimitsProjection {
  const amount = policy.rules.find((rule) => rule.kind === "max_amount");
  const provider = policy.rules.find((rule) => rule.kind === "max_provider_cost");
  if (amount?.kind === "max_amount" && provider?.kind === "max_provider_cost" && amount.currency !== provider.currency)
    throw new Error("policy-limit-currency-conflict");
  const messages = policy.rules.find((rule) => rule.kind === "max_messages");
  const recipients = policy.rules.find((rule) => rule.kind === "max_recipients");
  return Object.freeze({
    currency: amount?.kind === "max_amount" ? amount.currency : provider?.kind === "max_provider_cost" ? provider.currency : null,
    max_amount: amount?.kind === "max_amount" ? amount.amount : null,
    max_provider_cost: provider?.kind === "max_provider_cost" ? provider.amount : null,
    max_messages: messages?.kind === "max_messages" ? messages.count : null,
    max_recipients: recipients?.kind === "max_recipients" ? recipients.count : null,
  });
}
