import bindings from './atomic-worker-tool-bindings.json' with { type: 'json' };
import { loadToolRegistry, getToolDefinition } from '../../titan-tools/tool-registry.mjs';

const clean=(v,max=220)=>String(v??'').trim().slice(0,max);
const validCompany=v=>/^[A-Za-z0-9._:-]{2,128}$/.test(clean(v,128));
const byWorker=new Map(bindings.bindings.map(x=>[x.worker_id,x]));

export function resolveAtomicWorkerTools(input={}, toolRegistry=loadToolRegistry()){
  const company_id=clean(input.company_id,128); if(!validCompany(company_id)) throw new Error('worker-tool-company_id-required');
  const worker_id=clean(input.worker_id,180); const binding=byWorker.get(worker_id); if(!binding) throw new Error('worker-tool-binding-not-found');
  if(binding.company_boundary!=='company_id'||binding.binding_grants_authority!==false||binding.worker_can_delegate!==false) throw new Error('worker-tool-binding-invariant-violation');
  const tools=binding.tool_ids.map(id=>getToolDefinition(id,toolRegistry));
  for(const tool of tools){
    if(tool.company_scope?.canonical_key!=='company_id'||tool.grants_execution_authority!==false) throw new Error(`worker-tool-authority-invariant:${tool.tool_id}`);
  }
  return {schema:'titan.workforce.atomic-worker-tool-resolution.v1',company_id,worker_id,worker_name:binding.worker_name,atomic_action:binding.atomic_action,
    tools:tools.map(t=>({tool_id:t.tool_id,name:t.name,authority_class:t.authority_class,autonomy_ceiling:t.autonomy_ceiling,company_boundary:t.company_scope.canonical_key,grants_execution_authority:false})),
    authority_class:binding.authority_class,requires_approval:binding.requires_approval,requires_idempotency_key:binding.requires_idempotency_key,
    requires_execution_receipt:binding.requires_execution_receipt,identity_grants_authority:false,binding_grants_authority:false,execution_permitted:false};
}

export function prepareAtomicWorkerExecution(input={}, toolRegistry=loadToolRegistry()){
  const resolved=resolveAtomicWorkerTools(input,toolRegistry); const operation=clean(input.operation||resolved.atomic_action,260); if(!operation) throw new Error('worker-tool-operation-required');
  const approval=Boolean(input.approval_granted===true); const idempotency_key=clean(input.idempotency_key,220);
  const blocked=[];
  if(resolved.requires_approval&&!approval) blocked.push('APPROVAL_REQUIRED');
  if(resolved.requires_idempotency_key&&!idempotency_key) blocked.push('IDEMPOTENCY_KEY_REQUIRED');
  return {...resolved,operation,idempotency_key:idempotency_key||null,approval_granted:approval,
    proposal:{schema:'titan.workforce.atomic-worker-execution-proposal.v1',company_id:resolved.company_id,worker_id:resolved.worker_id,operation,
      tool_ids:resolved.tools.map(t=>t.tool_id),state:blocked.length?'BLOCKED':'READY_FOR_AUTHORITY_GATE',blocked_reasons:blocked,
      requires_execution_receipt:resolved.requires_execution_receipt,direct_mutation:false,automatic_effect_replay:false,grants_authority:false},
    execution_permitted:false};
}

export function listAtomicWorkerBindings(){return bindings.bindings.map(x=>({...x}));}
export default {resolveAtomicWorkerTools,prepareAtomicWorkerExecution,listAtomicWorkerBindings};
