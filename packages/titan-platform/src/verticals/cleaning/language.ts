import { CLEANING_SERVICE_BY_ID } from './catalogue.js';

export const CLEANING_LANGUAGE_SCHEMA='titan.vertical.cleaning.language-projection.v1' as const;
export type CleaningConversationIntent='quote_request'|'booking_request'|'recurring_change'|'service_question'|'issue_report'|'completion_followup'|'unknown';

export interface CleaningLanguageInput {
  company_id:string;
  message:string;
  service_id?:string;
  context?:{
    customer_ref?:string;
    booking_ref?:string;
    job_ref?:string;
    site_ref?:string;
    recurring?:boolean;
    known_answers?:Record<string,string|number|boolean>;
  };
}

const LEGACY=new Set(['tenant_id','tenant_company_id','workspace_tenant_id','tenantId','tenantCompanyId']);
function rejectLegacy(v:unknown,p='input'):void{if(!v||typeof v!=='object')return;if(Array.isArray(v)){v.forEach((x,i)=>rejectLegacy(x,`${p}[${i}]`));return;}for(const[k,x]of Object.entries(v as Record<string,unknown>)){if(LEGACY.has(k))throw new Error(`${p}.${k} is a legacy tenant boundary; company_id is required`);rejectLegacy(x,`${p}.${k}`);}}
function req(v:unknown,n:string){const x=String(v??'').trim();if(!x)throw new Error(`${n} is required`);return x;}
function opt(v:unknown){const x=String(v??'').trim();return x||null;}
function norm(v:unknown){return String(v??'').toLowerCase().replace(/[^a-z0-9\s-]/g,' ').replace(/\s+/g,' ').trim();}
function unique<T>(v:readonly T[]):readonly T[]{return Object.freeze([...new Set(v)]);}

const INTENT_RULES:readonly {intent:CleaningConversationIntent;signals:readonly string[]}[]=Object.freeze([
  {intent:'issue_report',signals:['complaint','missed','damage','not clean','problem','issue','reclean','re-clean']},
  {intent:'quote_request',signals:['quote','price','cost','estimate','how much']},
  {intent:'booking_request',signals:['book','booking','schedule','available','appointment']},
  {intent:'recurring_change',signals:['weekly','fortnightly','monthly','recurring','every week','pause service','resume service','change frequency']},
  {intent:'completion_followup',signals:['finished','complete','completed','photos','evidence']},
  {intent:'service_question',signals:['include','included','service','clean','cleaning','oven','carpet','window','bond']}
]);

function detectIntent(message:string):{intent:CleaningConversationIntent;matched:readonly string[]}{
  const text=norm(message);let best:{intent:CleaningConversationIntent;matched:string[]}|null=null;
  for(const rule of INTENT_RULES){const matched=rule.signals.filter(s=>text.includes(s));if(!matched.length)continue;if(!best||matched.length>best.matched.length)best={intent:rule.intent,matched};}
  return best?{intent:best.intent,matched:Object.freeze(best.matched)}:{intent:'unknown',matched:Object.freeze([])};
}

function quoteQuestions(service_id:string|null,known:Record<string,string|number|boolean>){
  const service=service_id?CLEANING_SERVICE_BY_ID[service_id]:null;
  const q:{key:string;question:string;reason:string}[]=[];
  const add=(key:string,question:string,reason:string)=>{if(known[key]==null||known[key]==='')q.push({key,question,reason});};
  add('property_type','What type of property or site is this?','scope');
  add('size','How large is the property/site (rooms or approximate area)?','duration_and_pricing_input');
  add('condition','How would you describe the current condition or soil level?','quote_gate');
  add('preferred_date','What date or service window works best?','booking_handoff');
  add('access','Are there any key, alarm, pet, parking or access instructions we should account for?','site_context');
  if(service?.family==='commercial') add('frequency','How often should this site be serviced?','recurring_contract');
  if(service?.id==='bond_end_of_lease') add('extras','Do you need carpet, oven, windows or wall cleaning included?','service_addons');
  if(service?.id==='airbnb_turnover') add('turnover_window','What is the checkout-to-check-in window and do you need linen or amenity restocking?','turnover_schedule');
  return Object.freeze(q.map(x=>Object.freeze(x)));
}

function upsells(service_id:string|null):readonly {addon_id:string;label:string;requires_quote_review:boolean}[]{
  const service=service_id?CLEANING_SERVICE_BY_ID[service_id]:null;if(!service)return Object.freeze([]);
  return Object.freeze(service.addons.slice(0,4).map(id=>Object.freeze({addon_id:id,label:id.replace(/_/g,' '),requires_quote_review:service.quote_required||service.risk_level==='HIGH'})));
}

export function buildCleaningLanguageProjection(input:CleaningLanguageInput){
  rejectLegacy(input);const company_id=req(input.company_id,'company_id');const message=req(input.message,'message');const service_id=opt(input.service_id);
  if(service_id&&!CLEANING_SERVICE_BY_ID[service_id])throw new Error(`unknown cleaning service id: ${service_id}`);
  const intent=detectIntent(message);const known=input.context?.known_answers??{};
  const questions=intent.intent==='quote_request'||intent.intent==='booking_request'?quoteQuestions(service_id,known):Object.freeze([]);
  const suggestions=(intent.intent==='quote_request'||intent.intent==='service_question'||intent.intent==='booking_request')?upsells(service_id):Object.freeze([]);
  const service=service_id?CLEANING_SERVICE_BY_ID[service_id]:null;
  const customer_summary=Object.freeze({title:service?service.label:'Cleaning service',intent:intent.intent,service_id,recurring:input.context?.recurring===true,next_step:intent.intent==='issue_report'?'Customer Care review':intent.intent==='quote_request'?'Prepare quote inputs':intent.intent==='booking_request'?'Prepare booking handoff':intent.intent==='recurring_change'?'Review recurring-service change':'Clarify request'});
  const field_summary=Object.freeze({job_ref:opt(input.context?.job_ref),site_ref:opt(input.context?.site_ref),service_id,service_label:service?.label??null,required_skills:Object.freeze([...(service?.skills??[])]),equipment:Object.freeze([...(service?.equipment??[])]),evidence:Object.freeze([...(service?.required_evidence??[])])});
  return Object.freeze({schema:CLEANING_LANGUAGE_SCHEMA,company_id,normalized_message:norm(message),intent:intent.intent,intent_signals:intent.matched,intent_is_hint:true,quote_questions:questions,upsell_suggestions:suggestions,customer_summary,field_summary,
    owners:Object.freeze({chatbot:'shared_agent_shell_and_intent_owner',quote:'shared_quote_agent_owner',sales:'shared_sales_agent_owner',booking:'shared_booking_agent_owner',customer_care:'shared_customer_care_owner'}),
    generic_classifier_replaced:false,agent_shell_replaced:false,quote_mutation_emitted:false,booking_mutation_emitted:false,sales_mutation_emitted:false,customer_message_sent:false,upsell_auto_applied:false,proposal_only:true,grants_authority:false,execution_permitted:false});
}
