export const WORKFORCE_COVERAGE_SCHEMA_VERSION = "1.0" as const;

export type WorkforceAgentKind = "human" | "ai" | "orchestrator";
export interface WorkforceAgentIdentity { agent_id: string; company_id: string; kind: WorkforceAgentKind; parent_agent_id?: string | null; team_id?: string | null; capability_ids: readonly string[]; active?: boolean; }
export interface WorkforceCoverageRequirement { coverage_id: string; company_id: string; outcome_key: string; required_capability_ids: readonly string[]; owner_agent_id?: string | null; }
export interface WorkforceCoverageClosureEntry { coverage_id: string; outcome_key: string; required_capability_ids: readonly string[]; owner_agent_id: string | null; candidate_agent_ids: readonly string[]; status: "COVERED" | "MISSING"; }
export interface WorkforceCoverageClosure { schema_version: typeof WORKFORCE_COVERAGE_SCHEMA_VERSION; company_id: string; revision: string; entries: readonly WorkforceCoverageClosureEntry[]; authority_neutral: true; identity_grants_authority: false; canonical_business_truth: "workforce"; }

function required(value: unknown, label: string): string { if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`); return value.trim(); }
function unique(values: readonly string[], label: string): readonly string[] { const normalized = values.map((value) => required(value, label)); if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label}-duplicate`); return Object.freeze([...normalized]); }
function assertCompany(value: string, company_id: string, label: string): void { if (required(value, label) !== company_id) throw new TypeError(`${label}-company-mismatch`); }

function assertHierarchy(agents: readonly WorkforceAgentIdentity[], company_id: string): void {
  const byId = new Map<string, WorkforceAgentIdentity>();
  for (const agent of agents) { const id = required(agent.agent_id, "agent_id"); assertCompany(agent.company_id, company_id, "agent"); if (byId.has(id)) throw new TypeError("agent_id-duplicate"); byId.set(id, agent); }
  for (const agent of agents) { let current = agent.parent_agent_id ?? null; const seen = new Set<string>([agent.agent_id]); while (current) { if (seen.has(current)) throw new TypeError("workforce-hierarchy-cycle"); seen.add(current); const parent = byId.get(current); if (!parent) throw new TypeError("workforce-parent-not-found"); current = parent.parent_agent_id ?? null; } }
}

export function createWorkforceCoverageClosure(input: { company_id: string; revision: string; agents: readonly WorkforceAgentIdentity[]; requirements: readonly WorkforceCoverageRequirement[]; }): WorkforceCoverageClosure {
  const company_id = required(input.company_id, "company_id"); const revision = required(input.revision, "workforce-revision"); assertHierarchy(input.agents, company_id);
  const agents = input.agents.map((agent) => ({ ...agent, agent_id: required(agent.agent_id, "agent_id"), capability_ids: unique(agent.capability_ids, "agent-capability-id"), active: agent.active !== false }));
  const byId = new Map(agents.map((agent) => [agent.agent_id, agent])); const seenOutcomes = new Set<string>();
  const entries = input.requirements.map((requirement) => {
    assertCompany(requirement.company_id, company_id, "coverage"); const coverage_id = required(requirement.coverage_id, "coverage_id"); const outcome_key = required(requirement.outcome_key, "outcome_key");
    if (seenOutcomes.has(outcome_key)) throw new TypeError("outcome_key-duplicate"); seenOutcomes.add(outcome_key);
    const required_capability_ids = unique(requirement.required_capability_ids, "required-capability-id");
    const candidates = agents.filter((agent) => agent.active && required_capability_ids.every((capability) => agent.capability_ids.includes(capability))).sort((left, right) => left.agent_id.localeCompare(right.agent_id));
    const requestedOwner = requirement.owner_agent_id ? required(requirement.owner_agent_id, "owner_agent_id") : null;
    if (requestedOwner) { const owner = byId.get(requestedOwner); if (!owner || !owner.active || !required_capability_ids.every((capability) => owner.capability_ids.includes(capability))) throw new TypeError("coverage-owner-ineligible"); }
    const owner_agent_id = requestedOwner ?? candidates[0]?.agent_id ?? null;
    return Object.freeze({ coverage_id, outcome_key, required_capability_ids, owner_agent_id, candidate_agent_ids: Object.freeze(candidates.map((agent) => agent.agent_id)), status: owner_agent_id ? "COVERED" : "MISSING" });
  });
  return Object.freeze({ schema_version: WORKFORCE_COVERAGE_SCHEMA_VERSION, company_id, revision, entries: Object.freeze(entries), authority_neutral: true, identity_grants_authority: false, canonical_business_truth: "workforce" });
}

export function assertWorkforceCoverageClosed(closure: WorkforceCoverageClosure): WorkforceCoverageClosure {
  if (closure.authority_neutral !== true || closure.identity_grants_authority !== false) throw new TypeError("workforce-coverage-authority-contract-invalid");
  if (closure.entries.some((entry) => entry.status !== "COVERED" || !entry.owner_agent_id)) throw new TypeError("workforce-coverage-incomplete");
  return closure;
}
