import {
  applyMemoryWritePolicy,
  type KnowledgeSource,
  type MemoryKnowledgePort,
  type MemoryRecord,
  type MemoryScope,
  type MemoryType,
  type ProvenanceRef,
} from "./memory-knowledge.js";

export interface MemoryIngestionCandidate {
  companyId: string;
  subject: string;
  type: MemoryType;
  scope: MemoryScope;
  scopeId?: string;
  content: string;
  source: KnowledgeSource;
  sourceId?: string;
  observedAt: string;
  evidenceRefs?: string[];
  confidence: number;
  importance?: number;
  expiresAt?: string;
}

export type IngestionDisposition = "created" | "duplicate" | "superseded" | "rejected";

export interface MemoryIngestionResult {
  disposition: IngestionDisposition;
  memory?: MemoryRecord;
  duplicateOf?: string;
  reason?: string;
}

export interface MemoryIdFactory {
  create(companyId: string, fingerprint: string): string;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function hash(value: string): string {
  // Deterministic, dependency-free FNV-1a. This is an identity fingerprint,
  // not a security primitive and contains no tenant data outside its company key.
  let result = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

export function memoryFingerprint(candidate: MemoryIngestionCandidate): string {
  if (!candidate.companyId) throw new Error("company_id is required");
  return hash([
    candidate.companyId,
    candidate.subject,
    candidate.type,
    candidate.scope,
    candidate.scopeId ?? "",
    normalizeText(candidate.content),
  ].join("\u001f"));
}

export const deterministicMemoryIdFactory: MemoryIdFactory = {
  create(companyId, fingerprint) {
    return `mem_${hash(companyId)}_${fingerprint}`;
  },
};

function provenanceOf(candidate: MemoryIngestionCandidate): ProvenanceRef {
  return {
    source: candidate.source,
    sourceId: candidate.sourceId,
    observedAt: candidate.observedAt,
    evidenceRefs: candidate.evidenceRefs,
  };
}

function validate(candidate: MemoryIngestionCandidate): string | undefined {
  if (!candidate.companyId) return "company_id is required";
  if (!candidate.subject.trim()) return "subject is required";
  if (!candidate.content.trim()) return "content is required";
  if (!Number.isFinite(Date.parse(candidate.observedAt))) return "observed_at must be a valid timestamp";
  if (candidate.expiresAt && !Number.isFinite(Date.parse(candidate.expiresAt))) return "expires_at must be a valid timestamp";
  if (candidate.confidence < 0 || candidate.confidence > 1) return "confidence must be between 0 and 1";
  return undefined;
}

function sameIdentity(a: MemoryRecord, b: MemoryIngestionCandidate): boolean {
  return a.companyId === b.companyId &&
    a.subject === b.subject &&
    a.type === b.type &&
    a.scope === b.scope &&
    (a.scopeId ?? "") === (b.scopeId ?? "");
}

function sourceIdentityMatches(record: MemoryRecord, candidate: MemoryIngestionCandidate): boolean {
  return Boolean(candidate.sourceId) &&
    record.provenance.source === candidate.source &&
    record.provenance.sourceId === candidate.sourceId;
}

/**
 * Governed ingestion facade. It creates memory candidates only; it never writes
 * canonical business state, evidence, decisions, permissions or authority.
 */
export class MemoryIngestionPipeline {
  constructor(
    private readonly store: MemoryKnowledgePort,
    private readonly ids: MemoryIdFactory = deterministicMemoryIdFactory,
  ) {}

  async ingest(candidate: MemoryIngestionCandidate): Promise<MemoryIngestionResult> {
    const invalid = validate(candidate);
    if (invalid) return { disposition: "rejected", reason: invalid };

    const fingerprint = memoryFingerprint(candidate);
    const existing = await this.store.retrieveMemory({
      companyId: candidate.companyId,
      subject: candidate.subject,
      types: [candidate.type],
      scopes: [{ scope: candidate.scope, scopeId: candidate.scopeId }],
      limit: 100,
      now: candidate.observedAt,
    });

    const duplicate = existing.find((record) =>
      sourceIdentityMatches(record, candidate) ||
      (sameIdentity(record, candidate) && normalizeText(record.content) === normalizeText(candidate.content)),
    );
    if (duplicate) {
      return { disposition: "duplicate", duplicateOf: duplicate.memoryId, memory: duplicate };
    }

    // Same subject/type/scope but newer materially different content is treated
    // as a correction candidate only when it is at least as trustworthy as the
    // current memory. Lower-confidence contradictions remain separate candidates
    // for later Knowledge Authority conflict handling rather than silently winning.
    const previous = existing
      .filter((record) => sameIdentity(record, candidate))
      .sort((a, b) => Date.parse(b.provenance.observedAt) - Date.parse(a.provenance.observedAt))[0];

    const createdAt = candidate.observedAt;
    let record: MemoryRecord = {
      memoryId: this.ids.create(candidate.companyId, fingerprint),
      companyId: candidate.companyId,
      subject: candidate.subject,
      type: candidate.type,
      scope: candidate.scope,
      scopeId: candidate.scopeId,
      content: candidate.content.trim(),
      provenance: provenanceOf(candidate),
      confidence: candidate.confidence,
      importance: candidate.importance,
      createdAt,
      updatedAt: createdAt,
      expiresAt: candidate.expiresAt,
    };
    record = applyMemoryWritePolicy(record);

    if (previous && Date.parse(candidate.observedAt) >= Date.parse(previous.provenance.observedAt) && record.confidence >= previous.confidence) {
      record = { ...record, supersedes: previous.memoryId };
      await this.store.writeMemory(record);
      return { disposition: "superseded", memory: record };
    }

    if (previous) {
      record = { ...record, conflictWith: [previous.memoryId] };
    }
    await this.store.writeMemory(record);
    return { disposition: "created", memory: record };
  }

  async ingestMany(candidates: MemoryIngestionCandidate[]): Promise<MemoryIngestionResult[]> {
    const results: MemoryIngestionResult[] = [];
    for (const candidate of candidates) results.push(await this.ingest(candidate));
    return results;
  }
}
