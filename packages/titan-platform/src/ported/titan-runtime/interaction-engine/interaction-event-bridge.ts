// @ts-nocheck
import { assertCanonicalCompanyId, rejectLegacyTenantAuthorityDeep } from '../boundary.js';
const freeze=v=>Object.freeze(v); const text=(v,n)=>{const s=String(v??'').trim();if(!s)throw new TypeError(`${n}-required`);return s;};
export function createInteractionEventBridge({company_id,event_ledger,id_factory=()=>globalThis.crypto?.randomUUID?.() ?? `interaction-${Date.now()}`}={}){
 const cid=assertCanonicalCompanyId(company_id);if(!event_ledger?.append)throw new TypeError('interaction-event-ledger-required');
 const record=async(input={})=>{rejectLegacyTenantAuthorityDeep(input,'interaction-event');if(input.company_id!=null&&String(input.company_id)!==cid)throw new Error('interaction-event-company-mismatch');const event_type=text(input.event_type,'interaction-event-type');return event_ledger.append({company_id:cid},{event_id:String(input.event_id??id_factory()),event_type,category:String(input.category??'interaction'),source:String(input.source??'interaction-engine'),operation_id:input.operation_id,request_id:input.request_id,idempotency_key:input.idempotency_key,actor_id:input.actor_id,capability:input.capability,decision_id:input.decision_id,action_id:input.action_id,correlation_id:input.correlation_id,causation_id:input.causation_id,payload:{...(input.payload??{}),authority_neutral:true,execution_authority:false},evidence_refs:input.evidence_refs??[],authority_ref:input.authority_ref,risk:input.risk,reversibility:input.reversibility});};
 return freeze({company_id:cid,authority_neutral:true,execution_authority:false,record});
}
