// @ts-nocheck
import { rejectLegacyTenantAuthorityDeep } from '../boundary.js';
import { canonicalSurface } from './contracts.js';

export const INTERACTION_TEMPLATE_SCHEMA = 'titan.interaction.template.v1';
export const INTERACTION_TEMPLATE_RUNTIME_SCHEMA = 'titan.interaction.template-runtime.v1';

const freeze = value => Object.freeze(value);
const text = (value,label) => { const out=String(value??'').trim(); if(!out) throw new TypeError(`${label}-required`); return out; };
const clone = value => structuredClone(value);

export function createInteractionTemplateDefinition(input={}) {
  rejectLegacyTenantAuthorityDeep(input,'interaction-template');
  const source=input.template ?? input;
  const id=text(source.id,'template-id');
  const version=text(source.version,'template-version');
  if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`template-semver-required:${id}`);
  const status=String(source.status ?? 'draft').trim().toLowerCase();
  if(!['draft','ready','deprecated'].includes(status)) throw new Error(`template-status-invalid:${id}:${status}`);
  const capabilities=freeze([...(source.capabilities ?? [])].map((v,i)=>text(v,`template-capability-${i}`)));
  const surfaces=freeze([...(source.surfaces ?? source.channels ?? ['zero'])].map(canonicalSurface));
  return freeze({
    schema:INTERACTION_TEMPLATE_SCHEMA,id,version,name:text(source.name ?? id,'template-name'),status,
    category:String(source.category ?? 'general'),entry_wizard:text(source.entry_wizard ?? source.entryWizard,'template-entry-wizard'),
    capabilities,surfaces,governance:freeze(clone(source.governance ?? {})),metadata:freeze(clone(source.metadata ?? {})),
    authority_neutral:true,execution_authority:false,
  });
}

export function createInteractionTemplateRuntime({wizard_runtime,capability_registry}={}) {
  if(!wizard_runtime?.getDefinition) throw new TypeError('template-wizard-runtime-required');
  const templates=new Map();
  const hasCapability = id => {
    if(capability_registry?.has) return capability_registry.has(id);
    if(capability_registry?.get) { try { return Boolean(capability_registry.get(id)); } catch { return false; } }
    if(capability_registry?.resolve) { try { return Boolean(capability_registry.resolve(id)); } catch { return false; } }
    return false;
  };
  const register=input=>{const t=createInteractionTemplateDefinition(input);if(templates.has(t.id))throw new Error(`template-already-registered:${t.id}`);templates.set(t.id,t);return t;};
  const get=id=>{const key=text(id,'template-id');const t=templates.get(key);if(!t)throw new Error(`template-not-registered:${key}`);return t;};
  const list=()=>freeze([...templates.values()]);
  const check=id=>{
    const t=get(id); const errors=[]; const missing_capabilities=[]; let wizard=null;
    if(t.status!=='ready') errors.push(`template-not-ready:${t.status}`);
    try { wizard=wizard_runtime.getDefinition(t.entry_wizard); } catch { errors.push(`entry-wizard-not-registered:${t.entry_wizard}`); }
    if(wizard){
      const capability=String(wizard?.metadata?.capability ?? wizard?.capability ?? '').trim();
      if(capability && !t.capabilities.includes(capability)) errors.push(`entry-wizard-capability-not-declared:${capability}`);
    }
    if(capability_registry) for(const capability of t.capabilities) if(!hasCapability(capability)) missing_capabilities.push(capability);
    for(const capability of missing_capabilities) errors.push(`host-capability-unavailable:${capability}`);
    return freeze({template_id:t.id,compatible:errors.length===0,missing_entry_wizard:!wizard,missing_capabilities:freeze(missing_capabilities),errors:freeze(errors),authority_neutral:true});
  };
  const retain=predicate=>{if(typeof predicate!=='function')throw new TypeError('template-retain-predicate-required');for(const [id,t] of templates)if(!predicate(t))templates.delete(id);return list();};
  return freeze({schema:INTERACTION_TEMPLATE_RUNTIME_SCHEMA,authority_neutral:true,execution_authority:false,register,get,list,check,retain});
}
