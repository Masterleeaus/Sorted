export const WORKFORCE_CONTEXT_SCHEMA = "titan.workforce.context/v1" as const;

export const WORKFORCE_CONTEXT_SOURCE_KINDS = [
  "company",
  "actor",
  "customer",
  "location",
  "job",
  "workflow",
  "authority",
] as const;

export type WorkforceContextSourceKind = (typeof WORKFORCE_CONTEXT_SOURCE_KINDS)[number];

export type WorkforceContextRecordRef = Readonly<{
  kind: WorkforceContextSourceKind;
  id: string;
  version?: string | number | null;
  observed_at?: string | null;
}>;

export type WorkforceAuthorityProvenance = Readonly<{
  actor_id: string;
  actor_role: string;
  authority_source: string;
  authority_revision?: string | number | null;
}>;

export type WorkforceContextContract = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_SCHEMA;
  company_id: string;
  objective_id: string;
  correlation_id: string | null;
  task_id: string | null;
  sources: readonly WorkforceContextRecordRef[];
  authority: WorkforceAuthorityProvenance;
  policies: Readonly<{
    canonical_records_remain_source_of_truth: true;
    context_is_projection_not_database: true;
    context_is_not_authority: true;
    least_data_required: true;
    fail_closed_cross_company: true;
  }>;
}>;

export type CreateWorkforceContextContractInput = {
  company_id: string;
  objective_id: string;
  correlation_id?: string | null;
  task_id?: string | null;
  sources: readonly WorkforceContextRecordRef[];
  authority: WorkforceAuthorityProvenance;
  tenant_id?: never;
  tenant_company_id?: never;
};

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function assertNoLegacyTenantAuthority(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant aliases cannot establish workforce context authority");
  }
}

export function createWorkforceContextContract(
  input: CreateWorkforceContextContractInput,
): WorkforceContextContract {
  if (!input || typeof input !== "object") throw new TypeError("workforce context input is required");
  assertNoLegacyTenantAuthority(input);

  const companyId = requireNonEmpty(input.company_id, "company_id");
  const objectiveId = requireNonEmpty(input.objective_id, "objective_id");
  const actorId = requireNonEmpty(input.authority?.actor_id, "authority.actor_id");
  const actorRole = requireNonEmpty(input.authority?.actor_role, "authority.actor_role");
  const authoritySource = requireNonEmpty(input.authority?.authority_source, "authority.authority_source");

  const seen = new Set<string>();
  const sources = input.sources.map((source) => {
    if (!WORKFORCE_CONTEXT_SOURCE_KINDS.includes(source.kind)) {
      throw new TypeError(`unsupported workforce context source kind: ${String(source.kind)}`);
    }
    const id = requireNonEmpty(source.id, `sources.${source.kind}.id`);
    const key = `${source.kind}:${id}`;
    if (seen.has(key)) throw new TypeError(`duplicate workforce context source: ${key}`);
    seen.add(key);
    return Object.freeze({
      kind: source.kind,
      id,
      version: source.version ?? null,
      observed_at: source.observed_at ?? null,
    });
  });

  return Object.freeze({
    schema: WORKFORCE_CONTEXT_SCHEMA,
    company_id: companyId,
    objective_id: objectiveId,
    correlation_id: input.correlation_id ?? null,
    task_id: input.task_id ?? null,
    sources: Object.freeze(sources),
    authority: Object.freeze({
      actor_id: actorId,
      actor_role: actorRole,
      authority_source: authoritySource,
      authority_revision: input.authority.authority_revision ?? null,
    }),
    policies: Object.freeze({
      canonical_records_remain_source_of_truth: true,
      context_is_projection_not_database: true,
      context_is_not_authority: true,
      least_data_required: true,
      fail_closed_cross_company: true,
    }),
  });
}

export function assertWorkforceContextCompany(
  expectedCompanyId: string,
  context: Pick<WorkforceContextContract, "company_id">,
): string {
  const expected = requireNonEmpty(expectedCompanyId, "expected company_id");
  const actual = requireNonEmpty(context?.company_id, "context.company_id");
  if (actual !== expected) throw new TypeError("workforce context company_id mismatch");
  return actual;
}
