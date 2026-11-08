import type { InteractionMessage, TitanSurface } from "./interaction-client";

export type MessageDeliveryState = "projected" | "sending" | "accepted" | "failed";
export interface ConversationRecord extends InteractionMessage { delivery_state: MessageDeliveryState; client_message_id?: string; }
export interface ConversationProjection { company_id: string; conversation_id: string; surface: TitanSurface; revision: string; messages: InteractionMessage[]; }
export interface ConversationHistoryTransport { load(input: { company_id: string; conversation_id: string; surface: TitanSurface }): Promise<ConversationProjection>; }

const keyFor = (company_id: string, conversation_id: string) => `titan:conversation:${company_id}:${conversation_id}`;

function validMessage(message: InteractionMessage, company_id: string, conversation_id: string, surface: TitanSurface) {
  return message.company_id === company_id && message.conversation_id === conversation_id && message.surface === surface;
}

export class TitanConversationStore {
  readonly company_id: string; readonly conversation_id: string; readonly surface: TitanSurface;
  private readonly transport?: ConversationHistoryTransport;
  constructor(input: { company_id: string; conversation_id: string; surface: TitanSurface; transport?: ConversationHistoryTransport }) {
    if (!input.company_id?.trim()) throw new Error("company_id is required");
    this.company_id=input.company_id; this.conversation_id=input.conversation_id; this.surface=input.surface; this.transport=input.transport;
  }
  private readLocal(): ConversationRecord[] {
    if (typeof window === "undefined") return [];
    try { const parsed=JSON.parse(window.localStorage.getItem(keyFor(this.company_id,this.conversation_id)) || "[]") as ConversationRecord[];
      return parsed.filter((m)=>validMessage(m,this.company_id,this.conversation_id,this.surface)); } catch { return []; }
  }
  private writeLocal(messages: ConversationRecord[]) { if (typeof window !== "undefined") window.localStorage.setItem(keyFor(this.company_id,this.conversation_id), JSON.stringify(messages)); }
  async hydrate(): Promise<ConversationRecord[]> {
    const local=this.readLocal(); if (!this.transport) return local;
    const projection=await this.transport.load({company_id:this.company_id,conversation_id:this.conversation_id,surface:this.surface});
    if (projection.company_id!==this.company_id || projection.conversation_id!==this.conversation_id || projection.surface!==this.surface) throw new Error("Conversation projection scope mismatch");
    const projected=projection.messages.filter((m)=>validMessage(m,this.company_id,this.conversation_id,this.surface)).map((m)=>({...m,delivery_state:"projected" as const}));
    const projectedIds=new Set(projected.map((m)=>m.id));
    const pending=local.filter((m)=>!projectedIds.has(m.id) && (m.delivery_state==="sending" || m.delivery_state==="failed"));
    const merged=[...projected,...pending].sort((a,b)=>a.created_at.localeCompare(b.created_at)); this.writeLocal(merged); return merged;
  }
  optimistic(text:string, client_message_id:string): ConversationRecord {
    const message:ConversationRecord={id:client_message_id,client_message_id,conversation_id:this.conversation_id,company_id:this.company_id,surface:this.surface,from:"user",text,created_at:new Date().toISOString(),delivery_state:"sending"};
    const next=[...this.readLocal().filter((m)=>m.id!==message.id),message]; this.writeLocal(next); return message;
  }
  reconcile(client_message_id:string, accepted: boolean): ConversationRecord[] {
    const next=this.readLocal().map((m)=>m.id===client_message_id?{...m,delivery_state:accepted?"accepted" as const:"failed" as const}:m); this.writeLocal(next); return next;
  }
  append(messages: ConversationRecord[]): ConversationRecord[] {
    const map=new Map(this.readLocal().map((m)=>[m.id,m])); for(const message of messages) if(validMessage(message,this.company_id,this.conversation_id,this.surface)) map.set(message.id,message);
    const next=[...map.values()].sort((a,b)=>a.created_at.localeCompare(b.created_at)); this.writeLocal(next); return next;
  }
}
