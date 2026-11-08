export const BUSINESS_REALITY_OBSERVATION_SCHEMA_VERSION = "1.0" as const;
export type RealityFact = Readonly<{ value: unknown; provenance: string; confidence: number }>;
export type BusinessRealityObservation = Readonly<{ schema_version: typeof BUSINESS_REALITY_OBSERVATION_SCHEMA_VERSION; observation_id: string; company_id: string; observed_at: string; source_revision: string; facts: Readonly<Record<string, RealityFact>>; authority_neutral: true }>;
export type RealityChange = Readonly<{ company_id: string; previous_observation_id: string; current_observation_id: string; changed_fact_keys: readonly string[]; meaningful: boolean; freshness: "FRESH" | "STALE"; authority_neutral: true }>;
export type RealityReconfigurationProposal = Readonly<{ proposal_id: string; company_id: string; observation_id: string; changed_fact_keys: readonly string[]; semantic_diff: Readonly<Record<string, { before: unknown; after: unknown }>>; approval_fingerprint: string; status: "PROPOSED"; authority_neutral: true; requires_governed_approval: true }>;

function text(value: unknown, label: string): string { if (typeof value !== "string" || value.trim() === "") throw new TypeError(label + "-required"); return value.trim(); }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(label + "-object-required"); return value as Record<string, unknown>; }
function stable(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"; return "{" + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ":" + stable((value as Record<string, unknown>)[key])).join(",") + "}"; }

export function createBusinessRealityObservation(input: Omit<BusinessRealityObservation, "schema_version" | "authority_neutral">): BusinessRealityObservation {
  const company_id = text(input.company_id, "company_id"); const facts = record(input.facts, "facts");
  const normalized: Record<string, RealityFact> = {};
  for (const key of Object.keys(facts).sort()) { const fact = record(facts[key], "fact"); const confidence = Number(fact.confidence); if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("fact-confidence-invalid"); normalized[text(key, "fact-key")] = Object.freeze({ value: fact.value, provenance: text(fact.provenance, "fact-provenance"), confidence }); }
  return Object.freeze({ schema_version: BUSINESS_REALITY_OBSERVATION_SCHEMA_VERSION, observation_id: text(input.observation_id, "observation_id"), company_id, observed_at: text(input.observed_at, "observed_at"), source_revision: text(input.source_revision, "source_revision"), facts: Object.freeze(normalized), authority_neutral: true });
}

export function detectBusinessRealityChange(previous: BusinessRealityObservation, current: BusinessRealityObservation): RealityChange {
  if (previous.company_id !== current.company_id) throw new TypeError("observation-company-mismatch");
  const keys = [...new Set([...Object.keys(previous.facts), ...Object.keys(current.facts)])].sort();
  const changed_fact_keys = keys.filter((key) => stable(previous.facts[key]) !== stable(current.facts[key]));
  return Object.freeze({ company_id: current.company_id, previous_observation_id: previous.observation_id, current_observation_id: current.observation_id, changed_fact_keys: Object.freeze(changed_fact_keys), meaningful: changed_fact_keys.length > 0, freshness: Date.parse(current.observed_at) >= Date.parse(previous.observed_at) ? "FRESH" : "STALE", authority_neutral: true });
}

export function proposeBusinessRealityReconfiguration(input: { proposal_id: string; previous: BusinessRealityObservation; current: BusinessRealityObservation }): RealityReconfigurationProposal {
  const change = detectBusinessRealityChange(input.previous, input.current); if (!change.meaningful) throw new TypeError("reconfiguration-noop");
  const semantic_diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of change.changed_fact_keys) semantic_diff[key] = { before: input.previous.facts[key]?.value ?? null, after: input.current.facts[key]?.value ?? null };
  return Object.freeze({ proposal_id: text(input.proposal_id, "proposal_id"), company_id: input.current.company_id, observation_id: input.current.observation_id, changed_fact_keys: change.changed_fact_keys, semantic_diff: Object.freeze(semantic_diff), approval_fingerprint: stable({ proposal_id: input.proposal_id, company_id: input.current.company_id, observation_id: input.current.observation_id, semantic_diff }), status: "PROPOSED", authority_neutral: true, requires_governed_approval: true });
}
