// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/contracts.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";

export const CANONICAL_SURFACES = Object.freeze(["zero", "go", "hub"]);
export const INTERACTION_SCHEMA_VERSION = "1.0";
export const INTERACTION_CONFIDENCE = Object.freeze(["deterministic", "high", "medium", "low", "unknown"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label}-object-required`);
  rejectLegacyTenantAuthority(value, label);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label}-required`);
  return value.trim();
}

function confidence01(value, fallback = 1) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) throw new TypeError("confidence-must-be-between-0-and-1");
  return numeric;
}

export function canonicalSurface(surface) {
  const value = nonEmpty(surface, "surface").toLowerCase();
  const aliases = { bos: "zero", owner: "zero", manager: "zero", command: "zero", field: "go", worker: "go", customer: "hub" };
  const canonical = aliases[value] ?? value;
  if (!CANONICAL_SURFACES.includes(canonical)) throw new TypeError("interaction-canonical-surface-required");
  return canonical;
}

export function createInteractionContext(input) {
  const value = assertObject(input, "interaction-context");
  const company_id = assertCanonicalCompanyId(value.company_id);
  return Object.freeze({
    schema_version: INTERACTION_SCHEMA_VERSION,
    company_id,
    surface: canonicalSurface(value.surface ?? "zero"),
    actor_id: value.actor_id ?? null,
    device_id: value.device_id ?? null,
    operation_id: value.operation_id ?? null,
    request_id: value.request_id ?? null,
    correlation_id: value.correlation_id ?? value.operation_id ?? null,
    conversation_id: value.conversation_id ?? null,
    journey_id: value.journey_id ?? null,
    wizard_id: value.wizard_id ?? null,
    locale: value.locale ?? "en",
    channel: value.channel ?? "text",
    authority_neutral: true,
  });
}

export function createEntity(input) {
  const value = assertObject(input, "interaction-entity");
  return Object.freeze({
    name: nonEmpty(value.name, "entity-name"),
    type: nonEmpty(value.type ?? "unknown", "entity-type"),
    value: value.value ?? null,
    confidence: confidence01(value.confidence, 1),
    source: value.source ?? "interaction",
  });
}

export function createGoal(input, index = 0) {
  const value = assertObject(input, "interaction-goal");
  return Object.freeze({
    goal_id: nonEmpty(value.goal_id ?? `goal-${index + 1}`, "goal-id"),
    kind: nonEmpty(value.kind ?? "outcome", "goal-kind"),
    description: nonEmpty(value.description, "goal-description"),
    status: value.status ?? "active",
    priority: Number.isFinite(Number(value.priority)) ? Number(value.priority) : index,
  });
}

export function createCapabilityRequirement(input) {
  const value = typeof input === "string" ? { capability: input } : assertObject(input, "capability-requirement");
  return Object.freeze({
    capability: nonEmpty(value.capability, "capability"),
    operation: value.operation ? nonEmpty(value.operation, "capability-operation") : null,
    required: value.required !== false,
    offline_preferred: value.offline_preferred !== false,
    reason: value.reason ?? null,
  });
}

export function createAmbiguity(input, index = 0) {
  const value = assertObject(input, "ambiguity");
  return Object.freeze({
    ambiguity_id: nonEmpty(value.ambiguity_id ?? `ambiguity-${index + 1}`, "ambiguity-id"),
    field: nonEmpty(value.field ?? "unknown", "ambiguity-field"),
    question: nonEmpty(value.question, "ambiguity-question"),
    blocking: value.blocking !== false,
    options: Array.isArray(value.options) ? Object.freeze([...value.options]) : Object.freeze([]),
  });
}
