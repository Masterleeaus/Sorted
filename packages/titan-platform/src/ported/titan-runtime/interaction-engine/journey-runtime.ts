// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/interaction-engine/journey-runtime.mjs
import { assertCanonicalCompanyId, rejectLegacyTenantAuthority } from '../boundary.js';
import { canonicalSurface } from './contracts.js';

export const JOURNEY_RUNTIME_SCHEMA = 'titan.interaction.journey-runtime.v1';
export const JOURNEY_DEFINITION_SCHEMA = 'titan.interaction.journey-definition.v1';
export const JOURNEY_INSTANCE_SCHEMA = 'titan.interaction.journey-instance.v1';
export const JOURNEY_COLLECTION = 'journey-instances';
export const JOURNEY_MODULE_ID = 'titan.interaction';

function object(value,label){
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}-object-required`);
  rejectLegacyTenantAuthority(value,label);
  return value;
}
function text(value,label){const out=String(value??'').trim();if(!out)throw new TypeError(`${label}-required`);return out;}
function immutable(value){return Object.freeze(structuredClone(value));}

export function createJourneyDefinition(input){
  const value=object(input,'journey-definition');
  const journey_id=text(value.journey_id ?? value.id,'journey-id');
  const name=text(value.name ?? journey_id,'journey-name');
  const surfaces=Object.freeze([...(value.surfaces ?? ['zero'])].map(canonicalSurface));
  const rawSteps=[...(value.steps ?? [])];
  if(!rawSteps.length) throw new TypeError('journey-steps-required');
  const ids=new Set();
  const steps=rawSteps.map((step,index)=>{
    const source=object(step,`journey-step-${index}`);
    const step_id=text(source.step_id ?? source.id,`journey-step-${index}-id`);
    if(ids.has(step_id)) throw new Error(`duplicate-journey-step:${step_id}`);
    ids.add(step_id);
    const transitions=Object.freeze([...(source.transitions ?? [])].map((transition,tIndex)=>{
      const t=object(transition,`journey-transition-${step_id}-${tIndex}`);
      return Object.freeze({
        to:text(t.to,'journey-transition-target'),
        default:t.default === true,
        when:t.when == null ? null : immutable(object(t.when,'journey-transition-condition')),
      });
    }));
    return Object.freeze({
      step_id,
      kind:String(source.kind ?? 'interaction'),
      terminal:source.terminal === true,
      transitions,
      metadata:source.metadata == null ? null : immutable(source.metadata),
    });
  });
  for(const step of steps) for(const transition of step.transitions) if(!ids.has(transition.to)) throw new Error(`unknown-journey-transition-target:${transition.to}`);
  const initial_step_id=text(value.initial_step_id ?? steps[0].step_id,'journey-initial-step-id');
  if(!ids.has(initial_step_id)) throw new Error('journey-initial-step-not-found');
  return Object.freeze({
    schema:JOURNEY_DEFINITION_SCHEMA, journey_id, name, surfaces, initial_step_id,
    steps:Object.freeze(steps), prerequisites:Object.freeze([...(value.prerequisites ?? [])]),
    requirements:Object.freeze([...(value.requirements ?? [])]), metadata:value.metadata == null ? null : immutable(value.metadata),
    authority_neutral:true, execution_authority:false,
  });
}

function company(context){return assertCanonicalCompanyId(object(context,'journey-context').company_id);}
function assertPayloadCompany(input,companyId,label){object(input,label);if(input.company_id != null && String(input.company_id).trim()!==companyId)throw new Error(`Cross-company ${label} rejected`);}
function locator(id){return {module_id:JOURNEY_MODULE_ID,collection:JOURNEY_COLLECTION,record_id:text(id,'journey-instance-id')};}
function unwrap(record){return record?.data ?? null;}
function stepFor(definition,id){const step=definition.steps.find(item=>item.step_id===id);if(!step)throw new Error(`journey-step-not-found:${id}`);return step;}
function conditionMatches(condition,facts){
  if(!condition) return false;
  const field=text(condition.field,'journey-condition-field');
  const actual=facts?.[field];
  if(Object.prototype.hasOwnProperty.call(condition,'equals')) return Object.is(actual,condition.equals);
  if(Object.prototype.hasOwnProperty.call(condition,'not_equals')) return !Object.is(actual,condition.not_equals);
  if(condition.present === true) return actual !== undefined && actual !== null;
  if(condition.present === false) return actual === undefined || actual === null;
  return false;
}
function selectTransition(step,facts){
  const matched=step.transitions.find(t=>t.when && conditionMatches(t.when,facts));
  return matched ?? step.transitions.find(t=>t.default) ?? null;
}
function makeState(companyId,definition,input,now){
  const current=stepFor(definition,input.current_step_id ?? definition.initial_step_id);
  return Object.freeze({
    schema:JOURNEY_INSTANCE_SCHEMA, company_id:companyId,
    journey_instance_id:text(input.journey_instance_id,'journey-instance-id'), journey_id:definition.journey_id,
    definition_schema:definition.schema, surface:canonicalSurface(input.surface ?? definition.surfaces[0] ?? 'zero'),
    conversation_id:input.conversation_id == null ? null : text(input.conversation_id,'conversation-id'),
    session_id:input.session_id == null ? null : text(input.session_id,'session-id'),
    current_step_id:current.step_id, status:current.terminal ? 'completed' : (input.status ?? 'active'),
    transition_count:Math.max(0,Number(input.transition_count ?? 0)),
    history:Object.freeze([...(input.history ?? [])]), pause_reason:input.pause_reason ?? null,
    metadata:input.metadata == null ? null : immutable(input.metadata), created_at:Number(input.created_at ?? now), updated_at:Number(now),
    restart_safe:true, requires_explicit_resume:input.status === 'paused', automatic_progression:false,
    authority_neutral:true, authority_granted:false, execution_authority:false,
  });
}
function record(state){return {module_id:JOURNEY_MODULE_ID,collection:JOURNEY_COLLECTION,record_id:state.journey_instance_id,data:state,provenance:{schema:JOURNEY_RUNTIME_SCHEMA,source:'interaction-engine',durable_state_only:true,automatic_progression:false,authority_neutral:true}};}

export function createJourneyRuntime({database,clock=()=>Date.now()}={}){
  if(!database || typeof database.putRecord!=='function' || typeof database.getRecord!=='function') throw new TypeError('journey-runtime-database-required');
  const definitions=new Map();
  const registerDefinition=input=>{const definition=createJourneyDefinition(input);definitions.set(definition.journey_id,definition);return definition;};
  const getDefinition=id=>{const key=text(id,'journey-id');const definition=definitions.get(key);if(!definition)throw new Error(`journey-definition-not-registered:${key}`);return definition;};
  const load=async(contextInput,id)=>unwrap(await database.getRecord(contextInput,locator(id)));
  const save=async(contextInput,state)=>unwrap(await database.putRecord(contextInput,record(state)));
  const start=async(contextInput,input)=>{
    const companyId=company(contextInput);assertPayloadCompany(input,companyId,'journey-start');
    const definition=getDefinition(input.journey_id);
    const surface=canonicalSurface(input.surface ?? definition.surfaces[0] ?? 'zero');
    if(!definition.surfaces.includes(surface)) throw new Error(`journey-surface-not-supported:${surface}`);
    const prior=await load(contextInput,input.journey_instance_id);
    if(prior) return prior;
    return save(contextInput,makeState(companyId,definition,{...input,surface},Number(clock())));
  };
  const advance=async(contextInput,id,input={})=>{
    const companyId=company(contextInput);assertPayloadCompany(input,companyId,'journey-advance');
    if(input.to != null) throw new Error('explicit transition override not allowed');
    const prior=await load(contextInput,id);if(!prior)throw new Error('journey-instance-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company journey state rejected');
    if(prior.status!=='active')throw new Error(`journey-transition-not-allowed:${prior.status}`);
    const definition=getDefinition(prior.journey_id);const current=stepFor(definition,prior.current_step_id);
    if(current.terminal) return prior;
    const transition=selectTransition(current,object(input.facts ?? {},'journey-facts'));
    if(!transition) throw new Error(`journey-transition-not-available:${current.step_id}`);
    const target=stepFor(definition,transition.to);const now=Number(clock());
    const next=makeState(companyId,definition,{...prior,current_step_id:target.step_id,status:target.terminal?'completed':'active',transition_count:prior.transition_count+1,history:[...(prior.history??[]),{from:current.step_id,to:target.step_id,at:now}],pause_reason:null},now);
    return save(contextInput,next);
  };
  const pause=async(contextInput,id,{reason='paused'}={})=>{
    const companyId=company(contextInput);const prior=await load(contextInput,id);if(!prior)throw new Error('journey-instance-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company journey state rejected');
    if(prior.status==='completed')throw new Error('journey-transition-not-allowed:completed');
    const definition=getDefinition(prior.journey_id);const now=Number(clock());
    return save(contextInput,makeState(companyId,definition,{...prior,status:'paused',pause_reason:String(reason),current_step_id:prior.current_step_id},now));
  };
  const resume=async(contextInput,id)=>{
    const companyId=company(contextInput);const prior=await load(contextInput,id);if(!prior)throw new Error('journey-instance-not-found');
    if(prior.company_id!==companyId)throw new Error('Cross-company journey state rejected');
    if(prior.status!=='paused')throw new Error(`journey-resume-not-allowed:${prior.status}`);
    const definition=getDefinition(prior.journey_id);const now=Number(clock());
    return save(contextInput,makeState(companyId,definition,{...prior,status:'active',pause_reason:null,current_step_id:prior.current_step_id},now));
  };
  return Object.freeze({schema:JOURNEY_RUNTIME_SCHEMA,authority_neutral:true,execution_authority:false,registerDefinition,getDefinition,start,load,advance,pause,resume});
}
