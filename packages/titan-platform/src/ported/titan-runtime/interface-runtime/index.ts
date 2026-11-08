// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interface-runtime/index.mjs
import { freezeEnvelope } from "../boundary.js";

export const RUNTIME_ID = "interface-runtime";
export const RUNTIME_NAME = "Interface Runtime";
export const RUNTIME_KIND = "presentation";
export const RUNTIME_PURPOSE = "Owns declarative presentation composition and contributions; never owns business meaning or action authority.";
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;

export function createInterfaceRuntimeEnvelope(input) {
  const envelope = freezeEnvelope(input);
  return Object.freeze({ ...envelope, runtime_id: RUNTIME_ID, runtime_kind: RUNTIME_KIND, authority_neutral: true, execution_authority: false, authority_conferred_by_activation: false });
}

export function createInterfaceReceipt(input: any = {}) {
  const envelope = createInterfaceRuntimeEnvelope(input);
  return Object.freeze({
    ...envelope,
    receipt_kind: "interface",
    company_id: envelope.company_id ?? null,
    authority_neutral: true,
    execution_authority: false,
    authority_conferred_by_activation: false,
  });
}

export const runtimeDescriptor = Object.freeze({
  id: RUNTIME_ID, name: RUNTIME_NAME, kind: RUNTIME_KIND, purpose: RUNTIME_PURPOSE,
  authority_conferred_by_activation: AUTHORITY_CONFERRED_BY_ACTIVATION,
});

export { createInterfaceContext, deriveInterfaceContext, hasInterfaceCapability, hasInterfaceCapabilities } from './context.js';
export { auditPresentationAccessibility, auditResponsivePresentation } from './presentation-audit.js';
export { composeObjectWorkspace } from './workspace.js';
export { resolveOfflinePolicy, createOfflineQueue, planOfflineSync, resolveOfflineConflict, validateOfflineReplay } from './offline-sync.js';
export { composeWorkingSetWorkspace } from './working-set.js';
export { createZeroGeneratedUI, ZERO_GENERATED_UI_SCHEMA } from './zero-generated-ui.js';
