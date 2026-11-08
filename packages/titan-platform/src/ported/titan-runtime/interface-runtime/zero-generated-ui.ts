import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "../interaction-engine/contracts.js";

export const ZERO_GENERATED_UI_SCHEMA = "titan.zero.generated-ui.v1";
const KINDS = new Set(["decision","customer","job","schedule","invoice","comparison","table","timeline","confirmation","form","status","progress","evidence","workforce"]);
const AUTHORITY_MODES = new Set(["recommend","prepare","approve_execute","report_executed"]);

function safe(value: unknown): unknown {
  if (value == null || ["string","number","boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.slice(0, 100).map(safe));
  if (typeof value === "object") {
    rejectLegacyTenantAuthority(value as Record<string, unknown>, "zero-generated-ui");
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (/^(html|innerHTML|script|javascript|execute|eval|credential|password|secret|token|api[_-]?key)$/i.test(key)) continue;
      out[key] = safe(child);
    }
    return Object.freeze(out);
  }
  return String(value);
}

export function createZeroGeneratedUI(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("zero-generated-ui-object-required");
  rejectLegacyTenantAuthority(input, "zero-generated-ui");
  const company_id = assertCanonicalCompanyId(input.company_id);
  const surface = canonicalSurface(input.surface ?? "zero");
  if (surface !== "zero") throw new TypeError("zero-generated-ui-surface-required");
  const component_id = String(input.component_id ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  if (!component_id) throw new TypeError("zero-generated-ui-component-id-required");
  if (!KINDS.has(kind)) throw new TypeError("zero-generated-ui-kind-not-allowed");
  const actions = Object.freeze((input.actions ?? []).slice(0, 8).map((action: any) => {
    const intent = String(action?.intent ?? "").trim();
    const authority_mode = String(action?.authority_mode ?? "recommend");
    if (!intent) throw new TypeError("zero-generated-ui-action-intent-required");
    if (!AUTHORITY_MODES.has(authority_mode)) throw new TypeError("zero-generated-ui-authority-mode-invalid");
    if (action?.execute === true || action?.direct_effect === true) throw new TypeError("zero-generated-ui-cannot-execute");
    return Object.freeze({ intent, label: String(action?.label ?? intent), params: safe(action?.params ?? {}), authority_mode, downstream_authorization_required: authority_mode !== "report_executed", authority_granted: false });
  }));
  return Object.freeze({ schema: ZERO_GENERATED_UI_SCHEMA, company_id, surface, component_id, kind, props: safe(input.props ?? {}), data_refs: Object.freeze((input.data_refs ?? []).slice(0, 20).map(String)), evidence_refs: Object.freeze((input.evidence_refs ?? []).slice(0, 20).map(String)), actions, authority_granted: false, executable_frontend: false });
}
