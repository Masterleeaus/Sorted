import {
  assertNoLegacyStorageBoundary,
  normalizeStorageContext,
  type StorageContextInput,
} from "../storage/contracts.js";

const text=(v:unknown,f:string)=>{const s=String(v??"").trim();if(!s)throw new Error(`${f}-required`);return s;};
function isoMs(value:unknown,field:string):number{
  const n=Date.parse(String(value??""));
  if(!Number.isFinite(n))throw new Error(`${field}-invalid`);
  return n;
}
function assertCompany(value:unknown,company_id:string,path="offline-authority"):void{
  assertNoLegacyStorageBoundary(value,path);
  if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach((x,i)=>assertCompany(x,company_id,`${path}[${i}]`));return;}
  for(const [k,v] of Object.entries(value as Record<string,unknown>)){
    if(k==="company_id"&&v!=null&&String(v).trim()!==company_id)throw new Error(`cross-company:${path}.company_id`);
    assertCompany(v,company_id,`${path}.${k}`);
  }
}

export type OfflineAuthorityDecision = Readonly<{
  company_id:string;
  authority_decision_id:string;
  worker_id:string;
  capability:string;
  operation_id:string;
  action_id:string;
  decision:"ALLOW"|"DENY"|"ESCALATE"|"APPROVAL_REQUIRED"|"AUTHORITY_UNAVAILABLE";
  evaluated_at:string;
  expires_at?:string|null;
  effective_score?:number;
  permissions?:readonly string[];
  entitlements?:readonly string[];
  context_revision?:string|null;
  account_revision?:string|null;
  policy_revision?:string|null;
}>;

export function createOfflineAuthorizationGate({
  clock=()=>Date.now(),
  max_policy_age_ms=5*60_000,
  offline_score_cap=50,
}:{
  clock?:()=>number;
  max_policy_age_ms?:number;
  offline_score_cap?:number;
}={}){
  if(!Number.isFinite(max_policy_age_ms)||max_policy_age_ms<0)throw new Error("max_policy_age_ms-invalid");
  if(!Number.isFinite(offline_score_cap)||offline_score_cap<0||offline_score_cap>100)throw new Error("offline_score_cap-invalid");

  const descriptor=Object.freeze({
    protocol:"titan.offline.authorization-contraction.v1" as const,
    company_boundary:"company_id" as const,
    contraction_only:true,
    cached_identity_grants_authority:false,
    cached_role_grants_authority:false,
    stale_policy_grants_authority:false,
    execution_authority:false,
  });

  function evaluate(
    contextInput:StorageContextInput,
    input:Readonly<{
      connectivity:"online"|"offline";
      authority_decision?:OfflineAuthorityDecision|null;
      worker_id:string;
      capability:string;
      operation_id:string;
      action_id:string;
      required_permissions?:readonly string[];
      required_entitlements?:readonly string[];
      current_context?:Readonly<{
        company_id?:string;
        context_revision?:string|null;
        account_revision?:string|null;
        policy_revision?:string|null;
      }>;
      minimum_score?:number;
      mutating?:boolean;
      protected_action?:boolean;
    }>
  ){
    assertNoLegacyStorageBoundary(input,"offline-authorization");
    const context=normalizeStorageContext(contextInput);
    assertCompany(input,context.company_id,"offline-authorization");
    const now=Number(clock());
    const required_permissions=[...(input.required_permissions??[])].map(x=>text(x,"required_permission"));
    const required_entitlements=[...(input.required_entitlements??[])].map(x=>text(x,"required_entitlement"));
    const worker_id=text(input.worker_id,"worker_id");
    const capability=text(input.capability,"capability");
    const operation_id=text(input.operation_id,"operation_id");
    const action_id=text(input.action_id,"action_id");
    const minimum_score=Number(input.minimum_score??1);
    if(!Number.isFinite(minimum_score)||minimum_score<0||minimum_score>100)throw new Error("minimum_score-invalid");

    const decision=input.authority_decision;
    const deny=(reason:string,extra:Record<string,unknown>={})=>Object.freeze({
      schema:"titan.offline.authorization-result.v1",
      company_id:context.company_id,
      allowed:false,
      decision:"AUTHORITY_UNAVAILABLE" as const,
      reason,
      connectivity:input.connectivity,
      effective_score:0,
      authority_decision_id:decision?.authority_decision_id??null,
      authority_neutral:true,
      grants_authority:false,
      identity_grants_authority:false,
      ...extra
    });

    if(!decision)return deny("fresh_authority_decision_required");
    assertCompany(decision,context.company_id,"offline-authorization.decision");
    if(decision.company_id!==context.company_id)return deny("authority_company_mismatch");
    if(decision.worker_id!==worker_id||decision.capability!==capability||decision.operation_id!==operation_id||decision.action_id!==action_id){
      return deny("authority_binding_mismatch");
    }
    if(decision.decision!=="ALLOW")return deny(`authority_${String(decision.decision).toLowerCase()}`);
    const evaluated=isoMs(decision.evaluated_at,"authority_evaluated_at");
    if(evaluated>now)return deny("authority_evaluated_in_future");
    if(decision.expires_at&&isoMs(decision.expires_at,"authority_expires_at")<=now)return deny("authority_expired");
    const age=now-evaluated;
    if(age>max_policy_age_ms)return deny("policy_context_stale",{authority_age_ms:age,max_policy_age_ms});

    const current=input.current_context??{};
    if(current.company_id&&current.company_id!==context.company_id)return deny("current_context_company_mismatch");
    for(const field of ["context_revision","account_revision","policy_revision"] as const){
      const expected=String(decision[field]??"").trim();
      const actual=String(current[field]??"").trim();
      if(expected&&!actual)return deny(`current_${field}_required`);
      if(expected&&actual&&expected!==actual)return deny(`${field}_mismatch`);
    }

    const permissions=new Set((decision.permissions??[]).map(String));
    const entitlements=new Set((decision.entitlements??[]).map(String));
    if(required_permissions.some(x=>!permissions.has(x)))return deny("missing_permission");
    if(required_entitlements.some(x=>!entitlements.has(x)))return deny("missing_entitlement");

    const sourceScore=Number(decision.effective_score??0);
    if(!Number.isFinite(sourceScore)||sourceScore<0||sourceScore>100)return deny("authority_score_invalid");
    let effective=Math.min(100,sourceScore);
    const reasons:string[]=[];
    if(input.connectivity==="offline"){
      effective=Math.min(effective,offline_score_cap);
      reasons.push("offline_contraction");
      if(input.protected_action===true)return deny("protected_action_requires_online_fresh_authority",{source_score:sourceScore,effective_score:effective});
      if(input.mutating!==false&&effective<minimum_score)return deny("offline_authority_below_required",{source_score:sourceScore,effective_score:effective});
    }
    if(effective<minimum_score)return deny("authority_below_required",{source_score:sourceScore,effective_score:effective});

    return Object.freeze({
      schema:"titan.offline.authorization-result.v1",
      company_id:context.company_id,
      allowed:true,
      decision:"ALLOW" as const,
      reason:"fresh_contracted_authority_satisfied",
      reasons:Object.freeze(reasons),
      connectivity:input.connectivity,
      authority_decision_id:decision.authority_decision_id,
      source_score:sourceScore,
      effective_score:effective,
      authority_age_ms:age,
      max_policy_age_ms,
      authority_neutral:true,
      grants_authority:false,
      identity_grants_authority:false,
    });
  }

  return Object.freeze({descriptor,evaluate});
}
