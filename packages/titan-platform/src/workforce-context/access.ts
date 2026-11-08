import type { WorkforceContextProjection, WorkforceContextFieldGrant } from "./projection.js";

export const WORKFORCE_CONTEXT_ACCESS_SCHEMA = "titan.workforce.context-access/v1" as const;

export type WorkforceContextPermissionDecision = Readonly<{
  source_kind: string;
  field: string;
  allowed: boolean;
  reason: string;
}>;

export type WorkforceContextAccessAudit = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_ACCESS_SCHEMA;
  company_id: string;
  task_id: string;
  worker_id: string;
  permission_source: string;
  permission_revision: string | number | null;
  decisions: readonly WorkforceContextPermissionDecision[];
  denied_fields: readonly Readonly<{ source_kind: string; field: string }>[];
  audited_at: string;
  policies: Readonly<{
    default_deny: true;
    redact_denied_fields: true;
    identity_is_not_permission: true;
    audit_contains_no_protected_values: true;
    access_is_not_authority: true;
  }>;
}>;

export type WorkforceContextPermissionSet = Readonly<{
  company_id: string;
  worker_id: string;
  source: string;
  revision?: string | number | null;
  grants: readonly WorkforceContextFieldGrant[];
  sensitive_fields?: readonly Readonly<{ source_kind: string; fields: readonly string[] }>[];
}>;

export type WorkforceContextAccessResult = Readonly<{
  projection: WorkforceContextProjection;
  effective_field_grants: readonly WorkforceContextFieldGrant[];
  audit: WorkforceContextAccessAudit;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function requireIso(value?: string): string {
  const v = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(v))) throw new TypeError("audited_at must be a valid timestamp");
  return v;
}

function setFor(entries: readonly WorkforceContextFieldGrant[], kind: string): Set<string> {
  const match = entries.find((entry) => entry.source_kind === kind);
  return new Set(match?.fields ?? []);
}

/**
 * Intersect a task projection with explicit permission grants. Denied fields are
 * removed and only field names/reasons are recorded in the audit; protected
 * business values never enter the access audit.
 */
export function applyWorkforceContextPermissions(
  projection: WorkforceContextProjection,
  permissions: WorkforceContextPermissionSet,
  auditedAt?: string,
): WorkforceContextAccessResult {
  if (!projection || typeof projection !== "object") throw new TypeError("projection is required");
  if (!permissions || typeof permissions !== "object") throw new TypeError("permissions are required");
  const companyId = requireNonEmpty(permissions.company_id, "permissions.company_id");
  const workerId = requireNonEmpty(permissions.worker_id, "permissions.worker_id");
  if (companyId !== projection.company_id) throw new TypeError("permissions company_id mismatch");
  if (workerId !== projection.worker_id) throw new TypeError("permissions worker_id mismatch");
  const permissionSource = requireNonEmpty(permissions.source, "permissions.source");

  const sensitiveByKind = new Map<string, Set<string>>();
  for (const entry of permissions.sensitive_fields ?? []) {
    sensitiveByKind.set(entry.source_kind, new Set(entry.fields.map((field) => requireNonEmpty(field, "sensitive field"))));
  }

  const decisions: WorkforceContextPermissionDecision[] = [];
  const denied: Array<Readonly<{ source_kind: string; field: string }>> = [];
  const effective: WorkforceContextFieldGrant[] = [];

  for (const requested of projection.field_grants) {
    const permissionFields = setFor(permissions.grants, requested.source_kind);
    const sensitive = sensitiveByKind.get(requested.source_kind) ?? new Set<string>();
    const allowedFields: string[] = [];

    for (const field of requested.fields) {
      const explicitlyAllowed = permissionFields.has(field);
      const allowed = explicitlyAllowed;
      const reason = allowed
        ? (sensitive.has(field) ? "explicit sensitive-field permission" : "explicit permission")
        : (sensitive.has(field) ? "sensitive field denied without explicit permission" : "field denied by default");
      decisions.push(Object.freeze({ source_kind: requested.source_kind, field, allowed, reason }));
      if (allowed) allowedFields.push(field);
      else denied.push(Object.freeze({ source_kind: requested.source_kind, field }));
    }

    if (allowedFields.length) {
      effective.push(Object.freeze({ source_kind: requested.source_kind, fields: Object.freeze(allowedFields) }));
    }
  }

  const audit: WorkforceContextAccessAudit = Object.freeze({
    schema: WORKFORCE_CONTEXT_ACCESS_SCHEMA,
    company_id: projection.company_id,
    task_id: projection.task_id,
    worker_id: projection.worker_id,
    permission_source: permissionSource,
    permission_revision: permissions.revision ?? null,
    decisions: Object.freeze(decisions),
    denied_fields: Object.freeze(denied),
    audited_at: requireIso(auditedAt),
    policies: Object.freeze({
      default_deny: true,
      redact_denied_fields: true,
      identity_is_not_permission: true,
      audit_contains_no_protected_values: true,
      access_is_not_authority: true,
    }),
  });

  return Object.freeze({ projection, effective_field_grants: Object.freeze(effective), audit });
}
