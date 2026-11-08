// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/financial-engine/decision-packet-correlation.js
import { createDecisionPacketCorrelation, stableCorrelationHash } from "../decision/correlation-layer.js";
const evidenceId=(value,index)=>value&&typeof value==="object"?String(value.evidence_id||value.ref||value.id||`money-evidence-${stableCorrelationHash(value)}`):(value!=null&&String(value).trim()?String(value).trim():`money-evidence-${index}`);
export const MONEY_DECISION_CORRELATION_VERSION="1.1.0";
export function correlateMoneyDecision(packet,payload,expectedCompanyId){
  if(!payload||typeof payload!=="object")throw new Error("invalid_money_payload");
  if(packet.company_id!==expectedCompanyId)throw new Error("company_mismatch");
  const action=payload.money_action||payload.action||(payload.action_id?payload:null);
  const observation=payload.financial_observation||payload.observation_record||(!action?payload:null);
  if(action&&action.company_id!==expectedCompanyId)throw new Error("company_mismatch");
  if(observation&&observation.company_id!==expectedCompanyId)throw new Error("company_mismatch");
  const refs=[];
  if(action?.action_id) refs.push({type:"action",id:String(action.action_id),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision});
  if(observation?.observation_id||observation?.financial_observation_id) refs.push({type:"finding",id:String(observation.observation_id||observation.financial_observation_id),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision});
  const evidence=Array.isArray(observation?.evidence)?observation.evidence:(Array.isArray(action?.evidence)?action.evidence:[]);
  evidence.forEach((item,index)=>refs.push({type:"evidence",id:evidenceId(item,index),company_id:expectedCompanyId,source_provider:packet.source_provider,source_revision:packet.source_revision}));
  return createDecisionPacketCorrelation(packet,refs,expectedCompanyId);
}
