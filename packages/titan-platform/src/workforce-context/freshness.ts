import type { WorkforceContextContract, WorkforceContextRecordRef } from "./contract.js";
import type { WorkforceTaskCheckpoint } from "./checkpoint.js";

export const WORKFORCE_CONTEXT_FRESHNESS_SCHEMA = "titan.workforce.context-freshness/v1" as const;

export type WorkforceContextFreshnessStatus = "fresh" | "stale" | "missing" | "conflict";

export type CanonicalContextRecordVersion = Readonly<{
  kind: string;
  id: string;
  company_id: string;
  version?: string | number | null;
  observed_at?: string | null;
}>;

export type WorkforceContextFreshnessFinding = Readonly<{
  kind: string;
  id: string;
  status: WorkforceContextFreshnessStatus;
  context_version: string | number | null;
  canonical_version: string | number | null;
  reason: string;
}>;

export type WorkforceContextFreshnessReport = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_FRESHNESS_SCHEMA;
  company_id: string;
  objective_id: string;
  task_id: string | null;
  checked_at: string;
  status: "fresh" | "refresh_required" | "conflict";
  findings: readonly WorkforceContextFreshnessFinding[];
  checkpoint_revision: number | null;
  policies: Readonly<{
    fail_closed_cross_company: true;
    canonical_records_remain_source_of_truth: true;
    stale_context_must_refresh_before_write: true;
    version_conflict_never_auto_overwrites: true;
    freshness_does_not_grant_authority: true;
  }>;
}>;

export type CheckWorkforceContextFreshnessInput = Readonly<{
  context: WorkforceContextContract;
  canonical_records: readonly CanonicalContextRecordVersion[];
  checkpoint?: WorkforceTaskCheckpoint | null;
  checked_at?: string;
  tenant_id?: never;
  tenant_company_id?: never;
}>;

function requireNonEmpty(value: string, field: string): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function normalizeVersion(value: string | number | null | undefined): string | number | null {
  return value ?? null;
}

function versionsEqual(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  return String(normalizeVersion(a)) === String(normalizeVersion(b));
}

function requireIsoTimestamp(value: string | undefined): string {
  const timestamp = value ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(timestamp))) throw new TypeError("checked_at must be a valid timestamp");
  return timestamp;
}

function assertNoLegacyAliases(input: object): void {
  if ("tenant_id" in input || "tenant_company_id" in input) {
    throw new TypeError("legacy tenant aliases cannot establish freshness authority");
  }
}

function key(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * Compare bounded context references with current canonical record versions.
 * Stale/missing/conflicting references are surfaced explicitly; this function
 * never mutates canonical records and never auto-resolves version conflicts.
 */
export function checkWorkforceContextFreshness(
  input: CheckWorkforceContextFreshnessInput,
): WorkforceContextFreshnessReport {
  if (!input || typeof input !== "object") throw new TypeError("freshness input is required");
  assertNoLegacyAliases(input);
  const context = input.context;
  if (!context || typeof context !== "object") throw new TypeError("context is required");
  const companyId = requireNonEmpty(context.company_id, "context.company_id");

  if (input.checkpoint) {
    if (input.checkpoint.company_id !== companyId) throw new TypeError("checkpoint company_id mismatch");
    if ((context.task_id ?? null) !== input.checkpoint.task_id) throw new TypeError("checkpoint task_id mismatch");
  }

  const canonicalMap = new Map<string, CanonicalContextRecordVersion>();
  for (const record of input.canonical_records) {
    const id = requireNonEmpty(record.id, "canonical_record.id");
    const kind = requireNonEmpty(record.kind, "canonical_record.kind");
    const recordCompanyId = requireNonEmpty(record.company_id, "canonical_record.company_id");
    if (recordCompanyId !== companyId) {
      throw new TypeError(`canonical record ${kind}:${id} company_id mismatch`);
    }
    const recordKey = key(kind, id);
    if (canonicalMap.has(recordKey)) throw new TypeError(`duplicate canonical record version: ${recordKey}`);
    canonicalMap.set(recordKey, record);
  }

  const findings: WorkforceContextFreshnessFinding[] = [];
  let hasConflict = false;
  let requiresRefresh = false;

  for (const source of context.sources) {
    if (source.kind === "company" || source.kind === "authority") continue;
    const record = canonicalMap.get(key(source.kind, source.id));
    if (!record) {
      findings.push(Object.freeze({
        kind: source.kind,
        id: source.id,
        status: "missing",
        context_version: normalizeVersion(source.version),
        canonical_version: null,
        reason: "canonical record/version evidence missing",
      }));
      requiresRefresh = true;
      continue;
    }

    const contextVersion = normalizeVersion(source.version);
    const canonicalVersion = normalizeVersion(record.version);
    if (contextVersion === null && canonicalVersion === null) {
      findings.push(Object.freeze({ kind: source.kind, id: source.id, status: "fresh", context_version: null, canonical_version: null, reason: "unversioned reference still present" }));
      continue;
    }
    if (versionsEqual(contextVersion, canonicalVersion)) {
      findings.push(Object.freeze({ kind: source.kind, id: source.id, status: "fresh", context_version: contextVersion, canonical_version: canonicalVersion, reason: "version matches canonical record" }));
      continue;
    }

    const checkpointVersion = input.checkpoint?.source_versions.find((item) => item.kind === source.kind && item.id === source.id)?.version ?? null;
    const divergedAfterCheckpoint = checkpointVersion !== null
      && !versionsEqual(checkpointVersion, canonicalVersion)
      && !versionsEqual(checkpointVersion, contextVersion);

    if (divergedAfterCheckpoint) {
      findings.push(Object.freeze({
        kind: source.kind,
        id: source.id,
        status: "conflict",
        context_version: contextVersion,
        canonical_version: canonicalVersion,
        reason: "context and canonical record both diverged from checkpoint version",
      }));
      hasConflict = true;
    } else {
      findings.push(Object.freeze({
        kind: source.kind,
        id: source.id,
        status: "stale",
        context_version: contextVersion,
        canonical_version: canonicalVersion,
        reason: "canonical record version changed; context refresh required",
      }));
      requiresRefresh = true;
    }
  }

  return Object.freeze({
    schema: WORKFORCE_CONTEXT_FRESHNESS_SCHEMA,
    company_id: companyId,
    objective_id: context.objective_id,
    task_id: context.task_id,
    checked_at: requireIsoTimestamp(input.checked_at),
    status: hasConflict ? "conflict" : (requiresRefresh ? "refresh_required" : "fresh"),
    findings: Object.freeze(findings),
    checkpoint_revision: input.checkpoint?.checkpoint_revision ?? null,
    policies: Object.freeze({
      fail_closed_cross_company: true,
      canonical_records_remain_source_of_truth: true,
      stale_context_must_refresh_before_write: true,
      version_conflict_never_auto_overwrites: true,
      freshness_does_not_grant_authority: true,
    }),
  });
}

export function assertWorkforceContextFreshForWrite(report: WorkforceContextFreshnessReport): void {
  if (!report || typeof report !== "object") throw new TypeError("freshness report is required");
  if (report.status !== "fresh") {
    throw new TypeError(`workforce context is not fresh for write: ${report.status}`);
  }
}
