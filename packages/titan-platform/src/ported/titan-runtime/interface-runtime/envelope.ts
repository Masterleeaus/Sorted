import { freezeEnvelope } from "../boundary.js";

export const INTERFACE_RUNTIME_ID = "interface-runtime";

export function createInterfaceRuntimeEnvelope(input: any) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({
    ...envelope,
    runtime_id: INTERFACE_RUNTIME_ID,
    runtime_kind: "presentation",
    authority_neutral: true,
    execution_authority: false,
    authority_conferred_by_activation: false,
  });
}
