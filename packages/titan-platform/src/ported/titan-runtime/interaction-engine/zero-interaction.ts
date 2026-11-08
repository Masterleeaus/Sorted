import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "./contracts.js";

export const ZERO_INTERACTION_SCHEMA = "titan.zero.interaction.v1";
const MODALITIES = new Set(["text","voice","image","camera","attachment","generated_ui_action"]);

export function createZeroInteraction(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("zero-interaction-object-required");
  rejectLegacyTenantAuthority(input, "zero-interaction");
  const company_id = assertCanonicalCompanyId(input.company_id);
  const surface = canonicalSurface(input.surface ?? "zero");
  if (surface !== "zero") throw new TypeError("zero-interaction-surface-required");
  const interaction_id = String(input.interaction_id ?? "").trim();
  const conversation_id = String(input.conversation_id ?? "").trim();
  const modality = String(input.modality ?? "text").trim();
  if (!interaction_id || !conversation_id) throw new TypeError("zero-interaction-identifiers-required");
  if (!MODALITIES.has(modality)) throw new TypeError("zero-interaction-modality-not-allowed");
  if (input.company_id !== company_id) throw new TypeError("zero-interaction-company-invalid");
  return Object.freeze({
    schema: ZERO_INTERACTION_SCHEMA,
    company_id,
    surface,
    interaction_id,
    conversation_id,
    modality,
    text: input.text == null ? null : String(input.text).slice(0, 20000),
    media_refs: Object.freeze((input.media_refs ?? []).slice(0, 12).map(String)),
    context_refs: Object.freeze((input.context_refs ?? []).slice(0, 24).map(String)),
    referent_refs: Object.freeze((input.referent_refs ?? []).slice(0, 12).map(String)),
    generated_action: input.generated_action == null ? null : Object.freeze({ intent: String(input.generated_action.intent ?? ""), params: input.generated_action.params ?? {} }),
    authority_neutral: true,
    authority_granted: false,
    execution_authority: false,
  });
}
