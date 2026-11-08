import { assembleWorkforceContext, type WorkforceContextEntitySnapshot } from "./assembler.js";
import { projectWorkforceContextForTask, type WorkforceContextFieldGrant, type WorkforceContextProjection } from "./projection.js";
import type { WorkforceTaskCheckpoint } from "./checkpoint.js";

export const WORKFORCE_CONTEXT_COMPACT_SCHEMA = "titan.workforce.context-compact/v1" as const;

export type WorkforceContextCompact = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_COMPACT_SCHEMA;
  company_id: string;
  objective_id: string;
  task_id: string;
  worker_id: string;
  purpose: string;
  correlation_id: string | null;
  source_refs: readonly Readonly<{ kind: string; id: string; version: string | number | null }>[];
  field_grants: readonly WorkforceContextFieldGrant[];
  authority: WorkforceContextProjection["authority"];
  checkpoint_revision: number | null;
  created_at: string;
  expires_at: string;
  policies: Readonly<{
    compact_contains_no_business_payload: true;
    deterministic_reconstruction: true;
    canonical_records_remain_source_of_truth: true;
    expired_context_fails_closed: true;
    compact_is_not_authority: true;
  }>;
}>;

export type CanonicalReconstructionRecord = WorkforceContextEntitySnapshot & Readonly<{
  kind: "actor" | "customer" | "location" | "job" | "workflow";
  role?: string;
}>;

function requireNonEmpty(value: string, field: string): string {
  const v = String(value ?? "").trim();
  if (!v) throw new TypeError(`${field} is required`);
  return v;
}

function requireTime(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be a valid timestamp`);
  return value;
}

function sortRefs<T extends { kind: string; id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
}

export function compactWorkforceContext(
  projection: WorkforceContextProjection,
  options: Readonly<{ created_at: string; expires_at: string; checkpoint?: WorkforceTaskCheckpoint | null }>,
): WorkforceContextCompact {
  if (!projection || typeof projection !== "object") throw new TypeError("projection is required");
  const createdAt = requireTime(options.created_at, "created_at");
  const expiresAt = requireTime(options.expires_at, "expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new TypeError("expires_at must be after created_at");
  if (options.checkpoint) {
    if (options.checkpoint.company_id !== projection.company_id) throw new TypeError("checkpoint company_id mismatch");
    if (options.checkpoint.task_id !== projection.task_id) throw new TypeError("checkpoint task_id mismatch");
    if (options.checkpoint.worker_id !== projection.worker_id) throw new TypeError("checkpoint worker_id mismatch");
  }

  const sourceRefs = sortRefs(projection.sources.map((source) => Object.freeze({
    kind: source.kind,
    id: source.id,
    version: source.version ?? null,
  })));
  const grants = [...projection.field_grants]
    .map((grant) => Object.freeze({ source_kind: grant.source_kind, fields: Object.freeze([...grant.fields].sort()) }))
    .sort((a, b) => a.source_kind.localeCompare(b.source_kind));

  return Object.freeze({
    schema: WORKFORCE_CONTEXT_COMPACT_SCHEMA,
    company_id: requireNonEmpty(projection.company_id, "projection.company_id"),
    objective_id: requireNonEmpty(projection.objective_id, "projection.objective_id"),
    task_id: requireNonEmpty(projection.task_id, "projection.task_id"),
    worker_id: requireNonEmpty(projection.worker_id, "projection.worker_id"),
    purpose: requireNonEmpty(projection.purpose, "projection.purpose"),
    correlation_id: projection.correlation_id ?? null,
    source_refs: Object.freeze(sourceRefs),
    field_grants: Object.freeze(grants),
    authority: projection.authority,
    checkpoint_revision: options.checkpoint?.checkpoint_revision ?? null,
    created_at: createdAt,
    expires_at: expiresAt,
    policies: Object.freeze({
      compact_contains_no_business_payload: true,
      deterministic_reconstruction: true,
      canonical_records_remain_source_of_truth: true,
      expired_context_fails_closed: true,
      compact_is_not_authority: true,
    }),
  });
}

export function assertWorkforceContextCompactActive(compact: WorkforceContextCompact, now: string): void {
  if (!compact || compact.schema !== WORKFORCE_CONTEXT_COMPACT_SCHEMA) throw new TypeError("unsupported compact context schema");
  const nowMs = Date.parse(requireTime(now, "now"));
  if (nowMs >= Date.parse(compact.expires_at)) throw new TypeError("compact workforce context expired");
}

/** Rebuild the same bounded projection from canonical record snapshots. */
export function reconstructWorkforceContext(
  compact: WorkforceContextCompact,
  canonicalRecords: readonly CanonicalReconstructionRecord[],
  now: string,
): WorkforceContextProjection {
  assertWorkforceContextCompactActive(compact, now);
  const map = new Map(canonicalRecords.map((record) => [`${record.kind}:${record.id}`, record]));
  const source = (kind: CanonicalReconstructionRecord["kind"]): CanonicalReconstructionRecord | undefined => {
    const ref = compact.source_refs.find((item) => item.kind === kind);
    if (!ref) return undefined;
    const record = map.get(`${kind}:${ref.id}`);
    if (!record) throw new TypeError(`canonical reconstruction record missing: ${kind}:${ref.id}`);
    if (record.company_id !== compact.company_id) throw new TypeError(`canonical reconstruction record company_id mismatch: ${kind}:${ref.id}`);
    if (String(record.version ?? null) !== String(ref.version ?? null)) throw new TypeError(`canonical reconstruction record version changed: ${kind}:${ref.id}`);
    return record;
  };

  const actor = source("actor");
  if (!actor) throw new TypeError("canonical reconstruction actor missing");
  const context = assembleWorkforceContext({
    company_id: compact.company_id,
    objective_id: compact.objective_id,
    correlation_id: compact.correlation_id,
    task_id: compact.task_id,
    actor: { ...actor, role: requireNonEmpty(actor.role ?? compact.authority.actor_role, "actor.role") },
    authority: { source: compact.authority.authority_source, revision: compact.authority.authority_revision },
    customer: source("customer"),
    location: source("location"),
    job: source("job"),
    workflow: source("workflow"),
  });

  const businessKinds = compact.source_refs
    .map((ref) => ref.kind)
    .filter((kind): kind is "customer" | "location" | "job" | "workflow" => ["customer", "location", "job", "workflow"].includes(kind));

  return projectWorkforceContextForTask(context, {
    company_id: compact.company_id,
    task_id: compact.task_id,
    worker_id: compact.worker_id,
    purpose: compact.purpose,
    allowed_sources: businessKinds,
    field_grants: compact.field_grants,
  });
}
