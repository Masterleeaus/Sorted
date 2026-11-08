export const TITAN_VISUAL_EVIDENCE_CONTRACT={schema:"titan.visual-evidence/v1",authority:"observation-and-review-proposal-only",model_owner:"#1055",evidence_owner:"#913"} as const;
export type VisualUncertainty="LOW"|"MEDIUM"|"HIGH"|"UNAVAILABLE";
export type ReviewState="PENDING"|"HUMAN_REVIEW"|"ACCEPTED_OBSERVATION"|"REJECTED";
export type EvidenceRef=Readonly<{company_id:string;evidence_id:string;revision:number;subject_type:"visit"|"job"|"asset"|"inspection";subject_id:string;captured_at:string;purpose:"quality"|"before-after"|"asset-passport"|"safety"|"completion-assurance"|"quote-variation";consent_ref:string;media_ref:string;mime_type:string;byte_size:number;accepted:boolean}>;
export type TitanVisualAnalysisRequest=Readonly<{request_id:string;company_id:string;subject_type:EvidenceRef["subject_type"];subject_id:string;source_revision:number;evidence_refs:readonly EvidenceRef[];purpose:EvidenceRef["purpose"];consent_ref:string;created_at:string;offline:boolean;max_payload_bytes:number}>;
export type VisualFinding=Readonly<{finding_id:string;category:"quality"|"change"|"safety"|"completion"|"asset-identity"|"quote-variation";summary:string;explanation:string;source_refs:readonly string[];confidence:number;uncertainty:VisualUncertainty;review_state:ReviewState;contradictory?:boolean;verified:false}>;
export type VisualResult=Readonly<{schema:string;request_id:string;company_id:string;subject_type:EvidenceRef["subject_type"];subject_id:string;source_revision:number;captured_at:string;observed_at:string;purpose:EvidenceRef["purpose"];provider_ref:string;model_ref:string;method_version:string;confidence:number;uncertainty:VisualUncertainty;review_state:ReviewState;findings:readonly VisualFinding[];lineage:Readonly<{source_evidence_refs:readonly string[];derivation_ref:string;review_decision_ref:string|null;observed_verification_ref:string|null}>;prompt_data:Readonly<{media_refs:readonly string[];included_fields:readonly string[];raw_media_logged:false;secrets_included:false}>;authority_effect:false;verified:false}>;
export type VisualProvider=Readonly<{id:string;model_ref:string;health:"healthy"|"degraded"|"offline";analyze:(input:Readonly<{request_id:string;company_id:string;subject_type:string;subject_id:string;purpose:string;media_refs:readonly string[];source_revision:number}> )=>Promise<Readonly<{confidence:number;findings:readonly Omit<VisualFinding,"review_state"|"verified"|"finding_id">[];method_version:string}>>}>;
export type CaptureChecklist=Readonly<{id:string;revision:number;company_id:string;subject_type:string;items:readonly Readonly<{id:string;label:string;required:boolean;purpose:string}>[]}>;
export type CaptureGuidance=Readonly<{checklist_id:string;checklist_revision:number;company_id:string;subject_id:string;missing_items:readonly string[];quality:"READY"|"INCOMPLETE"|"LOW_QUALITY";offline_queued:boolean;source_refs:readonly string[];authority_effect:false}>;
export type VisualProposal=Readonly<{proposal_id:string;company_id:string;kind:"CHANGE_FINDING"|"ASSET_PASSPORT"|"INSPECTION_PROFILE"|"COMPLETION_ASSURANCE"|"QUOTE_VARIATION";source_revision:number;finding_refs:readonly string[];evidence_refs:readonly string[];uncertainty:VisualUncertainty;review_state:"PENDING_REVIEW";authority_effect:false}>;
const need=(v:unknown,k:string)=>{const s=String(v??"").trim();if(!s)throw Error("visual_"+k+"_required");return s};
const iso=(v:string)=>{const n=new Date(v);if(!Number.isFinite(n.getTime()))throw Error("visual_time_invalid");return n.toISOString()};
const payloadSize=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)).byteLength;
const key=(v:unknown)=>{let h=2166136261;for(const c of JSON.stringify(v))h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0).toString(16)};
const validConfidence=(n:number)=>Number.isFinite(n)&&n>=0&&n<=1;
export function validateVisualRequest(r:TitanVisualAnalysisRequest):TitanVisualAnalysisRequest{
 need(r.request_id,"request_id");need(r.company_id,"company_id");need(r.subject_id,"subject_id");need(r.consent_ref,"consent_ref");
 if(!Number.isInteger(r.source_revision)||r.source_revision<1)throw Error("visual_source_revision_invalid");
 if(!r.evidence_refs.length)throw Error("visual_evidence_required");if(!Number.isFinite(r.max_payload_bytes)||r.max_payload_bytes<1)throw Error("visual_prompt_payload_limit_invalid");
 for(const e of r.evidence_refs){if(e.company_id!==r.company_id)throw Error("visual_cross_company_evidence");if(!e.accepted)throw Error("visual_evidence_not_accepted");if(e.subject_id!==r.subject_id||e.subject_type!==r.subject_type)throw Error("visual_subject_mismatch");if(e.consent_ref!==r.consent_ref)throw Error("visual_consent_mismatch");if(e.purpose!==r.purpose)throw Error("visual_purpose_mismatch");if(!Number.isInteger(e.revision)||e.revision<1)throw Error("visual_evidence_revision_invalid");if(!["image/jpeg","image/png","image/webp","image/heic"].includes(e.mime_type))throw Error("visual_format_unsupported");if(e.byte_size<=0||e.byte_size>20000000)throw Error("visual_media_size_invalid");iso(e.captured_at)}
 if(payloadSize({fields:["company_id","subject_type","subject_id","purpose","media_refs"],refs:r.evidence_refs.map(e=>e.media_ref)})>r.max_payload_bytes)throw Error("visual_prompt_payload_too_large");
 return r;
}
export type CaptureQualityPolicy=Readonly<{min_width:number;min_height:number;min_sharpness:number;min_exposure:number;min_subject_coverage:number;revision:number}>;
export type CaptureQualityAssessment=Readonly<{company_id:string;evidence_ref:string;policy_revision:number;quality:"ACCEPTABLE"|"RETAKE";reasons:readonly string[];guidance:readonly string[];source_ref:string;authority_effect:false}>;
export function assessCaptureQuality(i:{company_id:string;evidence:EvidenceRef;width:number;height:number;sharpness:number;exposure:number;subject_coverage:number;duplicate_of?:string|null;policy:CaptureQualityPolicy}):CaptureQualityAssessment{
 if(i.company_id!==i.evidence.company_id)throw Error("visual_cross_company_evidence");
 if(!i.evidence.accepted)throw Error("visual_evidence_not_accepted");
 if(!Number.isInteger(i.policy.revision)||i.policy.revision<1||!Number.isInteger(i.policy.min_width)||i.policy.min_width<1||!Number.isInteger(i.policy.min_height)||i.policy.min_height<1||![i.policy.min_sharpness,i.policy.min_exposure,i.policy.min_subject_coverage].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error("visual_quality_policy_invalid");
 for(const n of [i.width,i.height])if(!Number.isFinite(n)||n<0)throw Error("visual_quality_dimensions_invalid");
 for(const n of [i.sharpness,i.exposure,i.subject_coverage])if(!Number.isFinite(n)||n<0||n>1)throw Error("visual_quality_metric_invalid");
 const reasons:string[]=[];const guidance:string[]=[];
 if(i.width<i.policy.min_width||i.height<i.policy.min_height){reasons.push("RESOLUTION_LOW");guidance.push("Move closer and recapture at full resolution.");}
 if(i.sharpness<i.policy.min_sharpness){reasons.push("IMAGE_BLURRY");guidance.push("Hold the camera steady, focus on the work, and retake.");}
 if(i.exposure<i.policy.min_exposure){reasons.push("EXPOSURE_LOW");guidance.push("Improve lighting and retake the image.");}
 if(i.subject_coverage<i.policy.min_subject_coverage){reasons.push("SUBJECT_TOO_SMALL");guidance.push("Frame the subject more clearly and retake.");}
 if(i.duplicate_of){reasons.push("DUPLICATE_IMAGE");guidance.push("Capture a distinct view of the required evidence.");}
 return{company_id:i.company_id,evidence_ref:i.evidence.evidence_id+":"+i.evidence.revision,policy_revision:i.policy.revision,quality:reasons.length?"RETAKE":"ACCEPTABLE",reasons,guidance,source_ref:i.evidence.evidence_id+":"+i.evidence.revision,authority_effect:false};
}
export function createCaptureGuidance(i:{checklist:CaptureChecklist;company_id:string;subject_id:string;captured:readonly EvidenceRef[];offline:boolean;low_quality_refs?:readonly string[];quality_reports?:readonly CaptureQualityAssessment[]}):CaptureGuidance{
 if(i.checklist.company_id!==i.company_id)throw Error("visual_checklist_company_mismatch");
 const mine=i.captured.filter(e=>e.accepted&&e.company_id===i.company_id&&e.subject_id===i.subject_id&&e.subject_type===i.checklist.subject_type);
 const have=new Set(mine.map(e=>e.evidence_id));
 const missing=i.checklist.items.filter(x=>x.required&&!have.has(x.id)).map(x=>x.id);
 const low=new Set((i.low_quality_refs??[]).filter(ref=>have.has(ref)));for(const report of i.quality_reports??[]){if(report.company_id!==i.company_id)throw Error("visual_cross_company_quality_report");const source=mine.find(e=>report.evidence_ref===e.evidence_id+":"+e.revision);if(source&&report.quality==="RETAKE")low.add(source.evidence_id);}
 return{checklist_id:i.checklist.id,checklist_revision:i.checklist.revision,company_id:i.company_id,subject_id:i.subject_id,missing_items:missing,quality:low.size?"LOW_QUALITY":missing.length?"INCOMPLETE":"READY",offline_queued:i.offline,source_refs:mine.map(e=>e.evidence_id+":"+e.revision),authority_effect:false};
}
export function pairBeforeAfter(before:EvidenceRef,after:EvidenceRef,company_id:string){
 if(before.company_id!==company_id||after.company_id!==company_id)throw Error("visual_cross_company_evidence");
 if(before.subject_type!==after.subject_type||before.subject_id!==after.subject_id||before.purpose!==after.purpose||before.purpose!=="before-after")throw Error("visual_comparison_subject_mismatch");
 if(!before.accepted||!after.accepted)throw Error("visual_evidence_not_accepted");
 if(new Date(after.captured_at)<new Date(before.captured_at))throw Error("visual_comparison_time_order_invalid");
 return{company_id,before_ref:before.evidence_id+":"+before.revision,after_ref:after.evidence_id+":"+after.revision,basis:"same-subject-purpose" as const,source_revision:Math.max(before.revision,after.revision),captured_at:[iso(before.captured_at),iso(after.captured_at)] as const};
}
export async function analyzeVisualEvidence(r:TitanVisualAnalysisRequest,provider:VisualProvider|null,opts:{min_confidence?:number;source_revision_now?:number;provider_timeout_ms?:number}={}):Promise<VisualResult>{
 validateVisualRequest(r);const refs=r.evidence_refs.map(e=>e.evidence_id+":"+e.revision),base={schema:TITAN_VISUAL_EVIDENCE_CONTRACT.schema,request_id:r.request_id,company_id:r.company_id,subject_type:r.subject_type,subject_id:r.subject_id,source_revision:r.source_revision,captured_at:r.evidence_refs.map(e=>e.captured_at).sort()[0],observed_at:new Date().toISOString(),purpose:r.purpose,provider_ref:provider?.id??"native-offline",model_ref:provider?.model_ref??"none",method_version:"native-guidance/v1",confidence:0,uncertainty:"UNAVAILABLE" as VisualUncertainty,review_state:"HUMAN_REVIEW" as ReviewState,findings:[] as VisualFinding[],lineage:{source_evidence_refs:refs,derivation_ref:"visual:"+key({request:r.request_id,refs}),review_decision_ref:null,observed_verification_ref:null},prompt_data:{media_refs:[] as string[],included_fields:["company_id","subject_type","subject_id","purpose","evidence_refs","source_revision"],raw_media_logged:false as const,secrets_included:false as const},authority_effect:false as const,verified:false as const};
 if(r.offline||!provider||provider.health==="offline"||opts.source_revision_now!==undefined&&opts.source_revision_now!==r.source_revision)return{...base,uncertainty:"UNAVAILABLE",review_state:"HUMAN_REVIEW"};
 try{let timeout:ReturnType<typeof setTimeout>|undefined;const result=await Promise.race([provider.analyze({request_id:r.request_id,company_id:r.company_id,subject_type:r.subject_type,subject_id:r.subject_id,purpose:r.purpose,media_refs:r.evidence_refs.map(e=>e.media_ref),source_revision:r.source_revision}),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error("visual_provider_timeout")),opts.provider_timeout_ms??5000)})]).finally(()=>{if(timeout!==undefined)clearTimeout(timeout)});
 if(!validConfidence(result.confidence))throw Error("visual_provider_confidence_invalid");
 const conflict=opts.source_revision_now!==undefined&&opts.source_revision_now!==r.source_revision;
 const allowedRefs=new Set(refs);const findings=result.findings.slice(0,100).map((f,i)=>({finding_id:"finding:"+key([r.request_id,i,f]),...f,confidence:validConfidence(f.confidence)?f.confidence:0,review_state:conflict||f.contradictory===true||f.source_refs.some(ref=>!allowedRefs.has(ref))||f.uncertainty==="HIGH"||f.confidence<(opts.min_confidence??.65)?"HUMAN_REVIEW" as const:"PENDING" as const,verified:false as const}));
 const review=conflict||result.confidence<(opts.min_confidence??.65)||findings.some(f=>f.review_state==="HUMAN_REVIEW"||f.contradictory===true)?"HUMAN_REVIEW" as const:"PENDING" as const;
 return{...base,provider_ref:provider.id,model_ref:provider.model_ref,method_version:result.method_version,confidence:result.confidence,uncertainty:conflict?"HIGH" as const:findings.some(f=>f.uncertainty==="HIGH")?"HIGH" as const:findings.some(f=>f.uncertainty==="MEDIUM")?"MEDIUM" as const:"LOW" as const,review_state:review,findings,lineage:{...base.lineage,derivation_ref:"visual:"+key({request:r.request_id,refs,model:provider.model_ref,version:result.method_version})},prompt_data:{...base.prompt_data,media_refs:r.evidence_refs.map(e=>e.media_ref)}};
 }catch{return{...base,uncertainty:"UNAVAILABLE",review_state:"HUMAN_REVIEW"}}
}
export function createVisualProposal(i:{company_id:string;kind:VisualProposal["kind"];result:VisualResult;evidence_refs:readonly string[];source_revision:number}):VisualProposal{
 if(i.result.company_id!==i.company_id)throw Error("visual_cross_company_result");
 if(i.result.verified||i.result.authority_effect!==false)throw Error("visual_authority_forbidden");
 if(i.source_revision!==i.result.source_revision)throw Error("visual_source_revision_conflict");
 if(i.result.review_state==="REJECTED")throw Error("visual_result_rejected");
 return{proposal_id:"proposal:"+key([i.company_id,i.kind,i.result.request_id,i.source_revision]),company_id:i.company_id,kind:i.kind,source_revision:i.source_revision,finding_refs:i.result.findings.map(f=>f.finding_id),evidence_refs:[...new Set([...i.evidence_refs,...i.result.lineage.source_evidence_refs])],uncertainty:i.result.uncertainty,review_state:"PENDING_REVIEW",authority_effect:false};
}
export function recordVisualReview(p:VisualProposal,i:{company_id:string;reviewer_ref:string;decision:"ACCEPT_OBSERVATION"|"REJECT";reason:string;current_source_revision:number;fresh_authority_ref:string|null}){
 need(i.reviewer_ref,"reviewer");need(i.reason,"review_reason");if(i.company_id!==p.company_id)throw Error("visual_review_company_mismatch");if(i.current_source_revision!==p.source_revision)throw Error("visual_source_revision_conflict");
 if(i.decision==="ACCEPT_OBSERVATION"&&!i.fresh_authority_ref)throw Error("visual_fresh_authority_required");
 return{proposal_id:p.proposal_id,company_id:p.company_id,decision:i.decision,reviewer_ref:i.reviewer_ref,reason:i.reason,source_revision:p.source_revision,authority_decision_ref:i.fresh_authority_ref,accepted_as:i.decision==="ACCEPT_OBSERVATION"?"OBSERVATION" as const:null,verified:false as const,reviewed_at:new Date().toISOString()};
}
export function recordVisualVerification(i:{company_id:string;proposal:VisualProposal;review:ReturnType<typeof recordVisualReview>;observed_ref:string;verification_ref:string;current_source_revision:number;authority_valid:boolean}){
 if(i.company_id!==i.proposal.company_id||i.review.company_id!==i.company_id||i.review.proposal_id!==i.proposal.proposal_id)throw Error("visual_verification_company_mismatch");if(i.current_source_revision!==i.proposal.source_revision)throw Error("visual_source_revision_conflict");if(i.review.decision!=="ACCEPT_OBSERVATION"||i.review.accepted_as!=="OBSERVATION")throw Error("visual_human_acceptance_required");if(!i.review.authority_decision_ref||!i.authority_valid)throw Error("visual_fresh_authority_required");need(i.observed_ref,"observed_outcome");need(i.verification_ref,"verification_ref");
 return{company_id:i.company_id,proposal_id:i.proposal.proposal_id,review_decision_ref:i.review.authority_decision_ref,observed_ref:i.observed_ref,verification_ref:i.verification_ref,verified_by_observation:true,model_output_used_as_proof:false as const};
}
export function createVisualChecklistProposal(i:{company_id:string;version:number;items:CaptureChecklist["items"];source:"vertical-pack"|"business-standards"}){
 if(!Number.isInteger(i.version)||i.version<1||!i.items.length)throw Error("visual_profile_invalid");
 return{proposal_id:"profile:"+key(i),company_id:i.company_id,version:i.version,items:i.items.map(x=>({...x})),source:i.source,review_state:"PENDING_REVIEW" as const,effective_company_policy:false as const};
}

export async function prepareVisitCloseoutVisualAssurance(i:{request:TitanVisualAnalysisRequest;checklist:CaptureChecklist;captured:readonly EvidenceRef[];before:EvidenceRef;after:EvidenceRef;quality_reports?:readonly CaptureQualityAssessment[];provider:VisualProvider|null;online:boolean;source_revision_now:number}){
 const guidance=createCaptureGuidance({checklist:i.checklist,company_id:i.request.company_id,subject_id:i.request.subject_id,captured:i.captured,offline:!i.online,quality_reports:i.quality_reports});
 const comparison=pairBeforeAfter(i.before,i.after,i.request.company_id);
 const result=await analyzeVisualEvidence({...i.request,offline:i.request.offline||!i.online},i.provider,{source_revision_now:i.source_revision_now});
 const proposal=createVisualProposal({company_id:i.request.company_id,kind:"COMPLETION_ASSURANCE",result,evidence_refs:[comparison.before_ref,comparison.after_ref],source_revision:i.request.source_revision});
 return{guidance,comparison,result,proposal,review_required:guidance.quality!=="READY"||result.review_state==="HUMAN_REVIEW"||result.uncertainty==="HIGH"||result.uncertainty==="UNAVAILABLE",completion_asserted:false as const,authority_effect:false as const,mutation_requires_governed_execution:true as const};
}
