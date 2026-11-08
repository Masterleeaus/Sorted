// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/job-inventory-evidence.mjs
const LEGACY_BOUNDARY_KEYS = ['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];

function assertString(v,n){ if(typeof v!=='string'||!v.trim()) throw new TypeError(`${n} must be a non-empty string`); return v.trim(); }
function assertNoLegacyBoundary(v){ if(!v||typeof v!=='object') return; for(const k of LEGACY_BOUNDARY_KEYS){ if(Object.prototype.hasOwnProperty.call(v,k)) throw new Error(`legacy boundary ${k} is not allowed`); } }
function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }
function assertLedger(ledger){ if(!ledger||typeof ledger.use!=='function'||typeof ledger.stockIn!=='function') throw new TypeError('stock ledger with use/stockIn is required'); return ledger; }

export class JobInventoryEvidence {
  #ledger;
  #evidence = new Map();

  constructor({ledger}={}){ this.#ledger=assertLedger(ledger); }

  #key(company_id,idempotency_key){ return `${company_id}::${idempotency_key}`; }

  #record({company_id,job_id,kind,consumable_id,stock_location_id,quantity,provenance,reason=null,source_event}){
    const idempotency_key=assertString(provenance?.idempotency_key,'provenance.idempotency_key');
    const key=this.#key(company_id,idempotency_key);
    if(this.#evidence.has(key)) return {replayed:true,evidence:clone(this.#evidence.get(key)),stock_event:clone(source_event)};
    const evidence={
      evidence_id:idempotency_key,
      company_id,
      job_id,
      evidence_type:kind,
      consumable_id,
      stock_location_id,
      quantity,
      reason,
      stock_event_id:source_event?.event_id??null,
      stock_balance_after:source_event?.balance_after??null,
      authority:{
        job_authority_granted:false,
        purchasing_authority_granted:false,
        invoice_authority_granted:false,
        scheduling_authority_granted:false,
        completion_authority_granted:false
      },
      provenance:clone(provenance)
    };
    this.#evidence.set(key,evidence);
    return {replayed:false,evidence:clone(evidence),stock_event:clone(source_event)};
  }

  recordJobConsumption(input){
    assertNoLegacyBoundary(input);
    assertNoLegacyBoundary(input?.provenance);
    const company_id=assertString(input.company_id,'company_id');
    const job_id=assertString(input.job_id,'job_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const stock_location_id=assertString(input.stock_location_id,'stock_location_id');
    const quantity=input.quantity;
    const provenance=input.provenance;
    const key=this.#key(company_id,assertString(provenance?.idempotency_key,'provenance.idempotency_key'));
    if(this.#evidence.has(key)) return {replayed:true,evidence:clone(this.#evidence.get(key)),stock_event:null};
    const stock=this.#ledger.use({company_id,job_id,consumable_id,stock_location_id,quantity,reason:input.reason??'job_consumption',provenance});
    return this.#record({company_id,job_id,kind:'job_consumption',consumable_id,stock_location_id,quantity,provenance,reason:input.reason??null,source_event:stock.event});
  }

  recordReplenishmentEvidence(input){
    assertNoLegacyBoundary(input);
    assertNoLegacyBoundary(input?.provenance);
    const company_id=assertString(input.company_id,'company_id');
    const job_id=assertString(input.job_id,'job_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const stock_location_id=assertString(input.stock_location_id,'stock_location_id');
    const quantity=input.quantity;
    const provenance=input.provenance;
    const key=this.#key(company_id,assertString(provenance?.idempotency_key,'provenance.idempotency_key'));
    if(this.#evidence.has(key)) return {replayed:true,evidence:clone(this.#evidence.get(key)),stock_event:null};
    const stock=this.#ledger.stockIn({company_id,job_id,consumable_id,stock_location_id,quantity,reason:input.reason??'job_replenishment',provenance});
    return this.#record({company_id,job_id,kind:'job_replenishment',consumable_id,stock_location_id,quantity,provenance,reason:input.reason??null,source_event:stock.event});
  }

  listJobEvidence(company_id,job_id){
    company_id=assertString(company_id,'company_id'); job_id=assertString(job_id,'job_id');
    return [...this.#evidence.values()].filter(e=>e.company_id===company_id&&e.job_id===job_id).map(clone);
  }
}

export function createJobInventoryEvidence(options){ return new JobInventoryEvidence(options); }
