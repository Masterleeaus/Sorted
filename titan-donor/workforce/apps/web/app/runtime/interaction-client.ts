export type TitanSurface = "zero" | "go" | "hub";
export type TitanSurfaceInput = TitanSurface | "command" | "owner" | "manager" | "business" | "field" | "worker" | "workforce" | "customer";
export type InteractionParticipantKind = "zero" | "manager" | "specialist" | "user";
export type InteractionEventKind = "message" | "worker_joined" | "worker_left" | "handoff" | "presentation" | "stream_chunk" | "stream_completed" | "stream_interrupted";

export interface InteractionParticipant { agent_id: string; display_name: string; kind: InteractionParticipantKind; }
export interface InteractionMessage { id: string; conversation_id: string; company_id: string; surface: TitanSurface; from: "user" | "zero" | "worker"; text: string; agent_id?: string; created_at: string; }
export interface InteractionEvent { id: string; kind: InteractionEventKind; conversation_id: string; company_id: string; surface: TitanSurface; participant?: InteractionParticipant; from_agent_id?: string; to_agent_id?: string; message?: InteractionMessage; stream_id?: string; chunk_id?: string; chunk?: string; continuation_token?: string; }
export interface InteractionSendInput { company_id: string; conversation_id: string; surface: TitanSurface; text: string; requested_agent_id?: string; client_message_id: string; continuation_token?: string; }
export interface InteractionTransport { send(input: InteractionSendInput, options?: { signal?: AbortSignal }): Promise<{ accepted: boolean; events: InteractionEvent[]; continuation_token?: string }>; }
export interface InteractionClientOptions { company_id: string; conversation_id: string; surface: TitanSurfaceInput; transport?: InteractionTransport; }
export interface StreamSession { stream_id: string; events: InteractionEvent[]; text: string; continuation_token?: string; interrupted: boolean; }

const forbiddenTenantKeys = new Set(["tenant_id", "tenant_company_id"]);
function assertCanonicalContext(value: Record<string, unknown>) { for (const key of forbiddenTenantKeys) if (key in value) throw new Error(`Legacy tenant authority is forbidden: ${key}`); if (typeof value.company_id !== "string" || !value.company_id.trim()) throw new Error("company_id is required"); }
export function normalizeInteractionSurface(surface: TitanSurfaceInput): TitanSurface {
  if (surface === "zero" || surface === "go" || surface === "hub") return surface;
  if (surface === "field" || surface === "worker" || surface === "workforce") return "go";
  if (surface === "customer") return "hub";
  return "zero";
}
function id(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
export function requestedWorkerFromText(text: string): string | undefined { const match = text.match(/(?:talk|speak|chat)\s+(?:to|with)\s+(.+?)(?:\s+please)?[.!?]?$/i); return match?.[1]?.trim(); }

export class TitanInteractionClient {
  readonly company_id: string; readonly conversation_id: string; readonly surface: TitanSurface; private readonly transport?: InteractionTransport; private continuationToken?: string; private readonly seenChunks = new Set<string>(); private activeController?: AbortController;
  constructor(options: InteractionClientOptions) { assertCanonicalContext(options as unknown as Record<string, unknown>); this.company_id = options.company_id; this.conversation_id = options.conversation_id; this.surface = normalizeInteractionSurface(options.surface); this.transport = options.transport; }
  private scoped(events: InteractionEvent[]) { return events.filter((event) => event.company_id === this.company_id && event.conversation_id === this.conversation_id && event.surface === this.surface); }
  cancelActiveStream() { this.activeController?.abort(); this.activeController = undefined; }
  getContinuationToken() { return this.continuationToken; }
  async send(text: string, requested_agent_id?: string, client_message_id = id("msg"), options: { signal?: AbortSignal; continuation_token?: string } = {}): Promise<InteractionEvent[]> {
    const clean = text.trim(); if (!clean) return [];
    if (!this.transport) return [{ id: id("event"), kind: "message", conversation_id: this.conversation_id, company_id: this.company_id, surface: this.surface, message: { id: client_message_id, conversation_id: this.conversation_id, company_id: this.company_id, surface: this.surface, from: "user", text: clean, created_at: new Date().toISOString() } }];
    const result = await this.transport.send({ company_id: this.company_id, conversation_id: this.conversation_id, surface: this.surface, text: clean, requested_agent_id, client_message_id, continuation_token: options.continuation_token ?? this.continuationToken }, { signal: options.signal });
    if (!result.accepted) return []; this.continuationToken = result.continuation_token ?? this.continuationToken; return this.scoped(result.events);
  }
  async stream(text: string, requested_agent_id?: string, client_message_id = id("msg")): Promise<StreamSession> {
    this.cancelActiveStream(); const controller = new AbortController(); this.activeController = controller; const stream_id = id("stream");
    try {
      const events = await this.send(text, requested_agent_id, client_message_id, { signal: controller.signal, continuation_token: this.continuationToken });
      let assembled = ""; const unique: InteractionEvent[] = [];
      for (const event of events) { if (event.kind === "stream_chunk") { const key = `${event.stream_id ?? stream_id}:${event.chunk_id ?? event.id}`; if (this.seenChunks.has(key)) continue; this.seenChunks.add(key); assembled += event.chunk ?? ""; } if (event.continuation_token) this.continuationToken = event.continuation_token; unique.push(event); }
      return { stream_id, events: unique, text: assembled, continuation_token: this.continuationToken, interrupted: false };
    } catch (error) { if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return { stream_id, events: [], text: "", continuation_token: this.continuationToken, interrupted: true }; throw error; }
    finally { if (this.activeController === controller) this.activeController = undefined; }
  }
  async resume(client_message_id = id("resume")): Promise<StreamSession> { if (!this.continuationToken) return { stream_id: id("stream"), events: [], text: "", interrupted: false }; return this.stream("Continue", undefined, client_message_id); }
}
