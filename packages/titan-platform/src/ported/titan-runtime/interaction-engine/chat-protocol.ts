import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "./contracts.js";

export const CHAT_PROTOCOL_SCHEMA = "titan.chat.event.v1";
export const CHAT_COMPONENT_SCHEMA = "titan.chat.component.v1";
const EVENT_TYPES = new Set(["user_message","assistant_message","system_notice","component","component_update","stream_delta","action_result","error"]);
const COMPONENT_KINDS = new Set(["card","list","form","wizard","metric","alert","approval","schedule","job","invoice","quote","progress","message"]);

function scalar(v: unknown): unknown {
  if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return Object.freeze(v.slice(0, 50).map(scalar));
  if (typeof v === "object") {
    rejectLegacyTenantAuthority(v as Record<string, unknown>, "chat-protocol-payload");
    const out: Record<string, unknown> = {};
    for (const [k,val] of Object.entries(v as Record<string, unknown>)) {
      if (/^(token|secret|password|credential|api[_-]?key)$/i.test(k)) continue;
      if (["execute","eval","script","html","innerHTML"].includes(k)) continue;
      out[k] = scalar(val);
    }
    return Object.freeze(out);
  }
  return String(v);
}

export function createChatComponent(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("chat-component-object-required");
  rejectLegacyTenantAuthority(input, "chat-component");
  const component_id = String(input.component_id ?? "").trim();
  const kind = String(input.kind ?? "").trim();
  if (!component_id) throw new TypeError("chat-component-id-required");
  if (!COMPONENT_KINDS.has(kind)) throw new TypeError("chat-component-kind-not-allowed");
  const actions = Object.freeze((input.actions ?? []).map((a:any) => {
    const intent = String(a?.intent ?? "").trim();
    if (!intent) throw new TypeError("chat-component-action-intent-required");
    if (a.execute === true || a.direct_effect === true) throw new TypeError("chat-component-action-cannot-execute");
    return Object.freeze({ intent, params: scalar(a.params ?? {}), authority_granted: false, downstream_authorization_required: true });
  }));
  return Object.freeze({ schema: CHAT_COMPONENT_SCHEMA, component_id, kind, props: scalar(input.props ?? {}), actions, authority_granted: false });
}

export function createChatEvent(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("chat-event-object-required");
  rejectLegacyTenantAuthority(input, "chat-event");
  const company_id = assertCanonicalCompanyId(input.company_id);
  const event_id = String(input.event_id ?? "").trim();
  const conversation_id = String(input.conversation_id ?? "").trim();
  const type = String(input.type ?? "").trim();
  if (!event_id) throw new TypeError("chat-event-id-required");
  if (!conversation_id) throw new TypeError("chat-conversation-id-required");
  if (!EVENT_TYPES.has(type)) throw new TypeError("chat-event-type-not-allowed");
  const components = Object.freeze((input.components ?? []).slice(0,3).map(createChatComponent));
  return Object.freeze({
    schema: CHAT_PROTOCOL_SCHEMA, event_id, conversation_id, company_id,
    surface: canonicalSurface(input.surface), type,
    text: input.text == null ? null : String(input.text).slice(0,20000),
    components, correlation_id: input.correlation_id == null ? null : String(input.correlation_id),
    expected_revision: input.expected_revision == null ? null : Math.max(0, Number(input.expected_revision)),
    sequence: input.sequence == null ? null : Number(input.sequence),
    stream_id: input.type === "stream_delta" ? String(input.stream_id ?? "") : null,
    stream_complete: input.type === "stream_delta" && input.stream_complete === true,
    result: input.type === "action_result" ? scalar(input.result ?? {}) : null,
    error: input.type === "error" ? scalar(input.error ?? {}) : null,
    created_at: input.created_at ?? new Date().toISOString(),
    authority_granted: false,
  });
}

export function chatEventFromPresentationIntent(intent: any, ids: {event_id:string; conversation_id:string}) {
  if (!intent?.authority_neutral) throw new TypeError("presentation-intent-must-be-authority-neutral");
  return createChatEvent({ ...ids, company_id:intent.company_id, surface:intent.surface, type:"component",
    components:(intent.payload?.semantic_components ?? []).slice(0,3).map((c:any,i:number)=>({component_id:String(c.component_id ?? c.id ?? `semantic-${i+1}`),kind:COMPONENT_KINDS.has(String(c.kind))?String(c.kind):"card",props:c.props ?? c,actions:intent.actions ?? []})) });
}
