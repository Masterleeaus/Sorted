import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { canonicalSurface } from "./contracts.js";
import { CHAT_PROTOCOL_SCHEMA, createChatComponent } from "./chat-protocol.js";

export const CHAT_STATE_SCHEMA = "titan.chat.state.v1";
const TERMINAL_ACTION_STATUSES = new Set(["succeeded", "failed", "cancelled", "denied"]);
const MAX_EVENT_HISTORY = 100;
const MAX_STREAMS = 8;
const MAX_STREAM_TEXT = 20000;

function assertEvent(event: any) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new TypeError("chat-event-object-required");
  rejectLegacyTenantAuthority(event, "chat-state-event");
  if (event.schema !== CHAT_PROTOCOL_SCHEMA) throw new TypeError("chat-event-schema-invalid");
  if (event.authority_granted !== false) throw new TypeError("chat-event-authority-must-be-false");
  return event;
}

export function createChatState(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("chat-state-object-required");
  rejectLegacyTenantAuthority(input, "chat-state");
  const conversation_id = String(input.conversation_id ?? "").trim();
  if (!conversation_id) throw new TypeError("chat-state-conversation-id-required");
  return Object.freeze({
    schema: CHAT_STATE_SCHEMA,
    conversation_id,
    company_id: assertCanonicalCompanyId(input.company_id),
    surface: canonicalSurface(input.surface),
    revision: Math.max(0, Number(input.revision ?? 0)),
    last_sequence: Math.max(0, Number(input.last_sequence ?? 0)),
    processed_event_ids: Object.freeze((input.processed_event_ids ?? []).slice(-MAX_EVENT_HISTORY).map(String)),
    components: Object.freeze((input.components ?? []).slice(0, 3).map(createChatComponent)),
    notices: Object.freeze((input.notices ?? []).slice(-20)),
    action_results: Object.freeze((input.action_results ?? []).slice(-20)),
    errors: Object.freeze((input.errors ?? []).slice(-20)),
    streams: Object.freeze((input.streams ?? []).slice(-MAX_STREAMS).map((s:any)=>Object.freeze({
      stream_id:String(s.stream_id ?? ""), text:String(s.text ?? "").slice(0,MAX_STREAM_TEXT), complete:s.complete === true,
    }))),
    authority_granted: false,
  });
}

function assertSameBoundary(state: any, event: any) {
  if (assertCanonicalCompanyId(event.company_id) !== state.company_id) throw new TypeError("chat-state-company-mismatch");
  if (canonicalSurface(event.surface) !== state.surface) throw new TypeError("chat-state-surface-mismatch");
  if (String(event.conversation_id) !== state.conversation_id) throw new TypeError("chat-state-conversation-mismatch");
}

export function applyChatEvent(stateInput: any, eventInput: any) {
  const state = stateInput?.schema === CHAT_STATE_SCHEMA ? stateInput : createChatState(stateInput);
  const event = assertEvent(eventInput);
  assertSameBoundary(state, event);
  const eventId = String(event.event_id);
  if (event.sequence != null && state.processed_event_ids.includes(eventId)) return state; // sequenced delivery is replay-safe; legacy revision-only events retain stale-event semantics
  if (event.sequence != null) {
    const sequence = Number(event.sequence);
    if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new TypeError("chat-event-sequence-invalid");
    if (sequence !== Number(state.last_sequence) + 1) throw new TypeError("chat-event-out-of-order");
  }
  if (event.expected_revision != null && Number(event.expected_revision) !== Number(state.revision)) throw new TypeError("chat-state-stale-event");

  let components = [...state.components];
  const notices = [...state.notices];
  const action_results = [...state.action_results];
  const errors = [...state.errors];
  let streams = [...state.streams];

  if (event.type === "component") {
    components = (event.components ?? []).slice(0, 3).map(createChatComponent);
  } else if (event.type === "component_update") {
    if ((event.components ?? []).length !== 1) throw new TypeError("chat-component-update-requires-one-component");
    const next = createChatComponent(event.components[0]);
    const index = components.findIndex((c:any) => c.component_id === next.component_id);
    if (index < 0) throw new TypeError("chat-component-update-target-missing");
    components[index] = next;
  } else if (event.type === "stream_delta") {
    const streamId = String(event.stream_id ?? "").trim();
    if (!streamId) throw new TypeError("chat-stream-id-required");
    const delta = String(event.text ?? "");
    const index = streams.findIndex((s:any)=>s.stream_id === streamId);
    if (index >= 0 && streams[index].complete) throw new TypeError("chat-stream-already-complete");
    const current = index >= 0 ? streams[index] : {stream_id:streamId,text:"",complete:false};
    const next = Object.freeze({stream_id:streamId,text:(current.text + delta).slice(0,MAX_STREAM_TEXT),complete:event.stream_complete === true});
    if (index >= 0) streams[index]=next; else streams.push(next);
    streams=streams.slice(-MAX_STREAMS);
  } else if (event.type === "action_result") {
    const result = event.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new TypeError("chat-action-result-required");
    rejectLegacyTenantAuthority(result, "chat-action-result");
    const status = String(result.status ?? "");
    if (!TERMINAL_ACTION_STATUSES.has(status)) throw new TypeError("chat-action-result-status-invalid");
    action_results.push(Object.freeze({
      action_id: String(result.action_id ?? ""), intent: String(result.intent ?? ""), status,
      receipt_id: result.receipt_id == null ? null : String(result.receipt_id),
      message: result.message == null ? null : String(result.message).slice(0, 4000),
      authority_granted: false, execution_owner: "command-bus",
    }));
  } else if (event.type === "error") {
    errors.push(Object.freeze({code:String(event.error?.code ?? "chat_error").slice(0,120),message:String(event.error?.message ?? event.text ?? "Chat operation failed").slice(0,4000),retryable:event.error?.retryable === true,authority_granted:false}));
  } else if (event.type === "system_notice" || event.type === "assistant_message") {
    notices.push(Object.freeze({ event_id:eventId, type:event.type, text:event.text ?? null }));
  }

  return createChatState({...state,revision:Number(state.revision)+1,last_sequence:event.sequence == null ? state.last_sequence : Number(event.sequence),processed_event_ids:[...state.processed_event_ids,eventId],components,notices:notices.slice(-20),action_results:action_results.slice(-20),errors:errors.slice(-20),streams});
}


export const CHAT_RESUME_SCHEMA = "titan.chat.resume.v1";
const MAX_RESUME_EVENTS = 100;

export function createChatResumeCheckpoint(stateInput: any) {
  const state = stateInput?.schema === CHAT_STATE_SCHEMA ? stateInput : createChatState(stateInput);
  return Object.freeze({
    schema: CHAT_RESUME_SCHEMA,
    conversation_id: state.conversation_id,
    company_id: state.company_id,
    surface: state.surface,
    revision: state.revision,
    last_sequence: state.last_sequence,
    processed_event_ids: Object.freeze([...state.processed_event_ids].slice(-MAX_RESUME_EVENTS)),
    authority_granted: false,
  });
}

export function assertResumeCheckpoint(stateInput: any, checkpoint: any) {
  const state = stateInput?.schema === CHAT_STATE_SCHEMA ? stateInput : createChatState(stateInput);
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) throw new TypeError("chat-resume-checkpoint-required");
  rejectLegacyTenantAuthority(checkpoint, "chat-resume-checkpoint");
  if (checkpoint.schema !== CHAT_RESUME_SCHEMA) throw new TypeError("chat-resume-schema-invalid");
  if (checkpoint.authority_granted !== false) throw new TypeError("chat-resume-authority-must-be-false");
  if (assertCanonicalCompanyId(checkpoint.company_id) !== state.company_id) throw new TypeError("chat-resume-company-mismatch");
  if (canonicalSurface(checkpoint.surface) !== state.surface) throw new TypeError("chat-resume-surface-mismatch");
  if (String(checkpoint.conversation_id) !== state.conversation_id) throw new TypeError("chat-resume-conversation-mismatch");
  const revision = Number(checkpoint.revision);
  const sequence = Number(checkpoint.last_sequence);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("chat-resume-revision-invalid");
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new TypeError("chat-resume-sequence-invalid");
  if (revision > state.revision || sequence > state.last_sequence) throw new TypeError("chat-resume-checkpoint-ahead");
  return Object.freeze({...checkpoint, revision, last_sequence: sequence, authority_granted:false});
}

export function createChatResumePlan(stateInput: any, checkpoint: any, retainedEvents: any[] = []) {
  const state = stateInput?.schema === CHAT_STATE_SCHEMA ? stateInput : createChatState(stateInput);
  const cursor = assertResumeCheckpoint(state, checkpoint);
  const events = retainedEvents.filter(Boolean).map(assertEvent).filter((event:any) => {
    assertSameBoundary(state, event);
    return event.sequence != null && Number(event.sequence) > cursor.last_sequence;
  }).sort((a:any,b:any)=>Number(a.sequence)-Number(b.sequence));

  let expected = cursor.last_sequence + 1;
  const replay:any[] = [];
  for (const event of events) {
    const seq = Number(event.sequence);
    if (!Number.isSafeInteger(seq) || seq <= 0) throw new TypeError("chat-event-sequence-invalid");
    if (seq < expected) continue;
    if (seq !== expected) return Object.freeze({
      schema:"titan.chat.resume-plan.v1", mode:"snapshot_required", reason:"retention_gap",
      conversation_id:state.conversation_id, company_id:state.company_id, surface:state.surface,
      from_sequence:cursor.last_sequence, current_sequence:state.last_sequence, events:Object.freeze([]), authority_granted:false,
    });
    replay.push(event); expected++;
  }
  if (cursor.last_sequence < state.last_sequence && expected <= state.last_sequence) return Object.freeze({
    schema:"titan.chat.resume-plan.v1", mode:"snapshot_required", reason:"retention_gap",
    conversation_id:state.conversation_id, company_id:state.company_id, surface:state.surface,
    from_sequence:cursor.last_sequence, current_sequence:state.last_sequence, events:Object.freeze([]), authority_granted:false,
  });
  return Object.freeze({
    schema:"titan.chat.resume-plan.v1", mode: replay.length ? "replay" : "current",
    conversation_id:state.conversation_id, company_id:state.company_id, surface:state.surface,
    from_sequence:cursor.last_sequence, current_sequence:state.last_sequence,
    events:Object.freeze(replay.slice(0,MAX_RESUME_EVENTS)), authority_granted:false,
  });
}

export function createChatSnapshot(stateInput: any) {
  const state = stateInput?.schema === CHAT_STATE_SCHEMA ? stateInput : createChatState(stateInput);
  return Object.freeze({
    schema:"titan.chat.snapshot.v1",
    conversation_id:state.conversation_id, company_id:state.company_id, surface:state.surface,
    revision:state.revision, last_sequence:state.last_sequence,
    components:state.components, notices:state.notices, action_results:state.action_results,
    errors:state.errors, streams:state.streams, authority_granted:false,
  });
}


export const CHAT_EDGE_CURSOR_SCHEMA = "titan.chat.edge-cursor.v1";

export function createChatEdgeCursor(stateInput:any, device_id:any) {
  const state=stateInput?.schema===CHAT_STATE_SCHEMA?stateInput:createChatState(stateInput);
  const deviceId=String(device_id ?? "").trim();
  if (!deviceId || deviceId.length>160) throw new TypeError("chat-edge-device-id-invalid");
  return Object.freeze({
    schema:CHAT_EDGE_CURSOR_SCHEMA, device_id:deviceId,
    conversation_id:state.conversation_id, company_id:state.company_id, surface:state.surface,
    revision:state.revision, last_sequence:state.last_sequence, authority_granted:false,
  });
}

function assertEdgeCursor(state:any,cursor:any) {
  if (!cursor || typeof cursor!=="object" || Array.isArray(cursor)) throw new TypeError("chat-edge-cursor-required");
  rejectLegacyTenantAuthority(cursor,"chat-edge-cursor");
  if (cursor.schema!==CHAT_EDGE_CURSOR_SCHEMA) throw new TypeError("chat-edge-cursor-schema-invalid");
  if (cursor.authority_granted!==false) throw new TypeError("chat-edge-cursor-authority-must-be-false");
  if (assertCanonicalCompanyId(cursor.company_id)!==state.company_id) throw new TypeError("chat-edge-company-mismatch");
  if (canonicalSurface(cursor.surface)!==state.surface) throw new TypeError("chat-edge-surface-mismatch");
  if (String(cursor.conversation_id)!==state.conversation_id) throw new TypeError("chat-edge-conversation-mismatch");
  const revision=Number(cursor.revision), sequence=Number(cursor.last_sequence);
  if (!Number.isSafeInteger(revision)||revision<0||!Number.isSafeInteger(sequence)||sequence<0) throw new TypeError("chat-edge-cursor-position-invalid");
  if (revision>state.revision||sequence>state.last_sequence) throw new TypeError("chat-edge-cursor-ahead");
  return Object.freeze({...cursor,revision,last_sequence:sequence,authority_granted:false});
}

export function reconcileChatEdgeMutation(stateInput:any, cursorInput:any, proposedEvent:any) {
  const state=stateInput?.schema===CHAT_STATE_SCHEMA?stateInput:createChatState(stateInput);
  const cursor=assertEdgeCursor(state,cursorInput);
  const event=assertEvent(proposedEvent);
  assertSameBoundary(state,event);
  if (event.sequence!=null) throw new TypeError("chat-edge-client-cannot-assign-sequence");
  if (String(event.event_id) && state.processed_event_ids.includes(String(event.event_id))) return Object.freeze({
    schema:"titan.chat.edge-reconciliation.v1",status:"duplicate",device_id:String(cursor.device_id),
    company_id:state.company_id,surface:state.surface,conversation_id:state.conversation_id,
    server_revision:state.revision,server_sequence:state.last_sequence,authority_granted:false,
  });
  if (cursor.revision!==state.revision || cursor.last_sequence!==state.last_sequence) return Object.freeze({
    schema:"titan.chat.edge-reconciliation.v1",status:"conflict",reason:"server_state_advanced",
    device_id:String(cursor.device_id),company_id:state.company_id,surface:state.surface,conversation_id:state.conversation_id,
    client_revision:cursor.revision,client_sequence:cursor.last_sequence,
    server_revision:state.revision,server_sequence:state.last_sequence,
    resolution:"refresh_then_reapply",authority_granted:false,
  });
  const accepted=Object.freeze({...event,sequence:state.last_sequence+1,expected_revision:state.revision,authority_granted:false});
  return Object.freeze({
    schema:"titan.chat.edge-reconciliation.v1",status:"accepted",device_id:String(cursor.device_id),
    company_id:state.company_id,surface:state.surface,conversation_id:state.conversation_id,
    assigned_sequence:accepted.sequence,server_revision:state.revision,server_sequence:state.last_sequence,
    event:accepted,authority_granted:false,
  });
}


export const CHAT_PERSISTENCE_POLICY_SCHEMA="titan.chat.persistence-policy.v1";
const PERSISTENCE_TIERS=new Set(["device","edge","business_system"]);
export function createChatPersistencePolicy(input:any={}) {
  if (!input||typeof input!=="object"||Array.isArray(input)) throw new TypeError("chat-persistence-policy-object-required");
  rejectLegacyTenantAuthority(input,"chat-persistence-policy");
  const company_id=assertCanonicalCompanyId(input.company_id);
  const surface=canonicalSurface(input.surface);
  const device_first=input.device_first!==false;
  return Object.freeze({
    schema:CHAT_PERSISTENCE_POLICY_SCHEMA,company_id,surface,device_first,
    local_state_owner:"device",replication_role:"cache_replica",business_authority_owner:"business_system",
    offline_business_writes:false,edge_can_grant_authority:false,device_can_grant_authority:false,
    authority_granted:false,
  });
}
export function createChatPersistenceRecord(stateInput:any,policyInput:any,options:any={}) {
  const state=stateInput?.schema===CHAT_STATE_SCHEMA?stateInput:createChatState(stateInput);
  const policy=policyInput?.schema===CHAT_PERSISTENCE_POLICY_SCHEMA?policyInput:createChatPersistencePolicy(policyInput);
  if(policy.company_id!==state.company_id) throw new TypeError("chat-persistence-company-mismatch");
  if(policy.surface!==state.surface) throw new TypeError("chat-persistence-surface-mismatch");
  const tier=String(options.tier??"device");
  if(!PERSISTENCE_TIERS.has(tier)) throw new TypeError("chat-persistence-tier-invalid");
  if(tier==="business_system") throw new TypeError("chat-state-cannot-become-business-authority");
  const snapshot=createChatSnapshot(state);
  return Object.freeze({
    schema:"titan.chat.persistence-record.v1",tier,company_id:state.company_id,surface:state.surface,
    conversation_id:state.conversation_id,revision:state.revision,last_sequence:state.last_sequence,
    replica:true,authoritative_business_state:false,snapshot,authority_granted:false,
  });
}
export function planChatPersistenceSync(record:any,policyInput:any,online:boolean) {
  if(!record||typeof record!=="object"||Array.isArray(record)) throw new TypeError("chat-persistence-record-required");
  rejectLegacyTenantAuthority(record,"chat-persistence-record");
  if(record.schema!=="titan.chat.persistence-record.v1") throw new TypeError("chat-persistence-record-schema-invalid");
  if(record.authority_granted!==false||record.authoritative_business_state!==false) throw new TypeError("chat-persistence-authority-invalid");
  const policy=policyInput?.schema===CHAT_PERSISTENCE_POLICY_SCHEMA?policyInput:createChatPersistencePolicy(policyInput);
  if(assertCanonicalCompanyId(record.company_id)!==policy.company_id) throw new TypeError("chat-persistence-company-mismatch");
  if(canonicalSurface(record.surface)!==policy.surface) throw new TypeError("chat-persistence-surface-mismatch");
  return Object.freeze({
    schema:"titan.chat.persistence-sync-plan.v1",company_id:policy.company_id,surface:policy.surface,
    conversation_id:String(record.conversation_id),mode:online?"replicate":"retain_local",
    source_tier:String(record.tier),target_tier:online?"edge":null,
    requires_business_reauthorization:true,may_write_business_state:false,authority_granted:false,
  });
}


export const CHAT_STORAGE_ADAPTER_SCHEMA="titan.chat.storage-adapter.v1";
const STORAGE_KINDS=new Set(["device","edge_node","network","object_storage","customer_cloud"]);
export function createChatStorageAdapter(input:any) {
  if(!input||typeof input!=="object"||Array.isArray(input)) throw new TypeError("chat-storage-adapter-object-required");
  rejectLegacyTenantAuthority(input,"chat-storage-adapter");
  const adapter_id=String(input.adapter_id??"").trim(),kind=String(input.kind??"").trim();
  if(!adapter_id) throw new TypeError("chat-storage-adapter-id-required");
  if(!STORAGE_KINDS.has(kind)) throw new TypeError("chat-storage-kind-invalid");
  const company_id=assertCanonicalCompanyId(input.company_id),surface=canonicalSurface(input.surface);
  if(input.credentials||input.secret||input.token||input.api_key) throw new TypeError("chat-storage-secrets-not-allowed");
  return Object.freeze({
    schema:CHAT_STORAGE_ADAPTER_SCHEMA,adapter_id,kind,company_id,surface,
    customer_controlled:input.customer_controlled!==false,
    stores_business_authority:false,may_execute_business_actions:false,authority_granted:false,
  });
}
export function planChatStorageWrite(record:any,adapterInput:any) {
  if(!record||record.schema!=="titan.chat.persistence-record.v1") throw new TypeError("chat-persistence-record-schema-invalid");
  if(record.authority_granted!==false||record.authoritative_business_state!==false) throw new TypeError("chat-persistence-authority-invalid");
  const adapter=adapterInput?.schema===CHAT_STORAGE_ADAPTER_SCHEMA?adapterInput:createChatStorageAdapter(adapterInput);
  if(assertCanonicalCompanyId(record.company_id)!==adapter.company_id) throw new TypeError("chat-storage-company-mismatch");
  if(canonicalSurface(record.surface)!==adapter.surface) throw new TypeError("chat-storage-surface-mismatch");
  return Object.freeze({
    schema:"titan.chat.storage-write-plan.v1",adapter_id:adapter.adapter_id,kind:adapter.kind,
    company_id:adapter.company_id,surface:adapter.surface,conversation_id:String(record.conversation_id),
    operation:"put_replica",payload:record,authoritative_business_state:false,
    requires_adapter_execution:true,may_execute_business_actions:false,authority_granted:false,
  });
}
export function chooseChatStorageRoute(adaptersInput:any[],online:boolean) {
  const adapters=(adaptersInput??[]).map(createChatStorageAdapter);
  const priority=online?["device","edge_node","network","customer_cloud","object_storage"]:["device"];
  for(const kind of priority){const found=adapters.find((a:any)=>a.kind===kind);if(found)return Object.freeze({schema:"titan.chat.storage-route.v1",adapter_id:found.adapter_id,kind:found.kind,reason:online?"device_first_then_customer_controlled":"offline_device_only",authority_granted:false});}
  throw new TypeError(online?"chat-storage-route-unavailable":"chat-storage-device-required-offline");
}
