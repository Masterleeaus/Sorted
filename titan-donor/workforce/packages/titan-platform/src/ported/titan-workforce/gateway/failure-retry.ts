// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-workforce/gateway/failure-retry.mjs
import { createOfflineConflictRetryPolicy } from '../../titan-offline/conflict-retry-policy.js';

const clean=value=>String(value??'').trim();

export function classifyWorkforceFailure(raw={}){
  const operation_kind=clean(raw.operation_kind||raw.kind||'proposal').toLowerCase();
  const phase=clean(raw.phase||'after_dispatch').toLowerCase();
  const status=Number(raw.http_status||raw.status||0);
  const code=clean(raw.error_code||raw.code).toLowerCase();
  const message=clean(raw.error||raw.message).toLowerCase();
  const explicitlyPreDispatch=raw.dispatch_proven===false||phase==='pre_dispatch_proven';
  const readOnly=operation_kind==='read'||raw.read_only===true;
  let category='permanent',failure_class='terminal_failure',reason='unclassified-permanent';
  if(raw.offline===true||code==='offline'||message.includes('offline')){category='network';failure_class='offline';reason='offline';}
  else if(status===401||code==='unauthorized'||message.includes('unauthorized')){category='authentication';failure_class='terminal_failure';reason='authentication-required';}
  else if(status===403||code==='forbidden'||message.includes('policy_denied')||message.includes('authority')){category='policy';failure_class='policy_denied';reason='policy-or-authority-denied';}
  else if(status===409||status===412||code.includes('conflict')||message.includes('stale')||message.includes('version conflict')){category='conflict';failure_class='version_conflict';reason='state-conflict';}
  else if(status===424||code.includes('dependency')){category='dependency';failure_class=(readOnly||explicitlyPreDispatch)?'provider_unavailable':'unknown_effect_outcome';reason='dependency-failure';}
  else if(code.includes('storage')||message.includes('indexeddb')||message.includes('storage')){category='storage';failure_class=raw.retry_safe===true?'provider_unavailable':'terminal_failure';reason='storage-failure';}
  else if(status===429||code==='rate_limited'){category='dependency';failure_class=(readOnly||explicitlyPreDispatch)?'rate_limited':'unknown_effect_outcome';reason='rate-limited';}
  else if(status===408||status===425||[500,502,503,504].includes(status)){category='network';failure_class=(readOnly||explicitlyPreDispatch)?(status===408?'timeout_before_dispatch':'provider_unavailable'):'unknown_effect_outcome';reason='transient-http';}
  else if(status===0&&(code.includes('network')||code.includes('timeout')||message.includes('network')||message.includes('fetch')||message.includes('timeout'))){category='network';failure_class=(readOnly||explicitlyPreDispatch)?(message.includes('timeout')?'timeout_before_dispatch':'network_unavailable'):'unknown_effect_outcome';reason='transport-failure';}
  else if([400,404,405,410,422].includes(status)||code.includes('validation')){category='permanent';failure_class='validation_failed';reason='request-invalid-or-terminal';}
  return Object.freeze({category,failure_class,reason,operation_kind,phase,http_status:status||null,dispatch_proven:raw.dispatch_proven===true?true:raw.dispatch_proven===false?false:null,read_only:readOnly,grants_authority:false,authority_effect:false});
}

export function createWorkforceRetryEvaluator({clock=()=>Date.now(),base_delay_ms=1000,max_delay_ms=60000,max_retries=5}={}){
  const policy=createOfflineConflictRetryPolicy({clock,base_delay_ms,max_delay_ms,max_retries});
  return Object.freeze({
    classify:classifyWorkforceFailure,
    evaluate(raw={},options={}){
      const company_id=clean(options.company_id||raw.company_id);
      if(!company_id)throw new Error('company_id-required');
      if(raw.company_id&&clean(raw.company_id)!==company_id)throw new Error('cross-company:workforce-retry');
      const classification=classifyWorkforceFailure(raw);
      const record={company_id,retry_count:Number(raw.retry_count||0),terminal:raw.terminal===true,operation_id:clean(raw.operation_id).slice(0,180)||null,idempotency_key:clean(raw.idempotency_key).slice(0,220)||null};
      const evaluated=policy.evaluate(record,{company_id,failure_class:classification.failure_class,max_retries:Number.isFinite(Number(raw.max_retries))?Number(raw.max_retries):max_retries,base_delay_ms:Number.isFinite(Number(raw.base_delay_ms))?Number(raw.base_delay_ms):base_delay_ms,max_delay_ms:Number.isFinite(Number(raw.max_delay_ms))?Number(raw.max_delay_ms):max_delay_ms});
      const safeAutomaticRetry=evaluated.retry_allowed===true&&(classification.read_only||classification.dispatch_proven===false);
      return Object.freeze({...evaluated,...classification,retry_allowed:safeAutomaticRetry,requires_explicit_resume:!safeAutomaticRetry||evaluated.requires_explicit_resume===true,automatic_effect_replay:false,effect_replay_allowed:false,grants_authority:false,authority_effect:false});
    }
  });
}
