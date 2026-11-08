export type PersonalZeroRole = "owner" | "manager" | "worker" | "customer" | "supplier" | "partner";
export type PersonalZeroContext = Readonly<{
  context_id: string;
  one_id: string;
  zero_id: string;
  company_id: string;
  role: PersonalZeroRole;
  capability_ids: readonly string[];
  data_scope: readonly string[];
  revision: number;
  revoked: boolean;
  authority_neutral: true;
}>;

function required(value: unknown, label: string): string { if (typeof value !== "string" || value.trim() === "") throw new TypeError(label + "-required"); return value.trim(); }
function list(values: readonly string[], label: string): readonly string[] { const result = values.map((value) => required(value, label)); if (new Set(result).size !== result.length) throw new TypeError(label + "-duplicate"); return Object.freeze(result); }

export function createPersonalZeroContext(input: { context_id: string; one_id: string; zero_id: string; company_id: string; role: PersonalZeroRole; capability_ids: readonly string[]; data_scope: readonly string[]; }): PersonalZeroContext {
  return Object.freeze({ context_id: required(input.context_id, "context_id"), one_id: required(input.one_id, "one_id"), zero_id: required(input.zero_id, "zero_id"), company_id: required(input.company_id, "company_id"), role: input.role, capability_ids: list(input.capability_ids, "capability-id"), data_scope: list(input.data_scope, "data-scope"), revision: 1, revoked: false, authority_neutral: true });
}

export function assertPersonalZeroContextActive(context: PersonalZeroContext, company_id: string, revision = context.revision): PersonalZeroContext {
  if (context.company_id !== required(company_id, "company_id")) throw new TypeError("personal-zero-company-mismatch");
  if (context.revoked) throw new TypeError("personal-zero-context-revoked");
  if (context.revision !== revision) throw new TypeError("personal-zero-context-stale");
  return context;
}

export function revokePersonalZeroContext(context: PersonalZeroContext, reason: string): PersonalZeroContext {
  required(reason, "revocation-reason");
  return Object.freeze({ ...context, revision: context.revision + 1, revoked: true });
}
