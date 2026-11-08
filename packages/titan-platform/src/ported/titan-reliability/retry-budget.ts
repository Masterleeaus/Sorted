// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/retry-budget.mjs
const clean = value => String(value ?? '').trim();
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const freeze = state => Object.freeze({
  schema:'titan.reliability.retry-budget-state.v1',
  company_id:state.company_id,
  company_boundary:'company_id',
  operation_class:state.operation_class,
  capacity:state.capacity,
  tokens:state.tokens,
  refill_per_window:state.refill_per_window,
  window_ms:state.window_ms,
  last_refill_at:state.last_refill_at,
  consumed:state.consumed,
  rejected:state.rejected,
  authority_neutral:true,
  grants_authority:false,
  changes_permissions:false,
  changes_autonomy:false,
  authority_effect:false,
});
function requireState(state){ if(!state || state.schema!=='titan.reliability.retry-budget-state.v1') throw new TypeError('retry-budget-state-required'); return state; }
function assertCompany(state, company_id){ const id=clean(company_id); if(id && id!==state.company_id) throw new Error('cross-company:retry-budget'); }
export function createRetryBudget({company_id,operation_class='default',capacity=3,refill_per_window=1,window_ms=1000,now=Date.now()}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const cap=Math.max(1,Math.floor(finite(capacity,3)));
  return freeze({company_id:companyId,operation_class:clean(operation_class)||'default',capacity:cap,tokens:cap,refill_per_window:Math.max(0,Math.floor(finite(refill_per_window,1))),window_ms:Math.max(1,finite(window_ms,1000)),last_refill_at:Number(now),consumed:0,rejected:0});
}
export function replenishRetryBudget(state,{company_id,now=Date.now()}={}){
  const current=requireState(state); assertCompany(current,company_id);
  const currentTime=Number(now); const elapsed=Math.max(0,currentTime-current.last_refill_at);
  const windows=Math.floor(elapsed/current.window_ms); if(windows<1) return current;
  const tokens=Math.min(current.capacity,current.tokens+windows*current.refill_per_window);
  return freeze({...current,tokens,last_refill_at:current.last_refill_at+windows*current.window_ms});
}
export function consumeRetry(state,{company_id,now=Date.now()}={}){
  let current=replenishRetryBudget(requireState(state),{company_id,now});
  if(current.tokens<=0){
    return Object.freeze({allowed:false,reason:'retry_budget_exhausted',retry_after_ms:Math.max(0,current.window_ms-(Number(now)-current.last_refill_at)),next_state:freeze({...current,rejected:current.rejected+1})});
  }
  current=freeze({...current,tokens:current.tokens-1,consumed:current.consumed+1});
  return Object.freeze({allowed:true,reason:'retry_budget_available',retry_after_ms:0,next_state:current});
}
