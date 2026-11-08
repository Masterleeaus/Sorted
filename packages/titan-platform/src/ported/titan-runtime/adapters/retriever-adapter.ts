// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/adapters/retriever-adapter.mjs
import { WorkRuntimeAdapter } from './work-runtime-adapter.js';

export const RETRIEVER_ADAPTER_SCHEMA = 'titan-zero-retriever-adapter/v1';
export const RETRIEVER_COMPAT_EXECUTE_TYPE = 'TITAN_EXECUTE_OUTCOME';

const clean = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function requireOutcome(payload={}) {
  const outcome=clean(payload.outcome ?? payload.goal ?? payload.instruction);
  if (!outcome) throw new TypeError('Retriever work payload requires outcome, goal, or instruction');
  return outcome;
}

export class RetrieverAdapter extends WorkRuntimeAdapter {
  constructor(options={}) {
    super({
      runtime:'Retriever',
      version:options.version,
      capabilities:options.capabilities ?? ['work_submission','progress_observation','result_delivery','cancellation']
    });
  }

  prepareRetrieverSubmission(input={}) {
    const prepared=this.prepareSubmission(input);
    const outcome=requireOutcome(prepared.envelope.payload || {});
    const compatibility_message=Object.freeze({
      type:RETRIEVER_COMPAT_EXECUTE_TYPE,
      requestId:prepared.envelope.work_id,
      company_id:prepared.envelope.company_id,
      outcome,
      displayOutcome:clean(prepared.envelope.payload?.display_outcome) ?? outcome,
      context:Object.freeze({
        ...prepared.envelope.context,
        company_id:prepared.envelope.company_id,
        operation_id:prepared.envelope.operation_id,
        correlation_id:prepared.envelope.correlation_id,
        idempotency_key:prepared.envelope.idempotency_key,
        titan_adapter:Object.freeze({
          protocol:prepared.envelope.protocol,
          version:prepared.envelope.version,
          typed_work_type:prepared.envelope.type,
          work_id:prepared.envelope.work_id
        })
      }),
      worker:prepared.envelope.payload?.worker ?? null,
      authority:Object.freeze({
        decision_id:prepared.gate.decision_id,
        authority_source:prepared.gate.authority_source,
        policy_version:prepared.gate.policy_version,
        approval_state:prepared.gate.approval_state,
        adapter_grants_authority:false,
        identity_grants_authority:false
      })
    });
    return Object.freeze({
      schema:RETRIEVER_ADAPTER_SCHEMA,
      runtime:'Retriever',
      typed_envelope:prepared.envelope,
      external_gate:prepared.gate,
      transport:Object.freeze({
        mode:'existing_retriever_bridge_compatibility',
        message:compatibility_message,
        protected_bridge_modified:false
      }),
      transport_performed:false,
      execution_authority:false,
      adapter_granted_authority:false
    });
  }

  async submit(input={}, transport) {
    if (!transport || typeof transport.send !== 'function') throw new TypeError('Retriever adapter transport.send is required');
    const prepared=this.prepareRetrieverSubmission(input);
    const receipt=await transport.send(prepared.transport.message);
    return Object.freeze({
      schema:'titan-zero-retriever-adapter-submit-receipt/v1',
      company_id:prepared.typed_envelope.company_id,
      work_id:prepared.typed_envelope.work_id,
      correlation_id:prepared.typed_envelope.correlation_id,
      idempotency_key:prepared.typed_envelope.idempotency_key,
      transport_mode:prepared.transport.mode,
      transport_performed:true,
      receipt:receipt ?? null,
      external_authority_consumed:true,
      adapter_granted_authority:false,
      execution_authority:false
    });
  }
}
