export const TITAN_FORGE_CONTRACT = Object.freeze({
  schema: "titan.forge.runtime/v1",
  plan_schema: "titan.forge.build-plan/v1",
  candidate_schema: "titan.forge.release-candidate/v1",
  company_boundary: "company_id",
  default_execution_class: "native",
  authority: "governed-handoff-only",
});

export type ForgeBuildStatus = "PLANNED" | "BUILDING" | "VALIDATED" | "REVIEW_REQUIRED" | "REJECTED" | "HANDOFF_READY";
export type ForgeFindingSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type ForgeBuildRequest = Readonly<{
  request_id: string;
  company_id: string;
  package_id: string;
  package_version: string;
  source_ref: string;
  source_digest: string;
  requested_at: string;
  idempotency_key: string;
  inputs: Readonly<Record<string, unknown>>;
  permissions?: Readonly<{ network?: boolean; secrets?: boolean; database?: boolean; max_bytes?: number; max_files?: number; timeout_ms?: number }>;
  preferred_provider?: "native" | "ai";
  ai_allowed?: boolean;
}>;

export type ForgePlanStep = Readonly<{ id: string; kind: "GENERATE" | "BUILD" | "TEST" | "SCAN" | "PACKAGE"; order: number; inputs_digest: string; deterministic: true }>;
export type ForgeBuildPlan = Readonly<{ schema: string; plan_id: string; request_id: string; company_id: string; steps: readonly ForgePlanStep[]; plan_digest: string; deterministic: true; provider: "native" | "ai"; authority_effect: false }>;
export type ForgeArtifact = Readonly<{ path: string; media_type: string; content: string; sha256: string; bytes: number; provenance: Readonly<{ source_ref: string; source_digest: string; generator: string }> }>;
export type ForgeFinding = Readonly<{ code: string; severity: ForgeFindingSeverity; message: string; path?: string; evidence_ref: string }>;
export type ForgePermissionPolicy = Readonly<{ network: false; secrets: false; database: false; max_bytes: number; max_files: number; timeout_ms: number }>;
export type ForgeRiskSummary = Readonly<{ level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; blocker_count: number; authority_effect: false }>;
export type ForgeTestResult = Readonly<{ name: string; status: "passed" | "failed"; evidence_ref: string }>;
export type ForgeReleaseCandidate = Readonly<{
  schema: string;
  candidate_id: string;
  request_id: string;
  company_id: string;
  package_id: string;
  package_version: string;
  status: ForgeBuildStatus;
  artifacts: readonly ForgeArtifact[];
  findings: readonly ForgeFinding[];
  sbom: readonly Readonly<{ name: string; version: string; license: string }>[];
  provenance: Readonly<{ source_ref: string; source_digest: string; plan_digest: string; input_digest: string; generated_at: string }>;
  evidence_refs: readonly string[];
  blockers: readonly string[];
  rollback: Readonly<{ supported: true; target_version: string | null }>;
  permissions: ForgePermissionPolicy;
  risk: ForgeRiskSummary;
  test_results: readonly ForgeTestResult[];
  authority_effect: false;
}>;
export type ForgeCandidateStore = Readonly<{ get: (key: string) => Promise<ForgeReleaseCandidate | null> | ForgeReleaseCandidate | null; set: (key: string, candidate: ForgeReleaseCandidate) => Promise<void> | void }>;

type ForgeGenerator = (context: Readonly<{ request: ForgeBuildRequest; plan: ForgeBuildPlan; limits: Required<NonNullable<ForgeBuildRequest["permissions"]>> }>) => Promise<readonly Readonly<{ path: string; media_type?: string; content: string }>[] | Readonly<{ path: string; media_type?: string; content: string }>[] >;
type ForgeProvider = Readonly<{ id: string; kind: "native" | "ai"; enabled?: boolean; health?: "healthy" | "degraded" | "offline"; generate: ForgeGenerator }>;

const DEFAULT_LIMITS: ForgePermissionPolicy = Object.freeze({ network: false, secrets: false, database: false, max_bytes: 1_000_000, max_files: 200, timeout_ms: 30_000 });
const SECRET_KEY = /(api[_-]?key|secret|password|token|credential|private[_-]?key|authorization|cookie)/i;
const INJECTION = /(ignore (all|previous) instructions|system message|exfiltrat|curl\s+https?:|wget\s+https?:)/i;
const LICENSE_DENY = /^(unknown|none|proprietary|gpl-3(?:\.0)?|agpl)/i;
const text = (v: unknown, code: string) => { const s = String(v ?? "").trim(); if (!s) throw new Error(code); return s; };
const clone = <T>(v: T): T => structuredClone(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v as Record<string, unknown>).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);
// Platform package code must run in browser/worker/native hosts without Node types.
// This stable digest is used for reproducibility/provenance identity; cryptographic
// signing remains the deployment/evidence owner's responsibility.
const sha = (v: unknown) => { const value = typeof v === "string" ? v : canonical(v); let left = 2166136261; let right = 16777619; for (let i = 0; i < value.length; i += 1) { const code = value.charCodeAt(i); left = Math.imul(left ^ code, 16777619); right = Math.imul(right ^ (code + i), 2246822519); } return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`; };
const freeze = <T>(v: T): T => { if (v && typeof v === "object") { for (const child of Object.values(v as Record<string, unknown>)) freeze(child); Object.freeze(v); } return v; };
const limits = (input?: ForgeBuildRequest["permissions"]) => ({ ...DEFAULT_LIMITS, ...(input ?? {}) }) as ForgePermissionPolicy;

export function createForgeBuildRequest(input: Partial<ForgeBuildRequest> & Pick<ForgeBuildRequest, "company_id" | "package_id" | "package_version" | "source_ref" | "source_digest" | "idempotency_key">): ForgeBuildRequest {
  const request = {
    request_id: text(input.request_id ?? `forge:${input.company_id}:${input.idempotency_key}`, "forge_request_id_required"),
    company_id: text(input.company_id, "forge_company_id_required"), package_id: text(input.package_id, "forge_package_id_required"),
    package_version: text(input.package_version, "forge_package_version_required"), source_ref: text(input.source_ref, "forge_source_ref_required"),
    source_digest: text(input.source_digest, "forge_source_digest_required"), requested_at: text(input.requested_at ?? new Date().toISOString(), "forge_requested_at_required"),
    idempotency_key: text(input.idempotency_key, "forge_idempotency_key_required"), inputs: clone(input.inputs ?? {}), permissions: limits(input.permissions),
    preferred_provider: input.preferred_provider ?? "native", ai_allowed: input.ai_allowed === true,
  } satisfies ForgeBuildRequest;
  if (request.permissions.network || request.permissions.secrets || request.permissions.database) throw new Error("forge_external_access_requires_governed_provider");
  assertSafeInput(request.inputs);
  return freeze(request);
}

export function planForgeBuild(request: ForgeBuildRequest): ForgeBuildPlan {
  assertRequest(request);
  const provider: "native" | "ai" = request.preferred_provider === "ai" && request.ai_allowed ? "ai" : "native";
  const inputDigest = sha({ source_digest: request.source_digest, inputs: request.inputs, package_id: request.package_id, version: request.package_version });
  const kinds: ForgePlanStep["kind"][] = ["GENERATE", "BUILD", "TEST", "SCAN", "PACKAGE"];
  const steps = kinds.map((kind, index) => ({ id: `${request.request_id}:step:${index + 1}`, kind, order: index + 1, inputs_digest: inputDigest, deterministic: true as const }));
  const body = { schema: TITAN_FORGE_CONTRACT.plan_schema, request_id: request.request_id, company_id: request.company_id, steps, provider };
  return freeze({ ...body, plan_id: `plan:${sha(body).slice(0, 24)}`, plan_digest: sha(body), deterministic: true as const, authority_effect: false as const });
}

export function selectForgeProvider(request: ForgeBuildRequest, providers: readonly ForgeProvider[] = []): ForgeProvider {
  const native: ForgeProvider = { id: "titan-native-deterministic", kind: "native", health: "healthy", generate: async ({ request }) => [{ path: "forge-manifest.json", media_type: "application/json", content: JSON.stringify({ package_id: request.package_id, version: request.package_version, source_ref: request.source_ref }, null, 2) }] };
  const eligible = [native, ...providers].filter(p => p.enabled !== false && p.health !== "offline" && (p.kind === "native" || request.ai_allowed));
  const preferred = request.preferred_provider === "ai" && request.ai_allowed ? "ai" : "native";
  return eligible.find(p => p.kind === preferred) ?? native;
}

export async function buildForgeCandidate(input: { request: ForgeBuildRequest; plan?: ForgeBuildPlan; providers?: readonly ForgeProvider[]; generator?: ForgeGenerator; cleanup?: () => Promise<void> | void; evidence?: readonly string[]; now?: () => string }): Promise<ForgeReleaseCandidate> {
  const request = assertRequest(input.request); const plan = input.plan ?? planForgeBuild(request); const provider = selectForgeProvider(request, input.providers); const run = input.generator ?? provider.generate; const max = limits(request.permissions);
  const candidateId = `candidate:${sha({ request_id: request.request_id, idempotency_key: request.idempotency_key, plan: plan.plan_digest }).slice(0, 24)}`;
  let generated: readonly Readonly<{ path: string; media_type?: string; content: string }>[] = [];
  try {
    generated = await withTimeout(run({ request, plan, limits: max }), max.timeout_ms);
    if (generated.length > max.max_files) throw new Error("forge_file_count_exceeded");
    const artifacts = generated.map(item => normalizeArtifact(item, request, provider.id));
    const findings: ForgeFinding[] = []; const sbom = [] as { name: string; version: string; license: string }[];
    for (const artifact of artifacts) findings.push(...scanArtifact(artifact));
    for (const dep of (request.inputs.dependencies as unknown[] | undefined) ?? []) { const d = dep as Record<string, unknown>; const name = text(d.name, "forge_dependency_name_required"); const version = text(d.version, "forge_dependency_version_required"); const license = text(d.license, "forge_dependency_license_required"); sbom.push({ name, version, license }); if (LICENSE_DENY.test(license)) findings.push(finding("DEPENDENCY_LICENSE_REJECTED", "HIGH", `${name}@${version} uses disallowed license ${license}`, undefined, request)); }
    const blockers = findings.filter(f => f.severity === "HIGH" || f.severity === "CRITICAL").map(f => f.code);
    const now = input.now ?? (() => new Date().toISOString());
    const riskLevel = findings.some(f => f.severity === "CRITICAL") ? "CRITICAL" as const : findings.some(f => f.severity === "HIGH") ? "HIGH" as const : findings.some(f => f.severity === "MEDIUM") ? "MEDIUM" as const : "LOW" as const;
    const candidate = { schema: TITAN_FORGE_CONTRACT.candidate_schema, candidate_id: candidateId, request_id: request.request_id, company_id: request.company_id, package_id: request.package_id, package_version: request.package_version, status: blockers.length ? "REJECTED" as const : "REVIEW_REQUIRED" as const, artifacts, findings, sbom, provenance: { source_ref: request.source_ref, source_digest: request.source_digest, plan_digest: plan.plan_digest, input_digest: sha(request.inputs), generated_at: now() }, permissions: max, risk: { level: riskLevel, blocker_count: blockers.length, authority_effect: false as const }, test_results: [{ name: "native-forge-validation", status: blockers.length ? "failed" as const : "passed" as const, evidence_ref: `forge:test:${candidateId}` }], evidence_refs: [...(input.evidence ?? []), `forge:evidence:${candidateId}`], blockers, rollback: { supported: true as const, target_version: request.inputs.previous_version ? String(request.inputs.previous_version) : null }, authority_effect: false as const };
    return freeze(candidate);
  } finally { generated = []; await input.cleanup?.(); }
}

/** Idempotency/restart boundary. A durable caller-owned store makes completed builds recoverable after process restart. */
export class ForgeBuildRuntime {
  constructor(private readonly store: ForgeCandidateStore = new InMemoryForgeCandidateStore()) {}
  async build(input: Parameters<typeof buildForgeCandidate>[0]): Promise<ForgeReleaseCandidate> {
    const key = `${input.request.company_id}:${input.request.idempotency_key}`;
    const prior = await this.store.get(key);
    if (prior) return clone(prior);
    const candidate = await buildForgeCandidate(input);
    await this.store.set(key, candidate);
    return candidate;
  }
}

class InMemoryForgeCandidateStore implements ForgeCandidateStore {
  private readonly values = new Map<string, ForgeReleaseCandidate>();
  get(key: string) { return this.values.get(key) ?? null; }
  set(key: string, candidate: ForgeReleaseCandidate) { this.values.set(key, candidate); }
}

export async function handoffForgeCandidate(input: { candidate: ForgeReleaseCandidate; gateway: { execute(request: Record<string, unknown>): Promise<Record<string, unknown>> }; decision_id: string; idempotency_key: string; company_id?: string }): Promise<Record<string, unknown>> {
  if (input.candidate.status === "REJECTED" || input.candidate.blockers.length) throw new Error("forge_candidate_blocked");
  if (input.company_id && input.company_id !== input.candidate.company_id) throw new Error("forge_cross_company");
  text(input.decision_id, "forge_decision_id_required"); text(input.idempotency_key, "forge_handoff_idempotency_required");
  const result = await input.gateway.execute({ execution_id: `forge-handoff:${input.candidate.candidate_id}`, company_id: input.candidate.company_id, decision_id: input.decision_id, capability: "forge.release-candidate.handoff", idempotency_key: input.idempotency_key, input: { candidate_id: input.candidate.candidate_id, package_id: input.candidate.package_id, package_version: input.candidate.package_version, handoff_to: ["deployment", "preview", "verification"] }, authority: { status: "approved" }, risk: { status: "approved" } });
  if (result?.state !== "VERIFIED") throw new Error("forge_handoff_unverified");
  return freeze({ ...result, authority_effect: false, promotion_allowed: false, deployment_performed: false });
}

export function planForgeRollback(candidate: ForgeReleaseCandidate) { if (!candidate.rollback.supported || !candidate.rollback.target_version) throw new Error("forge_rollback_target_missing"); return freeze({ kind: "ROLLBACK_HANDOFF", candidate_id: candidate.candidate_id, company_id: candidate.company_id, target_version: candidate.rollback.target_version, requires_governed_execution: true as const, executes: false as const }); }

function assertRequest(request: ForgeBuildRequest) { if (!request || request.company_id !== text(request.company_id, "forge_company_id_required")) throw new Error("forge_company_id_required"); assertSafeInput(request.inputs); return request; }
function assertSafeInput(value: unknown, path = "inputs"): void { if (!value || typeof value !== "object") return; for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (SECRET_KEY.test(key)) throw new Error(`forge_secret_input_forbidden:${path}.${key}`); assertSafeInput(child, `${path}.${key}`); } }
function normalizeArtifact(item: Readonly<{ path: string; media_type?: string; content: string }>, request: ForgeBuildRequest, generator: string): ForgeArtifact { const path = text(item.path, "forge_artifact_path_required"); if (path.startsWith("/") || path.includes("..") || path.includes("\\") || path.includes("\0")) throw new Error("forge_artifact_path_unsafe"); const content = String(item.content ?? ""); const bytes = new TextEncoder().encode(content).byteLength; if (!bytes || bytes > limits(request.permissions).max_bytes) throw new Error("forge_artifact_size_exceeded"); return freeze({ path, media_type: item.media_type ?? "text/plain", content, bytes, sha256: sha(content), provenance: { source_ref: request.source_ref, source_digest: request.source_digest, generator } }); }
function scanArtifact(artifact: ForgeArtifact): ForgeFinding[] { const found: ForgeFinding[] = []; if (INJECTION.test(artifact.content)) found.push({ code: "PROMPT_INJECTION_OR_HOSTILE_INSTRUCTION", severity: "CRITICAL", message: "Artifact contains a prompt-injection or exfiltration pattern", path: artifact.path, evidence_ref: `scan:${artifact.sha256}` }); if (SECRET_KEY.test(artifact.content)) found.push({ code: "SECRET_PATTERN", severity: "HIGH", message: "Artifact contains a credential-like key", path: artifact.path, evidence_ref: `scan:${artifact.sha256}` }); return found; }
function finding(code: string, severity: ForgeFindingSeverity, message: string, path: string | undefined, request: ForgeBuildRequest): ForgeFinding { return { code, severity, message, ...(path ? { path } : {}), evidence_ref: `scan:${request.request_id}:${code}` }; }
async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("forge_resource_timeout")), milliseconds); })]); } finally { if (timer) clearTimeout(timer); } }

