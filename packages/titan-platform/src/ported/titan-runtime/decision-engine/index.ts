// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/decision-engine/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "decision-engine";
export const RUNTIME_NAME = "Decision Engine";
export const RUNTIME_KIND = "decision";
export const RUNTIME_PURPOSE = "Owns evidence-backed option evaluation, prediction, ranking and selected recommendations; never directly executes browser effects.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createDecisionEngineEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_neutral: true, execution_authority: false, recommendation_is_authority: false, authority_conferred_by_activation: false });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});
