// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/module-sdk/index.mjs
import {normalizeLocalModuleContract} from '../../titan-local/kernel/module-contract.js';
import {createCompanyExecutionContext} from '../company-context.js';

const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

export function createModuleSdkDescriptor(rawContract,rawContext=null){
  const contract=normalizeLocalModuleContract(rawContract);
  let company_id=contract.company_id;
  if(rawContext){
    const ctx=createCompanyExecutionContext(rawContext);
    if(company_id&&company_id!==ctx.company_id)throw new Error('Module SDK company_id mismatch');
    company_id=ctx.company_id;
  }
  return Object.freeze({...contract,company_id,activation_confers_authority:false});
}

export function toCapabilityContributions(rawContract,rawContext=null){
  const descriptor=createModuleSdkDescriptor(rawContract,rawContext);
  return Object.freeze((descriptor.capabilities||[]).map(cap=>Object.freeze({
    provider_id:descriptor.module_id,
    capability_id:typeof cap==='string'?cap:cap.id,
    company_id:descriptor.company_id,
    offline_support:descriptor.offline_support,
    permissions:[...new Set(descriptor.permissions||[])],
    authority_binding:descriptor.authority_binding,
    activation_confers_authority:false,
  })));
}

export function buildModuleContributionIndex(rawContract,rawContext=null){
  const descriptor=createModuleSdkDescriptor(rawContract,rawContext);
  const map=items=>(items||[]).map(item=>({module_id:descriptor.module_id,company_id:descriptor.company_id,...clone(typeof item==='string'?{id:item}:item),activation_confers_authority:false}));
  return Object.freeze({
    module_id:descriptor.module_id,company_id:descriptor.company_id,version:descriptor.version,offline_support:descriptor.offline_support,
    capabilities:toCapabilityContributions(rawContract,rawContext),commands:map(descriptor.commands),queries:map(descriptor.queries),events:map(descriptor.events),projections:map(descriptor.projections),
    permissions:[...(descriptor.permissions||[])],dependencies:clone(descriptor.dependencies||[]),activation_confers_authority:false,
  });
}
