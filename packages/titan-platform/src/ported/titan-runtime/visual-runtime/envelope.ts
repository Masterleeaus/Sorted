import { freezeEnvelope } from "../boundary.js";
export const VISUAL_RUNTIME_ID = "visual-runtime";
export function createVisualRuntimeEnvelope(input: any) { const envelope=freezeEnvelope(input); return Object.freeze({...envelope,runtime_id:VISUAL_RUNTIME_ID,runtime_kind:"visual",authority_conferred_by_activation:false}); }
