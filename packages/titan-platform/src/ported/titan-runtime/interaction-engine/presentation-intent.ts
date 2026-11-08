// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/presentation-intent.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "./contracts.js";

function governedAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) throw new TypeError("presentation-action-object-required");
  rejectLegacyTenantAuthority(action, "presentation-action");
  const intent = String(action.intent ?? "").trim();
  if (!intent) throw new TypeError("presentation-actions-must-be-governed-intents");
  if (action.execute === true || action.direct_effect === true) throw new TypeError("presentation-action-cannot-directly-execute");
  return Object.freeze({ ...action, intent, governed_intent: true });
}

export function createInteractionPresentationIntent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("presentation-intent-object-required");
  rejectLegacyTenantAuthority(input, "presentation-intent");
  const company_id = assertCanonicalCompanyId(input.company_id);
  const purpose = String(input.purpose ?? input.kind ?? "").trim();
  if (!purpose) throw new TypeError("presentation-intent-purpose-required");
  const presentation_id = String(input.presentation_id ?? "").trim();
  if (!presentation_id) throw new TypeError("presentation-id-required");
  const actions = Object.freeze((input.actions ?? []).map(governedAction));
  return Object.freeze({
    schema_version: "1.0",
    presentation_id,
    company_id,
    surface: canonicalSurface(input.surface),
    kind: input.kind ?? "interaction",
    payload: Object.freeze({
      schema: "titan.apps.presentation-intent.v1",
      journey: input.journey ?? input.journey_id ?? null,
      purpose,
      semantic_components: Object.freeze([...(input.semantic_components ?? input.semanticComponents ?? [])]),
      data_requirements: Object.freeze([...(input.data_requirements ?? input.dataRequirements ?? [])]),
      visual_hints: Object.freeze({ ...(input.visual_hints ?? input.visualHints ?? {}) }),
      confidence: input.confidence ?? "deterministic",
    }),
    actions,
    render_hints: Object.freeze({ ...(input.render_hints ?? {}) }),
    authority_neutral: true,
    execution_authority: false,
  });
}
