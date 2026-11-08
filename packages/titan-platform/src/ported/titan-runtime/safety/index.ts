// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/safety/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "safety";
export const RUNTIME_NAME = "Safety Runtime";
export const RUNTIME_KIND = "safety";
export const RUNTIME_PURPOSE = "Owns risk, assurance, shield and trust-proof evaluation boundaries; may constrain or block effects.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createSafetyEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
