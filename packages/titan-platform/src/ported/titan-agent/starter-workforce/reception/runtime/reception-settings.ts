// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-agent/starter-workforce/reception/runtime/reception-settings.mjs
const CHANNELS=Object.freeze(['chat','sms','whatsapp','messenger','email','webchat','voice']);
const LEGACY=new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const TONES=Object.freeze(['warm','professional','friendly','concise','formal']);
const clean=(v,max=240)=>typeof v==='string'?v.trim().replace(/\s+/g,' ').slice(0,max):'';
const list=v=>Array.isArray(v)?v:[];
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
function rejectLegacy(v,path='reception-settings'){if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${path}[${i}]`));return;}for(const[k,x]of Object.entries(v)){if(LEGACY.has(k))throw new Error(`legacy-company-boundary:${path}.${k}`);rejectLegacy(x,`${path}.${k}`);}}
function company(v){const id=clean(v,128);if(!id)throw new TypeError('company_id is required');return id;}
function uniqueText(v,maxItems,maxLen){return [...new Set(list(v).map(x=>clean(x,maxLen)).filter(Boolean))].slice(0,maxItems);}
function clamp(v,min,max,fallback){const n=Number(v);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;}
function hours(v){return list(v).slice(0,14).map(h=>Object.freeze({day:clean(h?.day,24)||'Unspecified',closed:h?.closed===true,label:h?.closed===true?'closed':clean(h?.label,80)||'hours not specified'}));}
export function resolveReceptionSettings(input={}){
  rejectLegacy(input);const company_id=company(input.company_id);const raw=obj(input.settings||input.reception||input.reception_settings);
  const override=input.workforce_override_resolution;
  if(override&&clean(override.company_id,128)!==company_id)throw new Error('reception-settings-cross-company-workforce-override');
  const toneRaw=clean(raw.tone,80).toLowerCase();const tone=TONES.includes(toneRaw)?toneRaw:'warm';
  const languages=uniqueText(raw.languages?.length?raw.languages:[raw.language||'English'],8,48);if(!languages.length)languages.push('English');
  const enabled_channels=uniqueText(raw.enabled_channels?.length?raw.enabled_channels:CHANNELS,CHANNELS.length,32).filter(c=>CHANNELS.includes(c));
  const escalation=obj(raw.escalation);const emergency=obj(raw.emergency);const knowledge=obj(raw.knowledge);const thresholds=obj(raw.auto_action_thresholds);
  return Object.freeze({schema:'titan.zero.reception.settings/v1',company_id,tone,languages:Object.freeze(languages),primary_language:languages[0],business_hours:Object.freeze(hours(raw.business_hours)),enabled_channels:Object.freeze(enabled_channels),
    escalation:Object.freeze({unknown_knowledge:escalation.unknown_knowledge!==false,complaints:escalation.complaints!==false,safety_concerns:true,tool_failure:true,unsupported_service:escalation.unsupported_service!==false,after_hours:escalation.after_hours!==false,target:clean(escalation.target,80)||'customer_care'}),
    emergency:Object.freeze({escalate_immediately:true,never_diagnose:true,never_minimise:true,instruction:clean(emergency.instruction,300)||'If there is immediate danger, advise the caller to contact the appropriate local emergency service and request human escalation.'}),
    knowledge:Object.freeze({minimum_match_score:clamp(knowledge.minimum_match_score,0.2,0.9,0.22),approved_sources_only:true,stale_content_allowed:false,cross_company_content_allowed:false}),
    auto_action_thresholds:Object.freeze({minimum_confidence:clamp(thresholds.minimum_confidence,0.5,1,0.9),maximum_risk:'LOW',may_request_handoff:thresholds.may_request_handoff!==false,may_capture_enquiry:thresholds.may_capture_enquiry!==false,may_request_booking:thresholds.may_request_booking===true,thresholds_are_advisory_only:true,runtime_authority_required:true}),
    do_not_promise:Object.freeze(uniqueText(raw.do_not_promise,20,180)),greeting:clean(raw.greeting,240)||null,
    workforce_override:Object.freeze({effective_risk_ceiling:clean(override?.effective_risk_ceiling,20)||null,contractions:Object.freeze(uniqueText(override?.contractions,30,160))}),
    settings_can_grant_authority:false,settings_can_execute:false,authority_granted:false,execution_permitted:false,grants_authority:false});
}
export function buildReceptionPromptSettings(resolved={}){const company_id=company(resolved.company_id);return Object.freeze({company_id,tone:resolved.tone,language:resolved.primary_language,languages:resolved.languages,greeting:resolved.greeting,do_not_promise:resolved.do_not_promise,hours:resolved.business_hours,enabled_channels:resolved.enabled_channels,escalation:resolved.escalation,emergency:resolved.emergency,settings_can_grant_authority:false,authority_granted:false});}
export function buildReceptionKnowledgeSettings(resolved={}){const company_id=company(resolved.company_id);return Object.freeze({company_id,min_score:resolved.knowledge?.minimum_match_score??0.22,approved_sources_only:true,stale_content_allowed:false,cross_company_content_allowed:false,authority_granted:false});}
export function evaluateReceptionAutoAction(resolved={},input={}){const company_id=company(resolved.company_id);if(input.company_id&&clean(input.company_id,128)!==company_id)throw new Error('reception-settings-cross-company-auto-action');const confidence=clamp(input.confidence,0,1,0);const kind=clean(input.kind,80);const permittedByKind=(kind==='request_handoff'&&resolved.auto_action_thresholds?.may_request_handoff)||(kind==='capture_enquiry'&&resolved.auto_action_thresholds?.may_capture_enquiry)||(kind==='request_booking'&&resolved.auto_action_thresholds?.may_request_booking);return Object.freeze({schema:'titan.zero.reception.auto-action-evaluation/v1',company_id,kind,confidence,threshold:Number(resolved.auto_action_thresholds?.minimum_confidence||0.9),eligible_for_runtime_evaluation:Boolean(permittedByKind&&confidence>=Number(resolved.auto_action_thresholds?.minimum_confidence||0.9)),runtime_authority_required:true,settings_can_execute:false,authority_granted:false,execution_permitted:false});}
export const RECEPTION_SETTING_CHANNELS=CHANNELS;export const RECEPTION_TONES=TONES;
