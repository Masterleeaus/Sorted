import type { WorkforceContextContract, WorkforceContextSourceKind } from "./contract.js";
import type { WorkforceContextProjection } from "./projection.js";
import type { WorkforceContextAccessAudit } from "./access.js";
import type { WorkforceContextFreshnessReport } from "./freshness.js";

export const WORKFORCE_CONTEXT_DIAGNOSTICS_SCHEMA = "titan.workforce.context-diagnostics/v1" as const;

export type WorkforceContextDiagnosticEntry = Readonly<{
  category: "source" | "field" | "freshness" | "rejection";
  source_kind: WorkforceContextSourceKind | "unknown";
  outcome: "selected" | "omitted" | "allowed" | "denied" | "fresh" | "stale" | "missing" | "conflict" | "rejected";
  reason_code: string;
}>;

export type WorkforceContextDiagnostics = Readonly<{
  schema: typeof WORKFORCE_CONTEXT_DIAGNOSTICS_SCHEMA;
  company_id_present: true;
  task_id_present: boolean;
  selected_source_count: number;
  omitted_source_count: number;
  denied_field_count: number;
  freshness_status: "unknown" | "fresh" | "refresh_required" | "conflict";
  entries: readonly WorkforceContextDiagnosticEntry[];
  policies: Readonly<{
    no_protected_values: true;
    no_record_ids: true;
    reason_codes_only: true;
    diagnostics_are_not_authority: true;
  }>;
}>;

export type BuildWorkforceContextDiagnosticsInput = Readonly<{
  context: WorkforceContextContract;
  projection?: WorkforceContextProjection | null;
  access_audit?: WorkforceContextAccessAudit | null;
  freshness?: WorkforceContextFreshnessReport | null;
  rejections?: readonly Readonly<{ source_kind?: WorkforceContextSourceKind; reason_code: string }>[];
}>;

const BUSINESS_SOURCE_KINDS: readonly WorkforceContextSourceKind[] = ["customer", "location", "job", "workflow"];

function requireReasonCode(value: string): string {
  const code = String(value ?? "").trim();
  if (!code || !/^[A-Z0-9_:-]+$/.test(code)) throw new TypeError("diagnostic reason_code must be a non-empty machine-safe code");
  return code;
}

/**
 * Build safe explainability metadata. Diagnostics intentionally omit source IDs,
 * field values, summaries, customer/job/location data and authority payloads.
 */
export function buildWorkforceContextDiagnostics(
  input: BuildWorkforceContextDiagnosticsInput,
): WorkforceContextDiagnostics {
  if (!input?.context) throw new TypeError("context is required");
  const entries: WorkforceContextDiagnosticEntry[] = [];
  const contextKinds = new Set(input.context.sources.map((source) => source.kind));
  const projectedKinds = new Set(input.projection?.sources.map((source) => source.kind) ?? []);

  let selected = 0;
  let omitted = 0;
  for (const kind of BUSINESS_SOURCE_KINDS) {
    if (!contextKinds.has(kind)) continue;
    if (projectedKinds.has(kind)) {
      selected += 1;
      entries.push(Object.freeze({ category: "source", source_kind: kind, outcome: "selected", reason_code: "SOURCE_SELECTED_BY_TASK_POLICY" }));
    } else {
      omitted += 1;
      entries.push(Object.freeze({ category: "source", source_kind: kind, outcome: "omitted", reason_code: "SOURCE_OMITTED_BY_LEAST_DATA_POLICY" }));
    }
  }

  for (const decision of input.access_audit?.decisions ?? []) {
    entries.push(Object.freeze({
      category: "field",
      source_kind: decision.source_kind as WorkforceContextSourceKind,
      outcome: decision.allowed ? "allowed" : "denied",
      reason_code: decision.allowed ? "FIELD_EXPLICITLY_PERMITTED" : "FIELD_DENIED_DEFAULT_OR_SENSITIVE",
    }));
  }

  for (const finding of input.freshness?.findings ?? []) {
    entries.push(Object.freeze({
      category: "freshness",
      source_kind: finding.kind as WorkforceContextSourceKind,
      outcome: finding.status,
      reason_code: finding.status === "fresh"
        ? "CANONICAL_VERSION_MATCH"
        : finding.status === "stale"
          ? "CANONICAL_VERSION_CHANGED"
          : finding.status === "missing"
            ? "CANONICAL_EVIDENCE_MISSING"
            : "CHECKPOINT_AND_CANONICAL_DIVERGED",
    }));
  }

  for (const rejection of input.rejections ?? []) {
    entries.push(Object.freeze({
      category: "rejection",
      source_kind: rejection.source_kind ?? "unknown",
      outcome: "rejected",
      reason_code: requireReasonCode(rejection.reason_code),
    }));
  }

  return Object.freeze({
    schema: WORKFORCE_CONTEXT_DIAGNOSTICS_SCHEMA,
    company_id_present: true,
    task_id_present: Boolean(input.context.task_id),
    selected_source_count: selected,
    omitted_source_count: omitted,
    denied_field_count: input.access_audit?.denied_fields.length ?? 0,
    freshness_status: input.freshness?.status ?? "unknown",
    entries: Object.freeze(entries),
    policies: Object.freeze({
      no_protected_values: true,
      no_record_ids: true,
      reason_codes_only: true,
      diagnostics_are_not_authority: true,
    }),
  });
}
