// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/execution/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "execution";
export const RUNTIME_NAME = "Execution Runtime";
export const RUNTIME_KIND = "execution";
export const RUNTIME_PURPOSE = "Owns command/capability dispatch envelopes and provider receipts; providers perform effects only after authority gates.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createExecutionEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
