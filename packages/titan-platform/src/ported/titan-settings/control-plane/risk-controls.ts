// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-settings/control-plane/risk-controls.mjs
const LEGACY_ALIASES=Object.freeze(['tenant_id','tenant_company_id']);
export const RISK_CONTROL_LEVELS=Object.freeze(['low','medium','high','exceptional']);
const RANK=Object.freeze({low:0,medium:1,high:2,exceptional:3});
const DECISION_RANK=Object.freeze({ALLOW:0,REVIEW_REQUIRED:1,DENY:2});

function company(input){
  if(!input||typeof input!=='object')throw new Error('risk-controls-input-required');
  for(const key of LEGACY_ALIASES)if(Object.prototype.hasOwnProperty.call(input,key))throw new Error(`legacy-company-boundary-alias-forbidden:${key}`);
  const id=String(input.company_id??'').trim();
  if(!id)throw new Error('company_id-required');
  return id;
}
function level(value,fallback='low'){
  const v=String(value??fallback).trim().toLowerCase();
  if(!RISK_CONTROL_LEVELS.includes(v))throw new Error(`risk-level-invalid:${v}`);
  return v;
}
function stricterThreshold(requested,hardFloor){
  const r=level(requested,hardFloor), h=level(hardFloor);
  return RANK[r] <= RANK[h] ? r : h;
}
function higherRisk(a,b){return RANK[level(a)]>=RANK[level(b)]?level(a):level(b);}
function capabilityMinimums(raw){
  if(raw==null)return Object.freeze({});
  if(typeof raw!=='object'||Array.isArray(raw))throw new Error('risk-capability-minimum-levels-invalid');
  const out={};
  for(const [key,val] of Object.entries(raw)){
    const id=String(key).trim();
    if(id)out[id]=level(val);
  }
  return Object.freeze(out);
}
function atOrAbove(value,threshold){return RANK[level(value)]>=RANK[level(threshold)];}
function assertRuntimeCompany(company_id,obj,label){
  if(!obj||typeof obj!=='object')throw new Error(`${label}-required`);
  if(String(obj.company_id??'').trim()!==company_id)throw new Error(`risk-controls-company-mismatch:${label}`);
}

export function projectRiskControlSettings(input={}){
  const company_id=company(input);
  const settings=input.settings&&typeof input.settings==='object'?input.settings:{};
  const raw=settings.riskControlSettings&&typeof settings.riskControlSettings==='object'?settings.riskControlSettings:{};
  return Object.freeze({
    schema_version:'1.0',
    company_id,
    minimum_level:level(raw.minimum_level,'low'),
    capability_minimum_levels:capabilityMinimums(raw.capability_minimum_levels),
    escalation_at:stricterThreshold(raw.escalation_at,'high'),
    independent_review_at:stricterThreshold(raw.independent_review_at,'medium'),
    specialist_review_at:stricterThreshold(raw.specialist_review_at,'high'),
    require_human_review_on_exceptional:raw.require_human_review_on_exceptional!==false,
    block_unresolved_critical_physical_environmental_risk:raw.block_unresolved_critical_physical_environmental_risk!==false,
    runtime_classifier_remains_authoritative:true,
    settings_can_change_classifier_weights:false,
    settings_can_lower_runtime_risk:false,
    settings_can_accept_risk:false,
    settings_can_bypass_review:false,
    grants_authority:false,
    execution_permitted:false
  });
}

export function buildRiskControlProjection(input={}){
  const company_id=company(input);
  const projected=input.projected_settings;
  if(!projected||projected.company_id!==company_id)throw new Error('risk-controls-company-mismatch:projected-settings');
  const runtime=input.runtime_assessment;
  assertRuntimeCompany(company_id,runtime,'runtime-assessment');
  const capability=String(input.capability??'').trim();
  if(!capability)throw new Error('capability-required');
  const runtime_level=level(runtime.level);
  const configuredMinimum=projected.capability_minimum_levels?.[capability] ?? projected.minimum_level;
  const effective_level=higherRisk(runtime_level,configuredMinimum);
  const settings_raised_risk=RANK[effective_level]>RANK[runtime_level];
  const topology=runtime.topology_constraints&&typeof runtime.topology_constraints==='object'?runtime.topology_constraints:{};
  const runtimeIndependent=Number(topology.minimum_independent_paths||0)>=2 || topology.adversarial_review_required===true;
  const runtimeSpecialist=topology.specialist_review_required===true;
  const requires_independent_review=runtimeIndependent || atOrAbove(effective_level,projected.independent_review_at);
  const requires_specialist_review=runtimeSpecialist || atOrAbove(effective_level,projected.specialist_review_at);
  const requires_escalation=atOrAbove(effective_level,projected.escalation_at);
  const requires_human_review=projected.require_human_review_on_exceptional && effective_level==='exceptional';
  const reasons=[];
  if(settings_raised_risk)reasons.push(projected.capability_minimum_levels?.[capability]?'settings_capability_risk_floor':'settings_company_risk_floor');
  if(requires_escalation)reasons.push('risk_escalation_threshold_met');
  if(requires_independent_review)reasons.push('independent_review_required');
  if(requires_specialist_review)reasons.push('specialist_review_required');
  if(requires_human_review)reasons.push('exceptional_risk_human_review_required');
  return Object.freeze({
    schema_version:'1.0',company_id,capability,
    runtime_level,effective_level,
    runtime_score:Number.isFinite(Number(runtime.score))?Number(runtime.score):null,
    settings_raised_risk,
    requires_escalation,requires_independent_review,requires_specialist_review,requires_human_review,
    reason_codes:Object.freeze([...new Set(reasons)]),
    settings_lowered_runtime_risk:false,
    risk_accepted:false,
    authority_granted:false,
    execution_permitted:false
  });
}

export function evaluateRiskControlPolicy(input={}){
  const company_id=company(input);
  const projection=input.projection;
  if(!projection||projection.company_id!==company_id)throw new Error('risk-controls-company-mismatch:projection');
  const runtime=input.runtime_decision;
  assertRuntimeCompany(company_id,runtime,'runtime-decision');
  const physical=input.physical_environmental_decision??null;
  if(physical)assertRuntimeCompany(company_id,physical,'physical-environmental-decision');
  let decision=String(runtime.decision??'ALLOW').trim().toUpperCase();
  if(!(decision in DECISION_RANK))throw new Error(`risk-runtime-decision-invalid:${decision}`);
  const reasons=[...(Array.isArray(runtime.reason_codes)?runtime.reason_codes:[]),...(projection.reason_codes??[])];
  if(projection.requires_escalation||projection.requires_independent_review||projection.requires_specialist_review||projection.requires_human_review){
    if(DECISION_RANK[decision]<DECISION_RANK.REVIEW_REQUIRED)decision='REVIEW_REQUIRED';
  }
  if(physical){
    const physicalDecision=String(physical.decision??'ALLOW').trim().toUpperCase();
    if(!(physicalDecision in DECISION_RANK))throw new Error(`physical-environmental-decision-invalid:${physicalDecision}`);
    if(DECISION_RANK[physicalDecision]>DECISION_RANK[decision])decision=physicalDecision;
    if(physical.reason)reasons.push(String(physical.reason));
    if(physicalDecision==='DENY'&&String(physical.reason??'').toUpperCase()==='CRITICAL_UNRESOLVED_RISK')reasons.push('critical_physical_environmental_risk_blocks_work');
    if(physical.requires_specialist_review===true)reasons.push('physical_environmental_specialist_review_required');
  }
  return Object.freeze({
    schema_version:'1.0',company_id,capability:projection.capability,
    runtime_level:projection.runtime_level,effective_level:projection.effective_level,
    decision,
    requires_escalation:projection.requires_escalation,
    requires_independent_review:projection.requires_independent_review,
    requires_specialist_review:projection.requires_specialist_review||physical?.requires_specialist_review===true,
    requires_human_review:projection.requires_human_review,
    reason_codes:Object.freeze([...new Set(reasons)]),
    projection_only:true,
    settings_lowered_runtime_risk:false,
    risk_accepted:false,
    authority_granted:false,
    execution_permitted:false
  });
}
