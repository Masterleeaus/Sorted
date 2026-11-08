// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/prime/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "prime";
export const RUNTIME_NAME = "Prime Mission Runtime";
export const RUNTIME_KIND = "mission";
export const RUNTIME_PURPOSE = "Owns durable objectives, missions, checkpoints and bounded delegation; authority remains external.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} is required`);
  return value.trim();
}

function deterministicEvidenceRefs(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError("evidence_refs must be an array");
  return Object.freeze([...new Set(value.map((item) => requiredString(item, "evidence_ref")))].sort());
}

export function createPrimeEnvelope(input) {
  const envelope = freezeEnvelope(input);
  const mission_id = requiredString(envelope.mission_id, "mission_id");
  if (!envelope.objective || typeof envelope.objective !== "object" || Array.isArray(envelope.objective)) {
    throw new TypeError("objective must be an object");
  }

  const evidence_refs = deterministicEvidenceRefs(envelope.evidence_refs);
  return Object.freeze({
    ...envelope,
    mission_id,
    ...(evidence_refs ? { evidence_refs } : {}),
    runtime_id: RUNTIME_ID,
    runtime_kind: RUNTIME_KIND,
    authority_neutral: true,
    execution_authority: false,
    mission_is_authority: false,
    authority_conferred_by_activation: false,
    command_bus_required: true,
    governance_required: true,
    authority_check_required: true,
  });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID,
  name: RUNTIME_NAME,
  kind: RUNTIME_KIND,
  purpose: RUNTIME_PURPOSE,
  authority_neutral: true,
  execution_authority: false,
  mission_is_authority: false,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
  command_bus_required: true,
  governance_required: true,
  authority_check_required: true,
});
