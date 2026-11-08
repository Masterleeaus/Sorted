// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/typed-work-lifecycle.mjs
import {
  TITAN_ADAPTER_MESSAGE_TYPES,
  createAdapterEnvelope,
  createAdapterError
} from './execution-adapter-protocol.js';

export const TYPED_WORK_LIFECYCLE_SCHEMA = 'titan-zero-typed-work-lifecycle/v1';
export const TERMINAL_STATES = Object.freeze(new Set(['complete','error','cancelled','timed_out']));

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function rejectLegacy(input) {
  if (!input || typeof input !== 'object') return;
  if ('tenant_id' in input || 'tenant_company_id' in input) throw new TypeError('legacy tenant boundaries are not accepted');
}

function requirePrepared(prepared) {
  if (!prepared || typeof prepared !== 'object' || !prepared.envelope || !prepared.gate) {
    throw new TypeError('prepared typed submission is required');
  }
  if (prepared.envelope.type !== TITAN_ADAPTER_MESSAGE_TYPES.WORK_SUBMIT) {
    throw new TypeError('prepared submission must carry TITAN_WORK_SUBMIT');
  }
  if (prepared.gate.company_id !== prepared.envelope.company_id || prepared.gate.execution_allowed !== true) {
    throw new TypeError('prepared submission authority gate is invalid');
  }
  return prepared;
}

function common(prepared, type, payload=null) {
  return createAdapterEnvelope({
    type,
    version:prepared.envelope.version,
    company_id:prepared.envelope.company_id,
    work_id:prepared.envelope.work_id,
    correlation_id:prepared.envelope.correlation_id,
    operation_id:prepared.envelope.operation_id,
    idempotency_key:prepared.envelope.idempotency_key,
    source:'titan-typed-work-lifecycle',
    context:prepared.envelope.context,
    payload,
    capabilities:prepared.envelope.capabilities
  });
}

export function createTypedLifecycle(preparedSubmission, options={}) {
  const prepared=requirePrepared(preparedSubmission);
  const timeout_ms=Number.isFinite(options.timeout_ms) && options.timeout_ms > 0 ? Math.floor(options.timeout_ms) : 30000;
  const started_at=Number.isFinite(options.started_at) ? options.started_at : Date.now();
  let state='submitted';
  let terminal=null;
  let progress=0;
  let sequence=0;

  const snapshot=()=>Object.freeze({
    schema:TYPED_WORK_LIFECYCLE_SCHEMA,
    company_id:prepared.envelope.company_id,
    work_id:prepared.envelope.work_id,
    correlation_id:prepared.envelope.correlation_id,
    state, progress, sequence, started_at, timeout_ms, terminal,
    adapter_granted_authority:false,
    execution_authority:false
  });

  const ensureOpen=()=>{ if (TERMINAL_STATES.has(state)) throw new TypeError(`work lifecycle is terminal: ${state}`); };

  const accept=(payload={})=>{
    ensureOpen();
    if (!['submitted','accepted'].includes(state)) throw new TypeError(`cannot accept from state ${state}`);
    state='accepted'; sequence+=1;
    return Object.freeze({snapshot:snapshot(), envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_ACCEPTED,{...payload,state:'accepted'})});
  };

  const updateProgress=(input={})=>{
    ensureOpen();
    if (!['accepted','working'].includes(state)) throw new TypeError(`cannot report progress from state ${state}`);
    const next=Number(input.progress);
    if (!Number.isFinite(next) || next < 0 || next > 1) throw new TypeError('progress must be between 0 and 1');
    if (next < progress) throw new TypeError('progress cannot move backwards');
    progress=next; state='working'; sequence+=1;
    return Object.freeze({snapshot:snapshot(), envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_PROGRESS,{progress,current_step:clean(input.current_step),sequence})});
  };

  const complete=(result=null)=>{
    ensureOpen();
    if (!['accepted','working'].includes(state)) throw new TypeError(`cannot complete from state ${state}`);
    progress=1; state='complete'; sequence+=1;
    terminal=Object.freeze({kind:'complete',at:Date.now()});
    return Object.freeze({snapshot:snapshot(), envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_COMPLETE,{status:'complete',result})});
  };

  const fail=(input={})=>{
    ensureOpen();
    if (!['submitted','accepted','working'].includes(state)) throw new TypeError(`cannot fail from state ${state}`);
    state='error'; sequence+=1;
    const error=createAdapterError({
      company_id:prepared.envelope.company_id,
      work_id:prepared.envelope.work_id,
      correlation_id:prepared.envelope.correlation_id,
      code:clean(input.code) ?? 'WORK_FAILED',
      message:clean(input.message) ?? 'Work failed',
      retryable:input.retryable === true,
      fatal:input.fatal === true
    });
    terminal=Object.freeze({kind:'error',code:error.code,at:Date.now()});
    return Object.freeze({snapshot:snapshot(), envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_ERROR,error)});
  };

  const cancellationRequest=(input={})=>{
    rejectLegacy(input); ensureOpen();
    const company_id=clean(input.company_id);
    if (!company_id || company_id !== prepared.envelope.company_id) throw new TypeError('cancellation company_id must match work company_id');
    if (!prepared.envelope.capabilities.includes('cancellation')) throw new TypeError('cancellation capability was not negotiated');
    return common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_CANCEL,{reason:clean(input.reason) ?? 'cancel_requested'});
  };

  const cancel=(input={})=>{
    rejectLegacy(input); ensureOpen();
    const company_id=clean(input.company_id);
    if (!company_id || company_id !== prepared.envelope.company_id) throw new TypeError('cancellation company_id must match work company_id');
    if (!prepared.envelope.capabilities.includes('cancellation')) throw new TypeError('cancellation capability was not negotiated');
    state='cancelled'; sequence+=1;
    terminal=Object.freeze({kind:'cancelled',reason:clean(input.reason) ?? 'cancelled',at:Date.now()});
    return Object.freeze({snapshot:snapshot(), envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_CANCELLED,{reason:terminal.reason})});
  };

  const checkTimeout=(now=Date.now())=>{
    ensureOpen();
    if (!Number.isFinite(now)) throw new TypeError('timeout clock must be finite');
    if (now - started_at < timeout_ms) return Object.freeze({timed_out:false,snapshot:snapshot(),envelope:null});
    state='timed_out'; sequence+=1;
    terminal=Object.freeze({kind:'timed_out',at:now});
    const error=createAdapterError({company_id:prepared.envelope.company_id,work_id:prepared.envelope.work_id,correlation_id:prepared.envelope.correlation_id,code:'WORK_TIMEOUT',message:'Typed adapter work timed out',retryable:true,fatal:false});
    return Object.freeze({timed_out:true,snapshot:snapshot(),envelope:common(prepared,TITAN_ADAPTER_MESSAGE_TYPES.WORK_ERROR,error)});
  };

  return Object.freeze({snapshot,accept,updateProgress,complete,fail,cancellationRequest,cancel,checkTimeout});
}
