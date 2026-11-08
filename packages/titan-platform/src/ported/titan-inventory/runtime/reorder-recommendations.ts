// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/reorder-recommendations.mjs
const LEGACY_BOUNDARY_KEYS = ['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];

function assertString(value, name){
  if(typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value.trim();
}
function assertNoLegacyBoundary(value){
  if(!value || typeof value !== 'object') return;
  for(const key of LEGACY_BOUNDARY_KEYS){
    if(Object.prototype.hasOwnProperty.call(value,key)) throw new Error(`legacy boundary ${key} is not allowed`);
  }
}
function clone(value){ return value == null ? value : JSON.parse(JSON.stringify(value)); }
function nonNegative(value,name){
  if(typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a non-negative finite number`);
  return value;
}
function optionalPositive(value,name){
  if(value == null) return null;
  if(typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be a positive finite number`);
  return value;
}
function normalizeProductRef(input){
  const catalog_product_id = input.catalog_product_id == null ? null : assertString(input.catalog_product_id,'catalog_product_id');
  const marketplace_product_id = input.marketplace_product_id == null ? null : assertString(input.marketplace_product_id,'marketplace_product_id');
  if(!catalog_product_id && !marketplace_product_id) return null;
  return {catalog_product_id,marketplace_product_id};
}
function provenance(input, fallback){
  assertNoLegacyBoundary(input);
  const source=assertString(input?.source ?? 'inventory_runtime','provenance.source');
  const idempotency_key=assertString(input?.idempotency_key ?? fallback,'provenance.idempotency_key');
  const recorded_at=input?.recorded_at ?? new Date().toISOString();
  if(Number.isNaN(Date.parse(recorded_at))) throw new TypeError('provenance.recorded_at must be an ISO date-time');
  return {source,source_ref:input?.source_ref??null,recorded_at,idempotency_key,trace_id:input?.trace_id??null,correlation_id:input?.correlation_id??null};
}
function policyKey(company_id,consumable_id,stock_location_id){ return `${company_id}::${consumable_id}::${stock_location_id}`; }

export class ReorderRecommendationEngine {
  #ledger;
  #policies = new Map();

  constructor({ledger}={}){
    if(!ledger || typeof ledger.getBalance !== 'function') throw new TypeError('ledger with getBalance is required');
    this.#ledger=ledger;
  }

  setPolicy(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const stock_location_id=assertString(input.stock_location_id,'stock_location_id');
    const p=provenance(input.provenance,`reorder-policy:${company_id}:${consumable_id}:${stock_location_id}`);
    const key=policyKey(company_id,consumable_id,stock_location_id);
    const existing=this.#policies.get(key);
    if(existing && existing.provenance.idempotency_key === p.idempotency_key) return {replayed:true,policy:clone(existing)};
    const reorder_threshold=nonNegative(input.reorder_threshold,'reorder_threshold');
    const target_stock=optionalPositive(input.target_stock,'target_stock');
    if(target_stock != null && target_stock < reorder_threshold) throw new RangeError('target_stock must be greater than or equal to reorder_threshold');
    const product_ref=normalizeProductRef(input);
    const policy={
      company_id,consumable_id,stock_location_id,reorder_threshold,target_stock,
      product_ref,
      lifecycle_state:input.lifecycle_state??'active',
      authority:{purchase_authority_granted:false,automatic_order_authority_granted:false,marketplace_identity_grants_authority:false},
      provenance:p
    };
    this.#policies.set(key,policy);
    return {replayed:false,policy:clone(policy)};
  }

  getPolicy(company_id,consumable_id,stock_location_id){
    company_id=assertString(company_id,'company_id'); consumable_id=assertString(consumable_id,'consumable_id'); stock_location_id=assertString(stock_location_id,'stock_location_id');
    return clone(this.#policies.get(policyKey(company_id,consumable_id,stock_location_id)) ?? null);
  }

  listPolicies(company_id){
    company_id=assertString(company_id,'company_id');
    return [...this.#policies.values()].filter(p=>p.company_id===company_id).sort((a,b)=>(a.consumable_id+a.stock_location_id).localeCompare(b.consumable_id+b.stock_location_id)).map(clone);
  }

  recommend(company_id,{include_sufficient=false}={}){
    company_id=assertString(company_id,'company_id');
    return this.listPolicies(company_id).flatMap(policy=>{
      if(policy.lifecycle_state !== 'active') return [];
      const on_hand=this.#ledger.getBalance(company_id,policy.consumable_id,policy.stock_location_id);
      const needs_reorder=on_hand <= policy.reorder_threshold;
      if(!needs_reorder && !include_sufficient) return [];
      const target=policy.target_stock ?? policy.reorder_threshold;
      const suggested_quantity=Math.max(0,target-on_hand);
      return [{
        recommendation_id:`reorder:${company_id}:${policy.consumable_id}:${policy.stock_location_id}`,
        company_id,
        consumable_id:policy.consumable_id,
        stock_location_id:policy.stock_location_id,
        on_hand,
        reorder_threshold:policy.reorder_threshold,
        target_stock:policy.target_stock,
        suggested_quantity,
        status:needs_reorder?'REORDER_RECOMMENDED':'SUFFICIENT_STOCK',
        product_ref:clone(policy.product_ref),
        action:'REVIEW_REPLENISHMENT',
        authority:{purchase_authority_granted:false,automatic_order_authority_granted:false,marketplace_identity_grants_authority:false},
        provenance:{source:'inventory_reorder_engine',source_ref:policy.provenance.source_ref,policy_idempotency_key:policy.provenance.idempotency_key}
      }];
    });
  }
}

export function createReorderRecommendationEngine(options){ return new ReorderRecommendationEngine(options); }
