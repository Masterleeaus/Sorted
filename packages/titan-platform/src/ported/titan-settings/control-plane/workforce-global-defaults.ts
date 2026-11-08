// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/workforce-global-defaults.mjs
const clean=(v,max=180)=>String(v??'').trim().slice(0,max);
const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const URGENCIES=['LOW','NORMAL','HIGH','CRITICAL'];
function rejectLegacy(v,path='workforce-global-defaults'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!/^[A-Za-z0-9._:-]{2,128}$/.test(id))throw new Error('workforce-global-defaults-company_id-required');return id;}
function int(v,min,max,d){const n=Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.trunc(n))):d;}
function bool(v,d){return typeof v==='boolean'?v:d;}
function normalizedAckMinutes(v={}){const out={LOW:0,NORMAL:0,HIGH:30,CRITICAL:10};for(const k of URGENCIES){if(Object.prototype.hasOwnProperty.call(v,k))out[k]=int(v[k],0,1440,out[k]);}return out;}
export const WORKFORCE_GLOBAL_DEFAULTS=Object.freeze({
  notifications:Object.freeze({ack_minutes_by_urgency:Object.freeze({LOW:0,NORMAL:0,HIGH:30,CRITICAL:10}),max_delivery_attempts:3,max_escalation_depth:2,cooldown_ms:300000}),
  evidence:Object.freeze({supervisor_handover_evidence_required:true,prefer_evidence_backed_performance:true,investigation_finding_evidence_required:true}),
  coordination:Object.freeze({require_coordination_owner:true,supervisor_handover_transfers_authority:false}),
  staffing:Object.freeze({proposal_only:true,automatic_reassignment:false,automatic_staffing_change:false}),
  mission_teams:Object.freeze({automatic_activation:false,team_membership_confers_authority:false})
});
export function projectWorkforceGlobalDefaults(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const raw=input.workforceGlobalDefaults||input.defaults||{};rejectLegacy(raw);
  const contractions=[];
  if(raw?.evidence?.supervisor_handover_evidence_required===false)contractions.push('supervisor_handover_evidence_mandatory');
  if(raw?.staffing?.proposal_only===false||raw?.staffing?.automatic_reassignment===true||raw?.staffing?.automatic_staffing_change===true)contractions.push('staffing_remains_proposal_only');
  if(raw?.mission_teams?.automatic_activation===true)contractions.push('mission_team_activation_requires_governed_runtime');
  if(raw?.coordination?.supervisor_handover_transfers_authority===true)contractions.push('handover_never_transfers_authority');
  const p={
    schema:'titan.settings.workforce-global-defaults.v1',company_id,
    notifications:{ack_minutes_by_urgency:normalizedAckMinutes(raw?.notifications?.ack_minutes_by_urgency),max_delivery_attempts:int(raw?.notifications?.max_delivery_attempts,1,10,3),max_escalation_depth:int(raw?.notifications?.max_escalation_depth,0,5,2),cooldown_ms:int(raw?.notifications?.cooldown_ms,1000,86400000,300000)},
    evidence:{supervisor_handover_evidence_required:true,prefer_evidence_backed_performance:bool(raw?.evidence?.prefer_evidence_backed_performance,true),investigation_finding_evidence_required:true},
    coordination:{require_coordination_owner:bool(raw?.coordination?.require_coordination_owner,true),supervisor_handover_transfers_authority:false},
    staffing:{proposal_only:true,automatic_reassignment:false,automatic_staffing_change:false},
    mission_teams:{automatic_activation:false,team_membership_confers_authority:false},
    contractions:[...new Set(contractions)].sort(),
    runtime_owners:['titan-workforce/notifications/workforce-notification-escalation-runtime.js','titan-workforce/supervision/supervisor-runtime.js','titan-workforce/performance/performance-outcome-runtime.js','titan-workforce/coordination/chief-of-staff-runtime.js','titan-workforce/staffing/dynamic-staffing-runtime.js','titan-workforce/mission/mission-team-runtime.js'],
    settings_can_grant_authority:false,settings_can_execute:false,execution_allowed:false,authority_granted:false,grants_authority:false
  };return p;
}
export function buildWorkforceNotificationDefaults(projection={},input={}){
  const company_id=company(projection.company_id);if(input.company_id&&clean(input.company_id,128)!==company_id)throw new Error('workforce-global-defaults-cross-company-notification');const urgency=clean(input.urgency||'NORMAL',40).toUpperCase();if(!URGENCIES.includes(urgency))throw new Error(`workforce-global-defaults-invalid-urgency:${urgency}`);const now=Number(input.now||Date.now());const minutes=Number(projection.notifications?.ack_minutes_by_urgency?.[urgency]??0);const ack_required=minutes>0;return {company_id,urgency,ack_required,ack_deadline_at:ack_required?now+minutes*60000:null,max_delivery_attempts:int(projection.notifications?.max_delivery_attempts,1,10,3),max_escalation_depth:int(projection.notifications?.max_escalation_depth,0,5,2),cooldown_ms:int(projection.notifications?.cooldown_ms,1000,86400000,300000),automatic_dispatch:false,automatic_escalation:false,requires_governed_transition:true,grants_authority:false,execution_permitted:false};
}
export function evaluateWorkforceGlobalDefaults(projection={},runtime={}){
  const company_id=company(projection.company_id);if(runtime.company_id&&clean(runtime.company_id,128)!==company_id)throw new Error('workforce-global-defaults-cross-company-runtime');return {schema:'titan.settings.workforce-global-defaults-evaluation.v1',company_id,requires_coordination_review:projection.coordination?.require_coordination_owner===true&&Number(runtime.responsibility_gap_count||0)>0,requires_evidence:projection.evidence?.supervisor_handover_evidence_required===true,prefer_evidence_backed_performance:projection.evidence?.prefer_evidence_backed_performance===true,staffing_proposal_only:true,automatic_reassignment:false,automatic_mission_activation:false,settings_can_grant_authority:false,execution_allowed:false,grants_authority:false};
}
