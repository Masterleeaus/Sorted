// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/knowledge/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "knowledge";
export const RUNTIME_NAME = "Knowledge Runtime";
export const RUNTIME_KIND = "knowledge";
export const RUNTIME_PURPOSE = "Owns local knowledge provenance, freshness and retrieval contracts; private records remain company scoped.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createKnowledgeEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
