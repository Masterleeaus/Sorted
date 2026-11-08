// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/stocktake-asset-exceptions.mjs
const LEGACY_BOUNDARY_KEYS = ['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];
const ASSET_EXCEPTION_TYPES = new Set(['damaged','lost']);

function assertString(v,n){ if(typeof v!=='string'||!v.trim()) throw new TypeError(`${n} must be a non-empty string`); return v.trim(); }
function assertNoLegacyBoundary(v){ if(!v||typeof v!=='object') return; for(const k of LEGACY_BOUNDARY_KEYS){ if(Object.prototype.hasOwnProperty.call(v,k)) throw new Error(`legacy boundary ${k} is not allowed`); } }
function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }
function provenance(p,key){ assertNoLegacyBoundary(p); const source=assertString(p?.source??'inventory_runtime','provenance.source'); const idempotency_key=assertString(p?.idempotency_key??key,'provenance.idempotency_key'); const recorded_at=p?.recorded_at??new Date().toISOString(); if(Number.isNaN(Date.parse(recorded_at))) throw new TypeError('provenance.recorded_at must be an ISO date-time'); return {source,source_ref:p?.source_ref??null,recorded_at,idempotency_key,trace_id:p?.trace_id??null,correlation_id:p?.correlation_id??null}; }
function finiteNonNegative(v,n){ if(typeof v!=='number'||!Number.isFinite(v)||v<0) throw new RangeError(`${n} must be a finite non-negative number`); return v; }

export class InventoryAuditWorkflows {
  #stockLedger;
  #equipmentRegister;
  #records = new Map();
  #sequence = 0;

  constructor({ stockLedger, equipmentRegister } = {}) {
    if (!stockLedger || typeof stockLedger.getBalance !== 'function' || typeof stockLedger.adjust !== 'function') throw new TypeError('stockLedger with getBalance/adjust is required');
    if (!equipmentRegister || typeof equipmentRegister.get !== 'function' || typeof equipmentRegister.updateStatus !== 'function' || typeof equipmentRegister.updateCondition !== 'function') throw new TypeError('equipmentRegister with get/updateStatus/updateCondition is required');
    this.#stockLedger = stockLedger;
    this.#equipmentRegister = equipmentRegister;
  }

  #dedupe(company_id, idempotency_key, action){
    const key=`${company_id}::${idempotency_key}`;
    if(this.#records.has(key)) return {replayed:true,record:clone(this.#records.get(key))};
    const record=action();
    this.#records.set(key,clone(record));
    return {replayed:false,record:clone(record)};
  }

  recordStocktake(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const stock_location_id=assertString(input.stock_location_id,'stock_location_id');
    const counted_quantity=finiteNonNegative(input.counted_quantity,'counted_quantity');
    const p=provenance(input.provenance,`stocktake:${company_id}:${consumable_id}:${stock_location_id}:${counted_quantity}`);
    return this.#dedupe(company_id,p.idempotency_key,()=>{
      const expected_quantity=this.#stockLedger.getBalance(company_id,consumable_id,stock_location_id);
      const discrepancy=counted_quantity-expected_quantity;
      let adjustment_event_id=null;
      let adjustment_applied=false;
      if(input.apply_adjustment===true && discrepancy!==0){
        const result=this.#stockLedger.adjust({company_id,consumable_id,stock_location_id,quantity:discrepancy,reason:input.reason??'stocktake_discrepancy',provenance:{...p,idempotency_key:`${p.idempotency_key}:adjustment`}});
        adjustment_event_id=result.event.event_id;
        adjustment_applied=true;
      }
      return {
        record_id:p.idempotency_key,
        record_type:'stocktake',
        company_id,consumable_id,stock_location_id,
        expected_quantity,counted_quantity,discrepancy,
        discrepancy_state:discrepancy===0?'MATCH':(discrepancy>0?'SURPLUS':'SHORTAGE'),
        review_required:discrepancy!==0,
        adjustment_requested:input.apply_adjustment===true,
        adjustment_applied,
        adjustment_event_id,
        reason:input.reason??null,
        authority:{purchase_authority_granted:false,automatic_reorder_authority_granted:false,stocktake_grants_business_authority:false},
        provenance:p,
        sequence:++this.#sequence
      };
    });
  }

  reportAssetException(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const asset_id=assertString(input.asset_id,'asset_id');
    const exception_type=assertString(input.exception_type,'exception_type');
    if(!ASSET_EXCEPTION_TYPES.has(exception_type)) throw new RangeError(`unsupported exception_type: ${exception_type}`);
    const p=provenance(input.provenance,`asset-exception:${company_id}:${asset_id}:${exception_type}`);
    return this.#dedupe(company_id,p.idempotency_key,()=>{
      const before=this.#equipmentRegister.get(company_id,asset_id);
      if(!before) throw new Error('asset not found for company_id');
      let mutation;
      if(exception_type==='damaged') mutation=this.#equipmentRegister.updateCondition({company_id,asset_id,condition_state:'damaged',provenance:{...p,idempotency_key:`${p.idempotency_key}:condition`}}).result;
      else mutation=this.#equipmentRegister.updateStatus({company_id,asset_id,lifecycle_state:'lost',provenance:{...p,idempotency_key:`${p.idempotency_key}:status`}}).result;
      const after=this.#equipmentRegister.get(company_id,asset_id);
      return {
        record_id:p.idempotency_key,
        record_type:'asset_exception',
        company_id,asset_id,exception_type,
        before:{lifecycle_state:before.lifecycle_state,condition_state:before.condition_state,assigned_worker_id:before.assigned_worker_id,assigned_vehicle_id:before.assigned_vehicle_id,assigned_site_id:before.assigned_site_id},
        after:{lifecycle_state:after.lifecycle_state,condition_state:after.condition_state,assigned_worker_id:after.assigned_worker_id,assigned_vehicle_id:after.assigned_vehicle_id,assigned_site_id:after.assigned_site_id},
        evidence:input.evidence??null,
        note:input.note??null,
        replacement_recommended:input.replacement_recommended===true,
        authority:{purchase_authority_granted:false,replacement_purchase_authority_granted:false,asset_exception_grants_business_authority:false},
        provenance:p,
        mutation_version:mutation?.version??after.version,
        sequence:++this.#sequence
      };
    });
  }

  listRecords(company_id,{record_type}={}){
    company_id=assertString(company_id,'company_id');
    return [...this.#records.values()].filter(r=>r.company_id===company_id).filter(r=>!record_type||r.record_type===record_type).sort((a,b)=>a.sequence-b.sequence).map(clone);
  }
}

export function createInventoryAuditWorkflows(options){ return new InventoryAuditWorkflows(options); }
