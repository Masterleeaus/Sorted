import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "../interaction-engine/contracts.js";
import { CHAT_INTERFACE_PRESENTATION_SCHEMA, CHAT_RESTORED_PRESENTATION_SCHEMA } from "../interface-runtime/chat-presentation.js";
import { createVisualRuntimeEnvelope } from "./envelope.js";

export const CHAT_VISUAL_PLAN_SCHEMA = "titan.chat.visual-plan.v1";

export function createChatVisualPlan(presentation: any, viewport: { width?: number; density?: string } = {}) {
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) throw new TypeError("chat-interface-presentation-required");
  rejectLegacyTenantAuthority(presentation, "chat-visual-plan");
  if (presentation.schema !== CHAT_INTERFACE_PRESENTATION_SCHEMA) throw new TypeError("chat-interface-presentation-schema-invalid");
  if (presentation.authority_granted !== false || presentation.authority_conferred_by_activation !== false) throw new TypeError("chat-interface-authority-invalid");
  const company_id = assertCanonicalCompanyId(presentation.company_id);
  const surface = canonicalSurface(presentation.surface);
  const width = Math.max(280, Math.min(2560, Number(viewport.width ?? 390)));
  const mode = width < 600 ? "mobile" : width < 1024 ? "tablet" : "desktop";
  const density = ["compact","comfortable"].includes(String(viewport.density)) ? String(viewport.density) : "comfortable";
  const components = Object.freeze((presentation.components ?? []).slice(0,3).map((component:any, index:number) => Object.freeze({
    component_id: String(component.component_id),
    kind: String(component.kind),
    order: index,
    responsive: Object.freeze({ mode, width, density }),
    props: component.props ?? Object.freeze({}),
    actions: Object.freeze((component.actions ?? []).map((a:any)=>Object.freeze({ ...a, authority_granted:false, downstream_authorization_required:true }))),
  })));
  return createVisualRuntimeEnvelope({
    schema: CHAT_VISUAL_PLAN_SCHEMA,
    company_id,
    surface,
    event_id: presentation.event_id,
    conversation_id: presentation.conversation_id,
    components,
    responsive: Object.freeze({ mode, width, density }),
    authority_granted: false,
    semantic_owner: "interaction-engine",
    composition_owner: "interface-runtime",
    execution_owner: "command-bus",
  });
}


export function createRestoredChatVisualPlan(presentation: any, viewport: { width?: number; density?: string } = {}) {
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) throw new TypeError("chat-restored-presentation-required");
  rejectLegacyTenantAuthority(presentation, "chat-restored-visual-plan");
  if (presentation.schema !== CHAT_RESTORED_PRESENTATION_SCHEMA) throw new TypeError("chat-restored-presentation-schema-invalid");
  if (presentation.authority_granted !== false || presentation.authority_conferred_by_activation !== false) throw new TypeError("chat-interface-authority-invalid");
  const company_id=assertCanonicalCompanyId(presentation.company_id);
  const surface=canonicalSurface(presentation.surface);
  const width=Math.max(280,Math.min(2560,Number(viewport.width ?? 390)));
  const mode=width<600?"mobile":width<1024?"tablet":"desktop";
  const density=["compact","comfortable"].includes(String(viewport.density))?String(viewport.density):"comfortable";
  const components=Object.freeze((presentation.components ?? []).slice(0,3).map((component:any,index:number)=>Object.freeze({
    component_id:String(component.component_id),kind:String(component.kind),order:index,
    responsive:Object.freeze({mode,width,density}),props:component.props ?? Object.freeze({}),
    actions:Object.freeze((component.actions ?? []).map((a:any)=>Object.freeze({...a,authority_granted:false,downstream_authorization_required:true}))),
  })));
  return createVisualRuntimeEnvelope({
    schema:"titan.chat.restored-visual-plan.v1",company_id,surface,
    conversation_id:presentation.conversation_id,revision:presentation.revision,last_sequence:presentation.last_sequence,
    components,streams:presentation.streams,responsive:Object.freeze({mode,width,density}),restored:true,
    authority_granted:false,semantic_owner:"interaction-engine",composition_owner:"interface-runtime",execution_owner:"command-bus",
  });
}
