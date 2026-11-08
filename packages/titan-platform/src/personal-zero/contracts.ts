export const PERSONAL_ZERO_PROTOCOL = "titan.personal-zero.v1";
export const PERSONAL_ZERO_VERSION = 1 as const;
export type PersonalZeroPrivacyClass = "personal_private" | "company_restricted" | "shareable";
export type UnderstandingStatus = "candidate" | "accepted" | "superseded" | "expired" | "deleted";
export type CognitiveEventType = "observation"|"recommendation"|"correction"|"approval"|"rejection"|"decision"|"action"|"outcome"|"prediction"|"prediction_scored"|"understanding_candidate"|"understanding_accepted"|"understanding_superseded";
export type OneIdentity=Readonly<{one_id:string;zero_id:string}>;
export type ZeroIdentity=Readonly<{zero_id:string;one_id:string;protocol:typeof PERSONAL_ZERO_PROTOCOL;created_at:number}>;
export type CompanyRelationship=Readonly<{relationship_id:string;one_id:string;zero_id:string;company_id:string;role_refs:readonly string[];capability_refs:readonly string[];authority_refs:readonly string[];data_visibility_refs:readonly string[];status:"active"|"revoked";activated_at:number;revoked_at:number|null}>;
export type EvidenceReference=Readonly<{evidence_id:string;source:string;provenance_ref:string}>;
export type UnderstandingEvidence=Readonly<{schema:"titan.personal-zero.understanding-evidence.v1";version:1;understanding_evidence_id:string;one_id:string;zero_id:string;company_id:string;relationship_id:string|null;subject:string;value:unknown;evidence:readonly EvidenceReference[];confidence:number;observed_at:number;fresh_until:number|null;privacy_class:PersonalZeroPrivacyClass;provider_egress_allowed:boolean;correction_of:string|null}>;
export type UnderstandingState=Readonly<{schema:"titan.personal-zero.understanding-state.v1";schema_version:1;understanding_id:string;one_id:string;zero_id:string;company_id:string;relationship_id:string|null;subject:string;value:unknown;status:UnderstandingStatus;evidence_refs:readonly string[];confidence:number;version:number;supersedes_understanding_id:string|null;created_at:number;updated_at:number}>;
export type ExperienceRecord=Readonly<{schema:"titan.personal-zero.experience.v1";version:1;experience_id:string;one_id:string;zero_id:string;company_id:string;relationship_id:string|null;context_refs:readonly string[];decision_ref:string|null;action_ref:string|null;expected_outcome:unknown;verified_outcome_ref:string|null;actual_outcome:unknown;unintended_effects:readonly unknown[];lesson:unknown;confidence:number;future_applicability:readonly string[];created_at:number}>;
export type PredictionCalibration=Readonly<{prediction_event_id:string;outcome_event_id:string;predicted_probability:number;actual:boolean;brier_score:number;scored_at:number;authority_neutral:true}>;
export type CrossContextShareGrant=Readonly<{grant_id:string;one_id:string;zero_id:string;source_company_id:string;source_relationship_id:string;target_company_id:string;target_relationship_id:string;subject_refs:readonly string[];purpose:string;consent_ref:string;allow_personal_private:false;expires_at:number|null;revoked_at:number|null;created_at:number;authority_neutral:true}>;
export type RetentionPolicy=Readonly<{retain_until:number|null;delete_after_expiry:boolean}>;
export type CognitiveEvent=Readonly<{schema:"titan.personal-zero.cognitive-event.v1";version:1;event_id:string;one_id:string;zero_id:string;company_id:string;relationship_id:string|null;type:CognitiveEventType;payload:unknown;evidence_refs:readonly string[];confidence:number;privacy_class:PersonalZeroPrivacyClass;parent_event_id:string|null;correlation_id:string|null;operation_id:string|null;occurred_at:number;authority_neutral:true;execution_authority:false}>;

export type TitanSurface="zero"|"go"|"hub";
export type InteractionChannel="web"|"mobile"|"browser"|"voice";
export type WorkforceTier="orchestrator"|"manager"|"specialist"|"worker";
export type CompanyRealityKind="state"|"configuration"|"intelligence";
export type CapabilityAuthorityState="observe"|"recommend"|"prepare_ask"|"execute_within_policy"|"execute_and_report";
export type ZeroSurfaceProjection=Readonly<{protocol:"titan.zero-surface-projection.v1";one_id:string;zero_id:string;company_id:string;relationship_id:string;surface:TitanSurface;channel:InteractionChannel;role_refs:readonly string[];capability_refs:readonly string[];authority_refs:readonly string[];data_visibility_refs:readonly string[];authority_neutral:true;execution_authority:false}>;
export type WorkforceDelegationBoundary=Readonly<{protocol:"titan.zero-workforce-delegation.v1";intent_id:string;one_id:string;zero_id:string;company_id:string;relationship_id:string;workforce_actor_id:string;workforce_tier:WorkforceTier;capability_id:string;authority_ref:string;decision_ref:string;execution_gateway_required:true;zero_execution_authority:false}>;
export type CompanyRealityReference=Readonly<{protocol:"titan.company-reality-reference.v1";company_id:string;kind:CompanyRealityKind;ref:string;copied_payload:false;authority_neutral:true;execution_authority:false}>;
export type CapabilityAuthorityPolicy=Readonly<{protocol:"titan.capability-authority-policy.v1";capability_id:string;state:CapabilityAuthorityState;predictive:boolean;confidence:number;authority_ref:string;authority_neutral:true;execution_authority:false}>;
export type OneUnavailableResolution=Readonly<{protocol:"titan.one-unavailable-boundary.v1";action:"continue_within_envelope"|"queue_or_escalate"|"handoff";authority_state:CapabilityAuthorityState;authority_expanded:false;delegate_one_id:string|null;delegate_authority_ref:string|null}>;

export const ZERO_PERSONNEL_BOUNDARY=Object.freeze({
  protocol:"titan.zero-personnel-boundary.v1",
  identity_owner:"one",
  one_zero_cardinality:"one_zero_per_one",
  digital_twin:false,
  model_provider:false,
  workforce_manager:false,
  execution_authority:false,
  workforce_execution:"delegated_workforce",
  consequential_execution:"execution_gateway",
  company_reality:Object.freeze(["state","configuration","intelligence"] as const),
});

const cleanId=(value:unknown,field:string)=>{const out=String(value??"").trim();if(!out)throw new Error(`${field} is required`);return out};
const validConfidence=(value:unknown)=>{const out=Number(value);if(!Number.isFinite(out)||out<0||out>1)throw new Error("confidence must be between 0 and 1");return out};
const SURFACES=new Set<TitanSurface>(["zero","go","hub"]);
const CHANNELS=new Set<InteractionChannel>(["web","mobile","browser","voice"]);
const WORKFORCE_TIERS=new Set<WorkforceTier>(["orchestrator","manager","specialist","worker"]);
const AUTHORITY_STATES=new Set<CapabilityAuthorityState>(["observe","recommend","prepare_ask","execute_within_policy","execute_and_report"]);
const COMPANY_REALITY_KINDS=new Set<CompanyRealityKind>(["state","configuration","intelligence"]);

export function createOneIdentity(input:{one_id:string;zero_id:string}):OneIdentity{return Object.freeze({one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id")})}
export function createZeroIdentity(input:{zero_id:string;one_id:string;created_at?:number}):ZeroIdentity{return Object.freeze({zero_id:cleanId(input.zero_id,"zero_id"),one_id:cleanId(input.one_id,"one_id"),protocol:PERSONAL_ZERO_PROTOCOL,created_at:Number(input.created_at??Date.now())})}
export function createCompanyRelationship(input:Omit<CompanyRelationship,"status"|"revoked_at"> & {status?:"active"|"revoked";revoked_at?:number|null}):CompanyRelationship{const status=input.status??"active";return Object.freeze({...input,relationship_id:cleanId(input.relationship_id,"relationship_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),company_id:cleanId(input.company_id,"company_id"),role_refs:Object.freeze([...input.role_refs]),capability_refs:Object.freeze([...input.capability_refs]),authority_refs:Object.freeze([...input.authority_refs]),data_visibility_refs:Object.freeze([...input.data_visibility_refs]),status,revoked_at:status==="revoked"?Number(input.revoked_at??Date.now()):null})}
export function createUnderstandingEvidence(input:Omit<UnderstandingEvidence,"schema"|"version">):UnderstandingEvidence{return Object.freeze({...input,schema:"titan.personal-zero.understanding-evidence.v1",version:1,understanding_evidence_id:cleanId(input.understanding_evidence_id,"understanding_evidence_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),company_id:cleanId(input.company_id,"company_id"),confidence:validConfidence(input.confidence),evidence:Object.freeze([...input.evidence]),provider_egress_allowed:input.privacy_class==="personal_private"?false:Boolean(input.provider_egress_allowed)})}
export function createUnderstandingState(input:Omit<UnderstandingState,"schema"|"schema_version">):UnderstandingState{if(input.status==="accepted"&&!input.evidence_refs.length)throw new Error("accepted understanding requires evidence");return Object.freeze({...input,schema:"titan.personal-zero.understanding-state.v1",schema_version:1,understanding_id:cleanId(input.understanding_id,"understanding_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),company_id:cleanId(input.company_id,"company_id"),confidence:validConfidence(input.confidence),evidence_refs:Object.freeze([...input.evidence_refs])})}
export function createExperienceRecord(input:Omit<ExperienceRecord,"schema"|"version">):ExperienceRecord{if(input.actual_outcome!=null&&!input.verified_outcome_ref)throw new Error("actual outcome requires verified_outcome_ref");return Object.freeze({...input,schema:"titan.personal-zero.experience.v1",version:1,experience_id:cleanId(input.experience_id,"experience_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),company_id:cleanId(input.company_id,"company_id"),confidence:validConfidence(input.confidence),context_refs:Object.freeze([...input.context_refs]),unintended_effects:Object.freeze([...input.unintended_effects]),future_applicability:Object.freeze([...input.future_applicability])})}
export function createCognitiveEvent(input:Omit<CognitiveEvent,"authority_neutral"|"execution_authority">):CognitiveEvent{return Object.freeze({...input,schema:"titan.personal-zero.cognitive-event.v1",version:1,event_id:cleanId(input.event_id,"event_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),company_id:cleanId(input.company_id,"company_id"),confidence:validConfidence(input.confidence),evidence_refs:Object.freeze([...input.evidence_refs]),authority_neutral:true,execution_authority:false})}

export function createZeroSurfaceProjection(relationship:CompanyRelationship,input:{surface:TitanSurface;channel:InteractionChannel}):ZeroSurfaceProjection{
  if(relationship.status!=="active")throw new Error("Zero surface projection requires active company relationship");
  const surface=String(input.surface) as TitanSurface;const channel=String(input.channel) as InteractionChannel;
  if(!SURFACES.has(surface))throw new Error("invalid Titan surface");
  if(!CHANNELS.has(channel))throw new Error("invalid interaction channel");
  return Object.freeze({protocol:"titan.zero-surface-projection.v1",one_id:relationship.one_id,zero_id:relationship.zero_id,company_id:relationship.company_id,relationship_id:relationship.relationship_id,surface,channel,role_refs:Object.freeze([...relationship.role_refs]),capability_refs:Object.freeze([...relationship.capability_refs]),authority_refs:Object.freeze([...relationship.authority_refs]),data_visibility_refs:Object.freeze([...relationship.data_visibility_refs]),authority_neutral:true,execution_authority:false});
}

export function createWorkforceDelegationBoundary(input:Omit<WorkforceDelegationBoundary,"protocol"|"execution_gateway_required"|"zero_execution_authority">):WorkforceDelegationBoundary{
  const zero_id=cleanId(input.zero_id,"zero_id");const workforce_actor_id=cleanId(input.workforce_actor_id,"workforce_actor_id");const workforce_tier=String(input.workforce_tier) as WorkforceTier;
  if(workforce_actor_id===zero_id)throw new Error("Zero cannot be the workforce execution actor");
  if(!WORKFORCE_TIERS.has(workforce_tier))throw new Error("invalid workforce tier");
  return Object.freeze({protocol:"titan.zero-workforce-delegation.v1",intent_id:cleanId(input.intent_id,"intent_id"),one_id:cleanId(input.one_id,"one_id"),zero_id,company_id:cleanId(input.company_id,"company_id"),relationship_id:cleanId(input.relationship_id,"relationship_id"),workforce_actor_id,workforce_tier,capability_id:cleanId(input.capability_id,"capability_id"),authority_ref:cleanId(input.authority_ref,"authority_ref"),decision_ref:cleanId(input.decision_ref,"decision_ref"),execution_gateway_required:true,zero_execution_authority:false});
}

export function createCompanyRealityReference(input:{company_id:string;kind:CompanyRealityKind;ref:string}):CompanyRealityReference{
  const kind=String(input.kind) as CompanyRealityKind;if(!COMPANY_REALITY_KINDS.has(kind))throw new Error("invalid company reality kind");
  return Object.freeze({protocol:"titan.company-reality-reference.v1",company_id:cleanId(input.company_id,"company_id"),kind,ref:cleanId(input.ref,"ref"),copied_payload:false,authority_neutral:true,execution_authority:false});
}

export function createCapabilityAuthorityPolicy(input:{capability_id:string;state:CapabilityAuthorityState;predictive:boolean;confidence:number;authority_ref:string}):CapabilityAuthorityPolicy{
  const state=String(input.state) as CapabilityAuthorityState;if(!AUTHORITY_STATES.has(state))throw new Error("invalid capability authority state");
  return Object.freeze({protocol:"titan.capability-authority-policy.v1",capability_id:cleanId(input.capability_id,"capability_id"),state,predictive:Boolean(input.predictive),confidence:validConfidence(input.confidence),authority_ref:cleanId(input.authority_ref,"authority_ref"),authority_neutral:true,execution_authority:false});
}

export function resolveOneUnavailableBoundary(input:{authority_state:CapabilityAuthorityState;delegated_work_active:boolean;delegate_one_id:string|null;delegate_authority_ref:string|null}):OneUnavailableResolution{
  const authority_state=String(input.authority_state) as CapabilityAuthorityState;if(!AUTHORITY_STATES.has(authority_state))throw new Error("invalid capability authority state");
  const delegate_one_id=String(input.delegate_one_id??"").trim()||null;const delegate_authority_ref=String(input.delegate_authority_ref??"").trim()||null;
  if(delegate_one_id&&delegate_authority_ref)return Object.freeze({protocol:"titan.one-unavailable-boundary.v1",action:"handoff",authority_state,authority_expanded:false,delegate_one_id,delegate_authority_ref});
  const executable=authority_state==="execute_within_policy"||authority_state==="execute_and_report";
  return Object.freeze({protocol:"titan.one-unavailable-boundary.v1",action:input.delegated_work_active&&executable?"continue_within_envelope":"queue_or_escalate",authority_state,authority_expanded:false,delegate_one_id:null,delegate_authority_ref:null});
}

export function scorePrediction(input:{prediction_event_id:string;outcome_event_id:string;predicted_probability:number;actual:boolean;scored_at?:number}):PredictionCalibration{const p=validConfidence(input.predicted_probability);const y=input.actual?1:0;return Object.freeze({...input,predicted_probability:p,brier_score:(p-y)**2,scored_at:Number(input.scored_at??Date.now()),authority_neutral:true})}
export function createCrossContextShareGrant(input:Omit<CrossContextShareGrant,"authority_neutral"|"allow_personal_private"> & {allow_personal_private?:false}):CrossContextShareGrant{if(input.source_company_id===input.target_company_id&&input.source_relationship_id===input.target_relationship_id)throw new Error("cross-context share requires distinct contexts");if(!input.subject_refs.length)throw new Error("cross-context share requires subject_refs");if(input.allow_personal_private!==undefined&&input.allow_personal_private!==false)throw new Error("personal_private cross-context sharing requires a stronger consent contract");return Object.freeze({...input,grant_id:cleanId(input.grant_id,"grant_id"),one_id:cleanId(input.one_id,"one_id"),zero_id:cleanId(input.zero_id,"zero_id"),source_company_id:cleanId(input.source_company_id,"source_company_id"),source_relationship_id:cleanId(input.source_relationship_id,"source_relationship_id"),target_company_id:cleanId(input.target_company_id,"target_company_id"),target_relationship_id:cleanId(input.target_relationship_id,"target_relationship_id"),subject_refs:Object.freeze([...input.subject_refs]),purpose:cleanId(input.purpose,"purpose"),consent_ref:cleanId(input.consent_ref,"consent_ref"),allow_personal_private:false,authority_neutral:true})}
export function isFresh(fresh_until:number|null,now=Date.now()){return fresh_until==null||fresh_until>now}
export function isRetained(policy:RetentionPolicy,now=Date.now()){return policy.retain_until==null||policy.retain_until>now}
