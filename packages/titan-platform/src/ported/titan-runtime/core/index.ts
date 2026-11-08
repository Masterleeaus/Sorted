// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/core/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "core";
export const RUNTIME_NAME = "Core Runtime";
export const RUNTIME_KIND = "none";
export const RUNTIME_PURPOSE = "Owns browser runtime primitives, company boundary helpers, correlation and shared lifecycle contracts.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createCoreEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
