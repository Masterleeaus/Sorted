// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/interpretation.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { createInteractionContext, createEntity, createGoal, createCapabilityRequirement, createAmbiguity, INTERACTION_SCHEMA_VERSION } from "./contracts.js";

function freezeRecord(value, label) {
  if (value == null) return Object.freeze({});
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}-object-required`);
  rejectLegacyTenantAuthority(value, label);
  return Object.freeze({ ...value });
}

export function createInteractionInterpretation(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("interaction-interpretation-object-required");
  rejectLegacyTenantAuthority(input, "interaction-interpretation");
  const context = createInteractionContext(input.context ?? input);
  const company_id = assertCanonicalCompanyId(input.company_id ?? context.company_id);
  if (company_id !== context.company_id) throw new TypeError("interaction-context-company-mismatch");
  const intent = typeof input.intent === "string" ? { name: input.intent } : (input.intent ?? {});
  rejectLegacyTenantAuthority(intent, "interaction-intent");
  const intentName = String(intent.name ?? intent.intent ?? "unknown").trim();
  if (!intentName) throw new TypeError("interaction-intent-required");
  const confidence = intent.confidence === undefined ? 1 : Number(intent.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new TypeError("interaction-intent-confidence-invalid");
  const normalized = String(input.normalized ?? input.normalized_text ?? input.message ?? "").trim();
  return Object.freeze({
    schema: "titan.interaction.interpretation.v1",
    schema_version: INTERACTION_SCHEMA_VERSION,
    company_id,
    context,
    normalized,
    intent: Object.freeze({ name: intentName, confidence, source: intent.source ?? "deterministic" }),
    goals: Object.freeze((input.goals ?? []).map(createGoal)),
    entities: Object.freeze((input.entities ?? []).map(createEntity)),
    preferences: freezeRecord(input.preferences, "interaction-preferences"),
    ambiguities: Object.freeze((input.ambiguities ?? []).map(createAmbiguity)),
    capability_requirements: Object.freeze((input.capability_requirements ?? []).map(createCapabilityRequirement)),
    delegation: input.delegation ? freezeRecord(input.delegation, "interaction-delegation") : null,
    needs_clarification: Boolean(input.needs_clarification ?? (input.ambiguities ?? []).some((item) => item?.blocking !== false)),
    authority_neutral: true,
    execution_authority: false,
  });
}

export function interpretationRequiresDecision(interpretation) {
  const packet = createInteractionInterpretation(interpretation);
  return packet.goals.length > 0 || packet.capability_requirements.length > 0;
}
