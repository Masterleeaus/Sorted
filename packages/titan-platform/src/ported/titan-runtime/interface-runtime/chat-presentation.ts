import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "../interaction-engine/contracts.js";
import { CHAT_PROTOCOL_SCHEMA, CHAT_COMPONENT_SCHEMA } from "../interaction-engine/chat-protocol.js";
import { createInterfaceRuntimeEnvelope } from "./envelope.js";

export const CHAT_INTERFACE_PRESENTATION_SCHEMA = "titan.chat.interface-presentation.v1";

export function composeChatInterfacePresentation(event: any) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("chat-event-object-required");
  rejectLegacyTenantAuthority(event, "chat-interface-presentation");
  if (event.schema !== CHAT_PROTOCOL_SCHEMA) throw new TypeError("chat-event-schema-invalid");
  if (event.authority_granted !== false) throw new TypeError("chat-event-authority-must-be-false");
  const company_id = assertCanonicalCompanyId(event.company_id);
  const surface = canonicalSurface(event.surface);
  const components = Object.freeze((event.components ?? []).slice(0, 3).map((component: any) => {
    if (component?.schema !== CHAT_COMPONENT_SCHEMA) throw new TypeError("chat-component-schema-invalid");
    if (component?.authority_granted !== false) throw new TypeError("chat-component-authority-must-be-false");
    return Object.freeze({
      component_id: String(component.component_id),
      kind: String(component.kind),
      props: component.props ?? Object.freeze({}),
      actions: Object.freeze((component.actions ?? []).map((action: any) => {
        if (action?.authority_granted !== false || action?.downstream_authorization_required !== true) throw new TypeError("chat-action-governance-invalid");
        return Object.freeze({ ...action, authority_granted: false, downstream_authorization_required: true });
      })),
    });
  }));
  return createInterfaceRuntimeEnvelope({
    schema: CHAT_INTERFACE_PRESENTATION_SCHEMA,
    company_id,
    surface,
    event_id: String(event.event_id),
    conversation_id: String(event.conversation_id),
    event_type: String(event.type),
    text: event.text ?? null,
    components,
    correlation_id: event.correlation_id ?? null,
    authority_granted: false,
    execution_owner: "command-bus",
  });
}


export const CHAT_RESTORED_PRESENTATION_SCHEMA = "titan.chat.restored-interface-presentation.v1";

export function composeRestoredChatInterfacePresentation(snapshot: any) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw new TypeError("chat-snapshot-required");
  rejectLegacyTenantAuthority(snapshot, "chat-restored-interface-presentation");
  if (snapshot.schema !== "titan.chat.snapshot.v1") throw new TypeError("chat-snapshot-schema-invalid");
  if (snapshot.authority_granted !== false) throw new TypeError("chat-snapshot-authority-must-be-false");
  const company_id = assertCanonicalCompanyId(snapshot.company_id);
  const surface = canonicalSurface(snapshot.surface);
  const components = Object.freeze((snapshot.components ?? []).slice(0,3).map((component:any) => {
    if (component?.schema !== CHAT_COMPONENT_SCHEMA) throw new TypeError("chat-component-schema-invalid");
    if (component?.authority_granted !== false) throw new TypeError("chat-component-authority-must-be-false");
    return Object.freeze({
      component_id:String(component.component_id), kind:String(component.kind),
      props:component.props ?? Object.freeze({}),
      actions:Object.freeze((component.actions ?? []).map((action:any)=>{
        if (action?.authority_granted !== false || action?.downstream_authorization_required !== true) throw new TypeError("chat-action-governance-invalid");
        return Object.freeze({...action,authority_granted:false,downstream_authorization_required:true});
      })),
    });
  }));
  return createInterfaceRuntimeEnvelope({
    schema:CHAT_RESTORED_PRESENTATION_SCHEMA, company_id, surface,
    conversation_id:String(snapshot.conversation_id), revision:Number(snapshot.revision ?? 0),
    last_sequence:Number(snapshot.last_sequence ?? 0), components,
    streams:Object.freeze((snapshot.streams ?? []).slice(-8)),
    notices:Object.freeze((snapshot.notices ?? []).slice(-20)),
    errors:Object.freeze((snapshot.errors ?? []).slice(-20)),
    restored:true, authority_granted:false, execution_owner:"command-bus",
  });
}
