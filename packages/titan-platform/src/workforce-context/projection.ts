import {
  assertWorkforceContextCompany,
  type WorkforceContextContract,
  type WorkforceContextSourceKind,
} from "./contract.js";

export type WorkforceContextFieldGrant = Readonly<{
  source_kind: WorkforceContextSourceKind;
  fields: readonly string[];
}>;

export type WorkforceContextProjectionPolicy = Readonly<{
  company_id: string;
  task_id: string;
  worker_id: string;
  purpose: string;
  allowed_sources: readonly WorkforceContextSourceKind[];
  field_grants: readonly WorkforceContextFieldGrant[];
}>;

export type WorkforceContextProjection = Readonly<{
  schema: "titan.workforce.context-projection/v1";
  company_id: string;
  task_id: string;
  worker_id: string;
  purpose: string;
  objective_id: string;
  correlation_id: string | null;
  sources: WorkforceContextContract["sources"];
  field_grants: readonly WorkforceContextFieldGrant[];
  authority: WorkforceContextContract["authority"];
  policies: Readonly<{
    default_deny: true;
    least_data_required: true;
    no_implicit_identity_access: true;
    canonical_records_remain_source_of_truth: true;
    projection_is_not_authority: true;
  }>;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeFields(fields: readonly string[], kind: WorkforceContextSourceKind): readonly string[] {
  const out = [...new Set(fields.map((field) => requireNonEmpty(field, `field_grants.${kind}.field`)))].sort();
  if (out.includes("*") || out.includes("all")) {
    throw new TypeError(`wildcard field grants are not allowed for ${kind}`);
  }
  return Object.freeze(out);
}

/**
 * Project a canonical workforce context down to the least data required for one
 * bounded worker task. The result contains source references plus explicit field
 * grants only; it never copies canonical business payloads or grants authority.
 */
export function projectWorkforceContextForTask(
  context: WorkforceContextContract,
  policy: WorkforceContextProjectionPolicy,
): WorkforceContextProjection {
  if (!context || typeof context !== "object") throw new TypeError("workforce context is required");
  if (!policy || typeof policy !== "object") throw new TypeError("projection policy is required");

  const companyId = requireNonEmpty(policy.company_id, "company_id");
  assertWorkforceContextCompany(companyId, context);

  const taskId = requireNonEmpty(policy.task_id, "task_id");
  const workerId = requireNonEmpty(policy.worker_id, "worker_id");
  const purpose = requireNonEmpty(policy.purpose, "purpose");
  if (context.task_id && context.task_id !== taskId) {
    throw new TypeError("projection task_id does not match workforce context task_id");
  }

  const allowedSourceSet = new Set<WorkforceContextSourceKind>([
    "company",
    "actor",
    "authority",
    ...policy.allowed_sources,
  ]);

  const projectedSources = Object.freeze(
    context.sources.filter((source) => allowedSourceSet.has(source.kind)),
  );

  const availableKinds = new Set(projectedSources.map((source) => source.kind));
  const grantKinds = new Set<WorkforceContextSourceKind>();
  const grants = policy.field_grants.map((grant) => {
    if (!availableKinds.has(grant.source_kind)) {
      throw new TypeError(`field grant references unavailable source kind: ${grant.source_kind}`);
    }
    if (grantKinds.has(grant.source_kind)) {
      throw new TypeError(`duplicate field grant for source kind: ${grant.source_kind}`);
    }
    grantKinds.add(grant.source_kind);
    return Object.freeze({
      source_kind: grant.source_kind,
      fields: normalizeFields(grant.fields, grant.source_kind),
    });
  });

  return Object.freeze({
    schema: "titan.workforce.context-projection/v1",
    company_id: companyId,
    task_id: taskId,
    worker_id: workerId,
    purpose,
    objective_id: context.objective_id,
    correlation_id: context.correlation_id,
    sources: projectedSources,
    field_grants: Object.freeze(grants),
    authority: context.authority,
    policies: Object.freeze({
      default_deny: true,
      least_data_required: true,
      no_implicit_identity_access: true,
      canonical_records_remain_source_of_truth: true,
      projection_is_not_authority: true,
    }),
  });
}
