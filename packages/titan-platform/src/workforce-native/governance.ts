import { assertTitanNativeWorkforceBoundary, getTitanNativeWorkforceAgentMap, type TitanNativeWorkforceAgentKey, type TitanNativeWorkforceOperation } from "./contracts.js";

export type TitanNativeGovernanceInput = Readonly<{
  companyId: string;
  actorId: string;
  agentKey: TitanNativeWorkforceAgentKey;
  action: string;
  traceId: string;
  operation?: TitanNativeWorkforceOperation | null;
  permissionGranted: boolean;
  online?: boolean;
}>;

function text(value:unknown,max=180){return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";}

export function buildTitanNativeGovernanceEvidence(input:TitanNativeGovernanceInput){
  const company_id=assertTitanNativeWorkforceBoundary(input.companyId);
  const actor_id=text(input.actorId); if(!actor_id) throw new Error("actor_id-required");
  const trace_id=text(input.traceId); if(!trace_id) throw new Error("trace_id-required");
  const map=getTitanNativeWorkforceAgentMap(input.agentKey); if(!map) throw new Error(`native-governance-agent-unknown:${String(input.agentKey)}`);
  const action=text(input.action,128); if(!action) throw new Error("native-governance-action-required");
  const operation=input.operation??null;
  const permission_granted=input.permissionGranted===true;
  const mutating=operation?.mutating===true;
  const online=input.online!==false;
  const offline_mode=operation===null?"LOCAL_PROPOSAL_ONLY":mutating?"ONLINE_NATIVE_ROUTE_REQUIRED":"READ_CACHE_OR_ONLINE";
  const ready=permission_granted && (!mutating || online);
  return Object.freeze({
    schema:"titan.zero.workforce-native.governance-evidence/v1",
    company_id,actor_id,agent_key:input.agentKey,action,trace_id,
    telemetry:Object.freeze({event_name:`titan.workforce.native.${input.agentKey}.${action}`,correlation_id:trace_id,company_id,agent_key:input.agentKey,authority_effect:false}),
    audit:Object.freeze({required:mutating,trace_id,durable_owner:mutating?"native_business_ops_route":"none",duplicate_audit_write_forbidden:true}),
    permission:Object.freeze({granted:permission_granted,identity_grants_authority:false,native_route_rechecks_authority:mutating}),
    offline:Object.freeze({mode:offline_mode,online,automatic_effect_replay:false,automatic_mutation_queueing:false,explicit_resume_required:mutating&&!online,effect_execution_permitted:mutating?online&&permission_granted:false}),
    diagnostics:Object.freeze({status:ready?"READY":"BLOCKED",operation_id:operation?.id??null,mutating,canonical_business_truth:map.canonicalBusinessTruth,browser_extension_required:false}),
    grants_authority:false,
  });
}

export function summarizeTitanNativeGovernance(evidence:readonly ReturnType<typeof buildTitanNativeGovernanceEvidence>[]){
  const blocked=evidence.filter((item)=>item.diagnostics.status==="BLOCKED");
  const mutations=evidence.filter((item)=>item.diagnostics.mutating);
  return Object.freeze({schema:"titan.zero.workforce-native.governance-summary/v1",agents:Object.freeze([...new Set(evidence.map((item)=>item.agent_key))].sort()),evidence_count:evidence.length,blocked_count:blocked.length,mutation_count:mutations.length,offline_effect_replay_allowed:false,identity_grants_authority:false});
}
