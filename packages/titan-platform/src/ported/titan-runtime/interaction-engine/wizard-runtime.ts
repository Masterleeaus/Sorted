// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/wizard-runtime.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../boundary.js';
import { canonicalSurface } from './contracts.js';

export const WIZARD_RUNTIME_SCHEMA = 'titan.interaction.wizard-runtime.v1';
export const WIZARD_DEFINITION_SCHEMA = 'titan.interaction.wizard-definition.v1';
export const WIZARD_SESSION_SCHEMA = 'titan.interaction.wizard-session.v1';
export const WIZARD_COLLECTION = 'wizard-sessions';
export const WIZARD_MODULE_ID = 'titan.interaction';

function object(value,label){
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}-object-required`);
  rejectLegacyTenantAuthority(value,label);
  return value;
}
function text(value,label){const out=String(value??'').trim();if(!out)throw new TypeError(`${label}-required`);return out;}
function immutable(value){return Object.freeze(structuredClone(value));}
function company(context){return assertCanonicalCompanyId(object(context,'wizard-context').company_id);}
function assertPayloadCompany(input,companyId,label){object(input,label);if(input.company_id!=null && String(input.company_id).trim()!==companyId)throw new Error(`Cross-company ${label} rejected`);}
function locator(id){return {module_id:WIZARD_MODULE_ID,collection:WIZARD_COLLECTION,record_id:text(id,'wizard-session-id')};}
function unwrap(record){return record?.data ?? null;}

function compileCondition(input,label){
  const condition=object(input,label);
  const out={field:text(condition.field,`${label}-field`)};
  if(Object.prototype.hasOwnProperty.call(condition,'equals')) out.equals=structuredClone(condition.equals);
  else if(Object.prototype.hasOwnProperty.call(condition,'not_equals')) out.not_equals=structuredClone(condition.not_equals);
  else if(condition.present===true || condition.present===false) out.present=condition.present;
  else throw new Error(`${label}-operator-required`);
  return Object.freeze(out);
}
function conditionMatches(condition,answers){
  const actual=answers?.[condition.field];
  if(Object.prototype.hasOwnProperty.call(condition,'equals')) return Object.is(actual,condition.equals);
  if(Object.prototype.hasOwnProperty.call(condition,'not_equals')) return !Object.is(actual,condition.not_equals);
  if(condition.present===true) return actual!==undefined && actual!==null;
  if(condition.present===false) return actual===undefined || actual===null;
  return false;
}
function prerequisitesSatisfied(prerequisites,answers){return prerequisites.every(condition=>conditionMatches(condition,answers));}

function compileField(input,stepId,index){
  const field=object(input,`wizard-field-${stepId}-${index}`);
  const field_id=text(field.field_id ?? field.id,`wizard-field-${stepId}-${index}-id`);
  const type=String(field.type ?? 'string').trim().toLowerCase();
  const supported=new Set(['string','number','boolean','enum']);
  if(!supported.has(type)) throw new Error(`wizard-field-type-not-supported:${field_id}:${type}`);
  const options=type==='enum' ? Object.freeze([...(field.options ?? [])].map(value=>structuredClone(value))) : Object.freeze([]);
  if(type==='enum' && !options.length) throw new Error(`wizard-field-options-required:${field_id}`);
  return Object.freeze({
    field_id,type,required:field.required===true,options,
    min_length:field.min_length==null?null:Number(field.min_length),
    max_length:field.max_length==null?null:Number(field.max_length),
    min:field.min==null?null:Number(field.min),max:field.max==null?null:Number(field.max),
    metadata:field.metadata==null?null:immutable(field.metadata),
  });
}

export function createWizardDefinition(input){
  const value=object(input,'wizard-definition');
  const wizard_id=text(value.wizard_id ?? value.id,'wizard-id');
  const name=text(value.name ?? wizard_id,'wizard-name');
  const surfaces=Object.freeze([...(value.surfaces ?? ['zero'])].map(canonicalSurface));
  const rawSteps=[...(value.steps ?? [])];
  if(!rawSteps.length) throw new TypeError('wizard-steps-required');
  const ids=new Set();
  const steps=rawSteps.map((step,index)=>{
    const source=object(step,`wizard-step-${index}`);
    const step_id=text(source.step_id ?? source.id,`wizard-step-${index}-id`);
    if(ids.has(step_id)) throw new Error(`duplicate-wizard-step:${step_id}`);
    ids.add(step_id);
    const fields=Object.freeze([...(source.fields ?? [])].map((field,fIndex)=>compileField(field,step_id,fIndex)));
    const fieldIds=new Set();
    for(const field of fields){if(fieldIds.has(field.field_id))throw new Error(`duplicate-wizard-field:${step_id}:${field.field_id}`);fieldIds.add(field.field_id);}
    const prerequisites=Object.freeze([...(source.prerequisites ?? [])].map((p,pIndex)=>compileCondition(p,`wizard-prerequisite-${step_id}-${pIndex}`)));
    const transitions=Object.freeze([...(source.transitions ?? [])].map((transition,tIndex)=>{
      const t=object(transition,`wizard-transition-${step_id}-${tIndex}`);
      return Object.freeze({to:text(t.to,'wizard-transition-target'),default:t.default===true,when:t.when==null?null:compileCondition(t.when,`wizard-transition-condition-${step_id}-${tIndex}`)});
    }));
    return Object.freeze({step_id,fields,prerequisites,transitions,terminal:source.terminal===true,metadata:source.metadata==null?null:immutable(source.metadata)});
  });
  for(const step of steps) for(const transition of step.transitions) if(!ids.has(transition.to)) throw new Error(`unknown-wizard-transition-target:${transition.to}`);
  const initial_step_id=text(value.initial_step_id ?? steps[0].step_id,'wizard-initial-step-id');
  if(!ids.has(initial_step_id)) throw new Error('wizard-initial-step-not-found');
  return Object.freeze({schema:WIZARD_DEFINITION_SCHEMA,wizard_id,name,surfaces,initial_step_id,steps,metadata:value.metadata==null?null:immutable(value.metadata),authority_neutral:true,execution_authority:false});
}

function stepFor(definition,id){const step=definition.steps.find(item=>item.step_id===id);if(!step)throw new Error(`wizard-step-not-found:${id}`);return step;}
function assertPrerequisites(step,answers){if(!prerequisitesSatisfied(step.prerequisites,answers))throw new Error(`wizard-prerequisite-not-satisfied:${step.step_id}`);}
function validateField(field,value){
  if(value===undefined || value===null || value===''){
    if(field.required) throw new Error(`wizard-validation:${field.field_id}:required`);
    return;
  }
  if(field.type==='string'){
    if(typeof value!=='string') throw new Error(`wizard-validation:${field.field_id}:type-string`);
    if(field.min_length!=null && value.length<field.min_length) throw new Error(`wizard-validation:${field.field_id}:min_length`);
    if(field.max_length!=null && value.length>field.max_length) throw new Error(`wizard-validation:${field.field_id}:max_length`);
  } else if(field.type==='number'){
    if(typeof value!=='number' || !Number.isFinite(value)) throw new Error(`wizard-validation:${field.field_id}:type-number`);
    if(field.min!=null && value<field.min) throw new Error(`wizard-validation:${field.field_id}:min`);
    if(field.max!=null && value>field.max) throw new Error(`wizard-validation:${field.field_id}:max`);
  } else if(field.type==='boolean'){
    if(typeof value!=='boolean') throw new Error(`wizard-validation:${field.field_id}:type-boolean`);
  } else if(field.type==='enum'){
    if(!field.options.some(option=>Object.is(option,value))) throw new Error(`wizard-validation:${field.field_id}:enum`);
  }
}
function validateStep(step,answers){for(const field of step.fields)validateField(field,answers[field.field_id]);}
function selectTransition(step,answers){return step.transitions.find(t=>t.when && conditionMatches(t.when,answers)) ?? step.transitions.find(t=>t.default) ?? null;}

function makeState(companyId,definition,input,now){
  const answers=immutable(input.answers ?? {});
  const current=stepFor(definition,input.current_step_id ?? definition.initial_step_id);
  assertPrerequisites(current,answers);
  return Object.freeze({
    schema:WIZARD_SESSION_SCHEMA,company_id:companyId,wizard_session_id:text(input.wizard_session_id,'wizard-session-id'),wizard_id:definition.wizard_id,
    definition_schema:definition.schema,surface:canonicalSurface(input.surface ?? definition.surfaces[0] ?? 'zero'),
    conversation_id:input.conversation_id==null?null:text(input.conversation_id,'conversation-id'),session_id:input.session_id==null?null:text(input.session_id,'session-id'),
    journey_instance_id:input.journey_instance_id==null?null:text(input.journey_instance_id,'journey-instance-id'),current_step_id:current.step_id,
    status:current.terminal?'completed':(input.status ?? 'active'),answers,submission_count:Math.max(0,Number(input.submission_count ?? 0)),
    history:Object.freeze([...(input.history ?? [])]),pause_reason:input.pause_reason ?? null,metadata:input.metadata==null?null:immutable(input.metadata),
    created_at:Number(input.created_at ?? now),updated_at:Number(now),restart_safe:true,requires_explicit_resume:input.status==='paused',automatic_progression:false,
    authority_neutral:true,authority_granted:false,execution_authority:false,
  });
}
function record(state){return {module_id:WIZARD_MODULE_ID,collection:WIZARD_COLLECTION,record_id:state.wizard_session_id,data:state,provenance:{schema:WIZARD_RUNTIME_SCHEMA,source:'interaction-engine',durable_state_only:true,automatic_progression:false,authority_neutral:true}};}

export function createWizardRuntime({database,clock=()=>Date.now()}={}){
  if(!database || typeof database.putRecord!=='function' || typeof database.getRecord!=='function') throw new TypeError('wizard-runtime-database-required');
  const definitions=new Map();
  const registerDefinition=input=>{const definition=createWizardDefinition(input);definitions.set(definition.wizard_id,definition);return definition;};
  const getDefinition=id=>{const key=text(id,'wizard-id');const definition=definitions.get(key);if(!definition)throw new Error(`wizard-definition-not-registered:${key}`);return definition;};
  const load=async(contextInput,id)=>unwrap(await database.getRecord(contextInput,locator(id)));
  const save=async(contextInput,state)=>unwrap(await database.putRecord(contextInput,record(state)));
  const start=async(contextInput,input)=>{
    const companyId=company(contextInput);assertPayloadCompany(input,companyId,'wizard-start');
    const definition=getDefinition(input.wizard_id);const surface=canonicalSurface(input.surface ?? definition.surfaces[0] ?? 'zero');
    if(!definition.surfaces.includes(surface)) throw new Error(`wizard-surface-not-supported:${surface}`);
    const prior=await load(contextInput,input.wizard_session_id);if(prior)return prior;
    return save(contextInput,makeState(companyId,definition,{...input,surface,answers:input.answers ?? {}},Number(clock())));
  };
  const submit=async(contextInput,id,input={})=>{
    const companyId=company(contextInput);assertPayloadCompany(input,companyId,'wizard-submit');
    if(input.to!=null || input.current_step_id!=null || input.status==='completed') throw new Error('explicit navigation override not allowed');
    const prior=await load(contextInput,id);if(!prior)throw new Error('wizard-session-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company wizard state rejected');
    if(prior.status!=='active')throw new Error(`wizard-submit-not-allowed:${prior.status}`);
    const definition=getDefinition(prior.wizard_id);const current=stepFor(definition,prior.current_step_id);if(current.terminal)return prior;
    const incoming=object(input.answers ?? {},'wizard-answers');const answers={...(prior.answers ?? {}),...incoming};
    assertPrerequisites(current,answers);validateStep(current,answers);
    const transition=selectTransition(current,answers);if(!transition)throw new Error(`wizard-transition-not-available:${current.step_id}`);
    const target=stepFor(definition,transition.to);assertPrerequisites(target,answers);const now=Number(clock());
    const next=makeState(companyId,definition,{...prior,current_step_id:target.step_id,status:target.terminal?'completed':'active',answers,submission_count:prior.submission_count+1,history:[...(prior.history??[]),{from:current.step_id,to:target.step_id,at:now}],pause_reason:null},now);
    return save(contextInput,next);
  };
  const pause=async(contextInput,id,{reason='paused'}={})=>{
    const companyId=company(contextInput);const prior=await load(contextInput,id);if(!prior)throw new Error('wizard-session-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company wizard state rejected');if(prior.status==='completed')throw new Error('wizard-pause-not-allowed:completed');
    const definition=getDefinition(prior.wizard_id);const now=Number(clock());return save(contextInput,makeState(companyId,definition,{...prior,status:'paused',pause_reason:String(reason)},now));
  };
  const resume=async(contextInput,id)=>{
    const companyId=company(contextInput);const prior=await load(contextInput,id);if(!prior)throw new Error('wizard-session-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company wizard state rejected');if(prior.status!=='paused')throw new Error(`wizard-resume-not-allowed:${prior.status}`);
    const definition=getDefinition(prior.wizard_id);const now=Number(clock());return save(contextInput,makeState(companyId,definition,{...prior,status:'active',pause_reason:null},now));
  };
  return Object.freeze({schema:WIZARD_RUNTIME_SCHEMA,authority_neutral:true,execution_authority:false,registerDefinition,getDefinition,start,load,submit,pause,resume});
}
