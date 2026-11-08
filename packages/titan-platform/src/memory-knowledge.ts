export type MemoryType = "working" | "episodic" | "semantic" | "procedural" | "preference" | "business";
export type MemoryScope = "personal" | "agent" | "team" | "company" | "customer" | "site" | "service" | "task" | "conversation";
export type KnowledgeSource = "user" | "business_state" | "document" | "email" | "tool" | "external_api" | "agent_inference" | "model_output" | "verified_evidence";

export interface ProvenanceRef {
  source: KnowledgeSource;
  sourceId?: string;
  observedAt: string;
  evidenceRefs?: string[];
}

export interface MemoryRecord {
  memoryId: string;
  companyId: string;
  subject: string;
  type: MemoryType;
  scope: MemoryScope;
  scopeId?: string;
  content: string;
  provenance: ProvenanceRef;
  confidence: number;
  importance?: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  supersedes?: string;
  supersededBy?: string;
  conflictWith?: string[];
}

export interface MemoryQuery {
  companyId: string;
  subject?: string;
  types?: MemoryType[];
  scopes?: Array<{ scope: MemoryScope; scopeId?: string }>;
  text?: string;
  limit?: number;
  now?: string;
}

export interface SkillDefinition {
  skillId: string;
  version: string;
  description: string;
  instructions: string;
  tags?: string[];
  applicableRoles?: string[];
  applicableDomains?: string[];
  capabilityRequirements?: string[];
  toolRequirements?: string[];
  provenance: ProvenanceRef;
  lifecycle: "draft" | "active" | "deprecated" | "retired";
  enabled: boolean;
  companyId?: string;
}

export interface ContextRequest {
  companyId: string;
  agentId?: string;
  teamId?: string;
  workId?: string;
  conversationId?: string;
  objective?: string;
  entitySubjects?: string[];
  memoryLimit?: number;
  skillLimit?: number;
}

export interface BoundedAgentContext {
  companyId: string;
  memories: MemoryRecord[];
  skills: SkillDefinition[];
  // Canonical business state, evidence and authority are deliberately not
  // represented as memory. Runtime owners attach those through their own contracts.
}

export interface MemoryKnowledgePort {
  writeMemory(record: MemoryRecord): Promise<void>;
  retrieveMemory(query: MemoryQuery): Promise<MemoryRecord[]>;
  deleteMemory(companyId: string, memoryId: string): Promise<boolean>;
  getRelevantSkills(companyId: string, objective: string, limit?: number): Promise<SkillDefinition[]>;
  registerSkill(skill: SkillDefinition): Promise<void>;
  assembleContext(request: ContextRequest): Promise<BoundedAgentContext>;
}

const SOURCE_CONFIDENCE_CEILING: Record<KnowledgeSource, number> = {
  user: 0.95,
  business_state: 1,
  document: 0.9,
  email: 0.9,
  tool: 0.9,
  external_api: 0.85,
  agent_inference: 0.55,
  model_output: 0.4,
  verified_evidence: 1,
};

export function applyMemoryWritePolicy(record: MemoryRecord): MemoryRecord {
  if (!record.companyId) throw new Error("company_id is required");
  if (!record.memoryId) throw new Error("memory_id is required");
  if (!record.content.trim()) throw new Error("memory content is required");
  const ceiling = SOURCE_CONFIDENCE_CEILING[record.provenance.source];
  const confidence = Math.max(0, Math.min(record.confidence, ceiling));
  return { ...record, confidence };
}

function words(value: string): Set<string> {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((v) => v.length > 2));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let hits = 0;
  for (const value of a) if (b.has(value)) hits++;
  return hits / Math.max(a.size, b.size);
}

/**
 * Local-first reference implementation. Agent 1 may replace persistence with
 * the canonical SQLite adapter without changing this port.
 */
export class LocalMemoryKnowledgeStore implements MemoryKnowledgePort {
  private memories = new Map<string, MemoryRecord>();
  private skills = new Map<string, SkillDefinition>();

  async writeMemory(input: MemoryRecord): Promise<void> {
    const record = applyMemoryWritePolicy(input);
    const existing = this.memories.get(record.memoryId);
    if (existing && existing.companyId !== record.companyId) throw new Error("cross-company memory write denied");
    if (record.supersedes) {
      const previous = this.memories.get(record.supersedes);
      if (previous) {
        if (previous.companyId !== record.companyId) throw new Error("cross-company supersession denied");
        this.memories.set(previous.memoryId, { ...previous, supersededBy: record.memoryId, updatedAt: record.updatedAt });
      }
    }
    this.memories.set(record.memoryId, record);
  }

  async retrieveMemory(query: MemoryQuery): Promise<MemoryRecord[]> {
    if (!query.companyId) throw new Error("company_id is required");
    const now = Date.parse(query.now ?? new Date().toISOString());
    const queryWords = words(query.text ?? "");
    return [...this.memories.values()]
      .filter((m) => m.companyId === query.companyId)
      .filter((m) => !m.supersededBy)
      .filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > now)
      .filter((m) => !query.subject || m.subject === query.subject)
      .filter((m) => !query.types?.length || query.types.includes(m.type))
      .filter((m) => !query.scopes?.length || query.scopes.some((s) => s.scope === m.scope && (s.scopeId === undefined || s.scopeId === m.scopeId)))
      .map((m) => ({ record: m, relevance: queryWords.size ? overlap(queryWords, words(`${m.subject} ${m.content}`)) : 0 }))
      .sort((a, b) => (b.relevance - a.relevance) || (b.record.confidence - a.record.confidence) || Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt))
      .slice(0, Math.max(1, query.limit ?? 12))
      .map((x) => x.record);
  }

  async deleteMemory(companyId: string, memoryId: string): Promise<boolean> {
    const record = this.memories.get(memoryId);
    if (!record || record.companyId !== companyId) return false;
    return this.memories.delete(memoryId);
  }

  async registerSkill(skill: SkillDefinition): Promise<void> {
    if (skill.companyId === "") throw new Error("company_id cannot be empty");
    this.skills.set(`${skill.companyId ?? "global"}:${skill.skillId}:${skill.version}`, skill);
  }

  async getRelevantSkills(companyId: string, objective: string, limit = 6): Promise<SkillDefinition[]> {
    if (!companyId) throw new Error("company_id is required");
    const q = words(objective);
    return [...this.skills.values()]
      .filter((s) => s.enabled && s.lifecycle === "active" && (!s.companyId || s.companyId === companyId))
      .map((s) => ({ skill: s, relevance: overlap(q, words(`${s.skillId} ${s.description} ${(s.tags ?? []).join(" ")}`)) }))
      .filter((x) => x.relevance > 0 || q.size === 0)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, Math.max(1, limit))
      .map((x) => x.skill);
  }

  async assembleContext(request: ContextRequest): Promise<BoundedAgentContext> {
    const scopes: MemoryQuery["scopes"] = [{ scope: "company", scopeId: request.companyId }];
    if (request.agentId) scopes.push({ scope: "agent", scopeId: request.agentId });
    if (request.teamId) scopes.push({ scope: "team", scopeId: request.teamId });
    if (request.workId) scopes.push({ scope: "task", scopeId: request.workId });
    if (request.conversationId) scopes.push({ scope: "conversation", scopeId: request.conversationId });
    for (const entity of request.entitySubjects ?? []) {
      scopes.push({ scope: "customer", scopeId: entity }, { scope: "site", scopeId: entity }, { scope: "service", scopeId: entity });
    }
    const memories = await this.retrieveMemory({ companyId: request.companyId, scopes, text: request.objective, limit: request.memoryLimit ?? 12 });
    const skills = await this.getRelevantSkills(request.companyId, request.objective ?? "", request.skillLimit ?? 6);
    return { companyId: request.companyId, memories, skills };
  }
}

// Invariant: this module intentionally contains no authority grant, execution
// permission, decision approval, or tool invocation primitive. Memory and skills
// can inform reasoning only; Titan's canonical authority system remains sovereign.
