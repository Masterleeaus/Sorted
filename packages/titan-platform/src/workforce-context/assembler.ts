import {
  createWorkforceContextContract,
  type WorkforceAuthorityProvenance,
  type WorkforceContextContract,
  type WorkforceContextRecordRef,
  type WorkforceContextSourceKind,
} from "./contract.js";

export type WorkforceContextEntitySnapshot = Readonly<{
  id: string;
  company_id: string;
  version?: string | number | null;
  observed_at?: string | null;
  tenant_id?: never;
  tenant_company_id?: never;
}>;

export type WorkforceActorContextSnapshot = WorkforceContextEntitySnapshot & Readonly<{
  role: string;
}>;

export type AssembleWorkforceContextInput = Readonly<{
  company_id: string;
  objective_id: string;
  correlation_id?: string | null;
  task_id?: string | null;
  actor: WorkforceActorContextSnapshot;
  authority: Readonly<{
    source: string;
    revision?: string | number | null;
  }>;
  customer?: WorkforceContextEntitySnapshot | null;
  location?: WorkforceContextEntitySnapshot | null;
  job?: WorkforceContextEntitySnapshot | null;
  workflow?: WorkforceContextEntitySnapshot | null;
  tenant_id?: never;
  tenant_company_id?: never;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function assertNoLegacyTenantAlias(input: object, field: string): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError(`${field} cannot use legacy tenant aliases`);
  }
}

function toSourceRef(
  expectedCompanyId: string,
  kind: WorkforceContextSourceKind,
  snapshot: WorkforceContextEntitySnapshot,
): WorkforceContextRecordRef {
  assertNoLegacyTenantAlias(snapshot, kind);
  const id = requireNonEmpty(snapshot.id, `${kind}.id`);
  const companyId = requireNonEmpty(snapshot.company_id, `${kind}.company_id`);
  if (companyId !== expectedCompanyId) {
    throw new TypeError(`${kind}.company_id does not match workforce context company_id`);
  }
  return Object.freeze({
    kind,
    id,
    version: snapshot.version ?? null,
    observed_at: snapshot.observed_at ?? null,
  });
}

/**
 * Assemble a bounded workforce context from canonical business-record snapshots.
 * This function deliberately emits references + provenance only. It does not copy
 * customer/job/location/workflow payloads into a second memory database and it
 * never treats actor identity as execution authority.
 */
export function assembleWorkforceContext(input: AssembleWorkforceContextInput): WorkforceContextContract {
  if (!input || typeof input !== "object") throw new TypeError("workforce context assembly input is required");
  assertNoLegacyTenantAlias(input, "workforce context");

  const companyId = requireNonEmpty(input.company_id, "company_id");
  assertNoLegacyTenantAlias(input.actor, "actor");
  const actorId = requireNonEmpty(input.actor.id, "actor.id");
  const actorCompanyId = requireNonEmpty(input.actor.company_id, "actor.company_id");
  if (actorCompanyId !== companyId) {
    throw new TypeError("actor.company_id does not match workforce context company_id");
  }

  const actorRole = requireNonEmpty(input.actor.role, "actor.role");
  const authoritySource = requireNonEmpty(input.authority?.source, "authority.source");

  const sources: WorkforceContextRecordRef[] = [
    Object.freeze({ kind: "company", id: companyId, version: null, observed_at: null }),
    toSourceRef(companyId, "actor", input.actor),
  ];

  const optionalSources: ReadonlyArray<readonly [WorkforceContextSourceKind, WorkforceContextEntitySnapshot | null | undefined]> = [
    ["customer", input.customer],
    ["location", input.location],
    ["job", input.job],
    ["workflow", input.workflow],
  ];

  for (const [kind, snapshot] of optionalSources) {
    if (snapshot) sources.push(toSourceRef(companyId, kind, snapshot));
  }

  sources.push(Object.freeze({
    kind: "authority",
    id: authoritySource,
    version: input.authority.revision ?? null,
    observed_at: null,
  }));

  const authority: WorkforceAuthorityProvenance = Object.freeze({
    actor_id: actorId,
    actor_role: actorRole,
    authority_source: authoritySource,
    authority_revision: input.authority.revision ?? null,
  });

  return createWorkforceContextContract({
    company_id: companyId,
    objective_id: input.objective_id,
    correlation_id: input.correlation_id ?? null,
    task_id: input.task_id ?? null,
    sources,
    authority,
  });
}
