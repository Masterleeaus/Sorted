// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/outcome/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "outcome";
export const RUNTIME_NAME = "Outcome Runtime";
export const RUNTIME_KIND = "outcome";
export const RUNTIME_PURPOSE = "Owns signal, rewind, outcome and learning-event contracts; does not rewrite historical evidence.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createOutcomeEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
