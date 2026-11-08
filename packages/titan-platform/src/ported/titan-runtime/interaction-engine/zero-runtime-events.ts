import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from "../boundary.js";
import { createChatEvent } from "./chat-protocol.js";

export const ZERO_RUNTIME_EVENT_SCHEMA = "titan.zero.runtime-event.v1";
const KINDS = new Set(["acknowledged","progress","waiting","resumed","approval_required","completed","failed","cancelled"]);

export function zeroChatEventFromRuntime(input:any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("zero-runtime-event-required");
  rejectLegacyTenantAuthority(input, "zero-runtime-event");
  const company_id = assertCanonicalCompanyId(input.company_id);
  const kind = String(input.kind ?? "");
  if (!KINDS.has(kind)) throw new TypeError("zero-runtime-event-kind-invalid");
  if (input.authority_granted === true || input.execution_authority === true) throw new TypeError("zero-runtime-event-cannot-grant-authority");
  const common = { event_id:String(input.event_id ?? ""), conversation_id:String(input.conversation_id ?? ""), company_id, surface:"zero", correlation_id:input.correlation_id ?? null, sequence:input.sequence ?? null, expected_revision:input.expected_revision ?? null };
  if (kind === "completed" || kind === "cancelled") return createChatEvent({ ...common, type:"action_result", result:{ action_id:String(input.action_id ?? ""), intent:String(input.intent ?? ""), status:kind === "completed" ? "succeeded" : "cancelled", receipt_id:input.receipt_id ?? null, message:input.message ?? null } });
  if (kind === "failed") return createChatEvent({ ...common, type:"error", text:input.message ?? "The operation failed.", error:{ code:String(input.code ?? "runtime_failed"), message:String(input.message ?? "The operation failed."), retryable:input.retryable === true } });
  const label = kind === "waiting" ? "Waiting" : kind === "resumed" ? "Resumed" : kind === "approval_required" ? "Approval required" : kind === "acknowledged" ? "Working" : "Progress";
  return createChatEvent({ ...common, type:"component", components:[{ component_id:String(input.component_id ?? `runtime-${input.action_id ?? input.event_id}`), kind:kind === "approval_required" ? "approval" : "progress", props:{ label, message:String(input.message ?? ""), status:kind, work_id:input.work_id ?? null }, actions:kind === "approval_required" ? [{ intent:String(input.approval_intent ?? "runtime.approval.review"), params:{ action_id:input.action_id ?? null, work_id:input.work_id ?? null } }] : [] }] });
}
