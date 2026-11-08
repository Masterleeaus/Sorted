/** Typed, authority-neutral projection contract for canonical Workforce skills.
 * Proof construction lives beside the production Titan Workforce capability owner. */
export type DirectAdminWorkforceSkillProof = Readonly<{
  worker_id: string;
  capability_id: string;
  proficiency: number;
  proficiency_level: string;
  verification_state: string;
  proof_state: "verified" | "evidenced" | "unverified" | "expired" | "revoked";
  proof_strength: number;
  evidence_count: number;
  evidence_refs: readonly string[];
  contextual_performance_support: Readonly<{
    outcome_count: number;
    evidence_backed_count: number;
    performance_score: number | null;
    confidence: number;
  }> | null;
  contextual_performance_is_not_capability_verification: true;
  meets_registry_requirement: boolean | null;
  required_min_proficiency: number | null;
  require_verified: boolean | null;
  expired_or_revoked: boolean;
  capability_presence_confers_authority: false;
  verification_confers_authority: false;
  performance_confers_authority: false;
  grants_authority: false;
}>;

export type WorkforceEvidenceBackedSkillProof = Readonly<{
  schema: "titan.workforce.evidence-backed-skill-proof.v1";
  company_id: string;
  workers: readonly Readonly<{
    worker_id: string;
    skills: readonly DirectAdminWorkforceSkillProof[];
    summary: Readonly<{
      skill_count: number;
      verified: number;
      evidenced: number;
      unverified: number;
      expired_or_revoked: number;
      requirement_gaps: number;
    }>;
    worker_identity_confers_authority: false;
    grants_authority: false;
  }>[];
  skill_proofs: readonly DirectAdminWorkforceSkillProof[];
  summary: Readonly<{
    worker_count: number;
    skill_proof_count: number;
    verified_skill_proofs: number;
    evidenced_skill_proofs: number;
    unverified_skill_proofs: number;
    invalid_skill_proofs: number;
    requirement_gaps: number;
    workers_with_contextual_performance: number;
  }>;
  read_only: true;
  derived: true;
  performance_is_context_only: true;
  routing_decision: false;
  entitlement_decision: false;
  assignment_decision: false;
  automatic_execution: false;
  execution_permitted: false;
  grants_authority: false;
}>;

type SkillProjectionFlags = Readonly<{
  schema: "titan.directadmin.workforce-skills.v1";
  company_id: string;
  context_revision: string;
  read_only: true;
  capability_presence_confers_authority: false;
  verification_confers_authority: false;
  assignment_decision: false;
  routing_decision: false;
  entitlement_decision: false;
  execution_permitted: false;
  grants_authority: false;
}>;

export type DirectAdminWorkforceSkillsProjection =
  | (SkillProjectionFlags & Readonly<{
      status: "unavailable";
      reason: "canonical-skill-projection-unavailable";
      source: null;
      freshness: null;
      source_revision: null;
      evidence_refs: readonly string[];
    }>)
  | (SkillProjectionFlags & Readonly<{
      status: "available";
      source: "canonical-workforce-skill-capability-registry";
      freshness: string | null;
      source_revision: number | null;
      evidence_refs: readonly string[];
      projection: WorkforceEvidenceBackedSkillProof;
    }>);

export type DirectAdminWorkforceDiscovery = Readonly<{
  company_id: string;
  workers: readonly Readonly<{ company_id: string; worker_id: string; [key: string]: unknown }>[];
  controls: readonly Readonly<Record<string, unknown>>[];
  /** Absent only on older compatible hosts; new hosts always return available or unavailable. */
  skills?: DirectAdminWorkforceSkillsProjection;
}>;

export type DirectAdminWorkforceCockpitData = Readonly<{
  schema: "titan.workforce-cockpit.v1";
  company_id: string;
  discovery: DirectAdminWorkforceDiscovery;
  status: Readonly<Record<string, unknown>>;
}>;

const object = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const numericSummary = (value: unknown, keys: readonly string[]): value is Record<string, number> => object(value) &&
  exactKeys(value, keys) && Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0);
const flagsAreSafe = (value: Record<string, any>): boolean => value.read_only === true &&
  value.capability_presence_confers_authority === false && value.verification_confers_authority === false &&
  value.assignment_decision === false && value.routing_decision === false &&
  value.entitlement_decision === false && value.execution_permitted === false && value.grants_authority === false;

/** Fail closed on a stale or cross-company skill contract. A missing field is
 * handled by the caller for older hosts; a present field must be versioned. */
export function assertDirectAdminWorkforceSkillsProjection(
  value: unknown,
  expected: { company_id: string; context_revision: string; worker_ids: readonly string[] },
): asserts value is DirectAdminWorkforceSkillsProjection {
  const fail = (): never => { throw new Error("directadmin-workforce-skills-projection-invalid"); };
  if (!object(value)) fail();
  const envelope = value as Record<string, any>;
  if (envelope.schema !== "titan.directadmin.workforce-skills.v1" ||
      envelope.company_id !== expected.company_id || envelope.context_revision !== expected.context_revision ||
      !flagsAreSafe(envelope) || Object.keys(envelope).some(key => ![
        "schema", "company_id", "context_revision", "read_only", "capability_presence_confers_authority",
        "verification_confers_authority", "assignment_decision", "routing_decision", "entitlement_decision",
        "execution_permitted", "grants_authority", "status", "reason", "source", "freshness",
        "source_revision", "evidence_refs", "projection",
      ].includes(key))) fail();
  if (envelope.status === "unavailable") {
    if (!exactKeys(envelope, ["schema", "company_id", "context_revision", "read_only", "capability_presence_confers_authority",
        "verification_confers_authority", "assignment_decision", "routing_decision", "entitlement_decision",
        "execution_permitted", "grants_authority", "status", "reason", "source", "freshness", "source_revision", "evidence_refs"]) ||
        envelope.reason !== "canonical-skill-projection-unavailable" || envelope.source !== null ||
        envelope.freshness !== null || envelope.source_revision !== null || !Array.isArray(envelope.evidence_refs) ||
        envelope.evidence_refs.length !== 0 || Object.hasOwn(envelope, "projection")) fail();
    return;
  }
  if (envelope.status !== "available" || envelope.source !== "canonical-workforce-skill-capability-registry" ||
      !(envelope.freshness === null || (typeof envelope.freshness === "string" && Number.isFinite(Date.parse(envelope.freshness)))) ||
      !(envelope.source_revision === null || (Number.isSafeInteger(envelope.source_revision) && envelope.source_revision >= 0)) ||
      !Array.isArray(envelope.evidence_refs) || envelope.evidence_refs.some((ref: unknown) => !id(ref)) ||
      !object(envelope.projection)) fail();

  const proof = envelope.projection as Record<string, any>;
  if (!exactKeys(envelope, ["schema", "company_id", "context_revision", "read_only", "capability_presence_confers_authority",
      "verification_confers_authority", "assignment_decision", "routing_decision", "entitlement_decision",
      "execution_permitted", "grants_authority", "status", "source", "freshness", "source_revision", "evidence_refs", "projection"]) ||
      !exactKeys(proof, ["schema", "company_id", "workers", "skill_proofs", "summary", "read_only", "derived",
        "performance_is_context_only", "routing_decision", "entitlement_decision", "assignment_decision",
        "automatic_execution", "execution_permitted", "grants_authority"])) fail();
  const roster = new Set(expected.worker_ids);
  if (proof.schema !== "titan.workforce.evidence-backed-skill-proof.v1" || proof.company_id !== expected.company_id ||
      proof.read_only !== true || proof.derived !== true || proof.performance_is_context_only !== true ||
      proof.routing_decision !== false || proof.entitlement_decision !== false || proof.assignment_decision !== false ||
      proof.automatic_execution !== false || proof.execution_permitted !== false || proof.grants_authority !== false ||
      !Array.isArray(proof.workers) || !Array.isArray(proof.skill_proofs) || !numericSummary(proof.summary, [
        "worker_count", "skill_proof_count", "verified_skill_proofs", "evidenced_skill_proofs",
        "unverified_skill_proofs", "invalid_skill_proofs", "requirement_gaps", "workers_with_contextual_performance",
      ])) fail();

  const seenWorkers = new Set<string>();
  const workerSkillBindings = new Set<string>();
  for (const workerValue of proof.workers) {
    if (!object(workerValue)) fail();
    const worker = workerValue as Record<string, any>;
    if (!id(worker.worker_id) || !roster.has(worker.worker_id) || seenWorkers.has(worker.worker_id) ||
        !exactKeys(worker, ["worker_id", "skills", "summary", "worker_identity_confers_authority", "grants_authority"]) ||
        !Array.isArray(worker.skills) || !numericSummary(worker.summary, ["skill_count", "verified", "evidenced", "unverified", "expired_or_revoked", "requirement_gaps"]) || worker.worker_identity_confers_authority !== false ||
        worker.grants_authority !== false) fail();
    seenWorkers.add(worker.worker_id);
    for (const skill of worker.skills) {
      validateSkill(skill, worker.worker_id);
      const key = `${skill.worker_id}\u0000${skill.capability_id}`;
      if (workerSkillBindings.has(key)) fail();
      workerSkillBindings.add(key);
    }
  }
  const seenSkills = new Set<string>();
  for (const skill of proof.skill_proofs) {
    validateSkill(skill);
    const key = `${skill.worker_id}\u0000${skill.capability_id}`;
    if (seenSkills.has(key) || !workerSkillBindings.has(key)) fail();
    seenSkills.add(key);
  }
  if (seenSkills.size !== workerSkillBindings.size ||
      proof.skill_proofs.some((skill: DirectAdminWorkforceSkillProof) => !roster.has(skill.worker_id)) ||
      envelope.evidence_refs.length !== new Set(envelope.evidence_refs).size ||
      envelope.evidence_refs.some((ref: string) => !proof.skill_proofs.some((skill: DirectAdminWorkforceSkillProof) => skill.evidence_refs.includes(ref))) ||
      [...new Set(proof.skill_proofs.flatMap((skill: DirectAdminWorkforceSkillProof) => skill.evidence_refs))].some(ref => !envelope.evidence_refs.includes(ref))) fail();

  function validateSkill(skill: unknown, expectedWorker?: string): asserts skill is DirectAdminWorkforceSkillProof {
    if (!object(skill)) fail();
    const candidate = skill as Record<string, any>;
    if (!exactKeys(candidate, ["worker_id", "capability_id", "proficiency", "proficiency_level", "verification_state", "proof_state",
        "proof_strength", "evidence_count", "evidence_refs", "contextual_performance_support",
        "contextual_performance_is_not_capability_verification", "meets_registry_requirement", "required_min_proficiency",
        "require_verified", "expired_or_revoked", "capability_presence_confers_authority", "verification_confers_authority",
        "performance_confers_authority", "grants_authority"]) || !id(candidate.worker_id) || !roster.has(candidate.worker_id) ||
        (expectedWorker !== undefined && candidate.worker_id !== expectedWorker) || !id(candidate.capability_id) ||
        !finite(candidate.proficiency) || candidate.proficiency < 0 || candidate.proficiency > 5 ||
        !id(candidate.proficiency_level) || !id(candidate.verification_state) ||
        !["verified", "evidenced", "unverified", "expired", "revoked"].includes(candidate.proof_state) ||
        !finite(candidate.proof_strength) || candidate.proof_strength < 0 || candidate.proof_strength > 1 ||
        !Number.isSafeInteger(candidate.evidence_count) || candidate.evidence_count < 0 ||
        !Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.some((ref: unknown) => !id(ref)) ||
        candidate.evidence_count !== new Set(candidate.evidence_refs).size || candidate.evidence_refs.length !== new Set(candidate.evidence_refs).size ||
        candidate.contextual_performance_is_not_capability_verification !== true ||
        !(candidate.meets_registry_requirement === null || typeof candidate.meets_registry_requirement === "boolean") ||
        !(candidate.required_min_proficiency === null || (finite(candidate.required_min_proficiency) && candidate.required_min_proficiency >= 0 && candidate.required_min_proficiency <= 5)) ||
        !(candidate.require_verified === null || typeof candidate.require_verified === "boolean") ||
        typeof candidate.expired_or_revoked !== "boolean" || candidate.capability_presence_confers_authority !== false ||
        candidate.verification_confers_authority !== false || candidate.performance_confers_authority !== false ||
        candidate.grants_authority !== false) fail();
    if (candidate.contextual_performance_support !== null && (!object(candidate.contextual_performance_support) ||
        !exactKeys(candidate.contextual_performance_support, ["outcome_count", "evidence_backed_count", "performance_score", "confidence"]) ||
        !Number.isSafeInteger(candidate.contextual_performance_support.outcome_count) || candidate.contextual_performance_support.outcome_count < 0 ||
        !Number.isSafeInteger(candidate.contextual_performance_support.evidence_backed_count) || candidate.contextual_performance_support.evidence_backed_count < 0 ||
        !(candidate.contextual_performance_support.performance_score === null || finite(candidate.contextual_performance_support.performance_score)) ||
        !finite(candidate.contextual_performance_support.confidence) || candidate.contextual_performance_support.confidence < 0 || candidate.contextual_performance_support.confidence > 1)) fail();
  }
}
