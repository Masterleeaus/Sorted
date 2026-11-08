// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/state.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "./contracts.js";

function base(input, kind) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${kind}-state-object-required`);
  rejectLegacyTenantAuthority(input, `${kind}-state`);
  return { company_id: assertCanonicalCompanyId(input.company_id), surface: canonicalSurface(input.surface ?? "zero") };
}

export function createConversationState(input) {
  const common = base(input, "conversation");
  const conversation_id = String(input.conversation_id ?? "").trim();
  if (!conversation_id) throw new TypeError("conversation-id-required");
  return Object.freeze({
    schema: "titan.interaction.conversation-state.v1",
    ...common,
    conversation_id,
    turn: Math.max(0, Number(input.turn ?? 0)),
    status: input.status ?? "active",
    last_intent: input.last_intent ?? null,
    memory_refs: Object.freeze([...(input.memory_refs ?? [])]),
    updated_at: input.updated_at ?? null,
    authority_neutral: true,
  });
}

export function createJourneyState(input) {
  const common = base(input, "journey");
  const journey_id = String(input.journey_id ?? "").trim();
  if (!journey_id) throw new TypeError("journey-id-required");
  const wizard_ids = [...(input.wizard_ids ?? input.wizards ?? [])].map(String).filter(Boolean);
  return Object.freeze({
    schema: "titan.interaction.journey-state.v1",
    ...common,
    journey_id,
    name: input.name ?? journey_id,
    wizard_ids: Object.freeze(wizard_ids),
    current_wizard_id: input.current_wizard_id ?? wizard_ids[0] ?? null,
    current_step: Math.max(0, Number(input.current_step ?? 0)),
    prerequisites: Object.freeze([...(input.prerequisites ?? [])]),
    requirements: Object.freeze([...(input.requirements ?? [])]),
    status: input.status ?? "active",
    authority_neutral: true,
  });
}
