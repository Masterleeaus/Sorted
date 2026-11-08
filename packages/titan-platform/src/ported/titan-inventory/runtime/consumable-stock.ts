// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/consumable-stock.mjs
const LEGACY_BOUNDARY_KEYS = ['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];
const EVENT_TYPES = new Set(['stock_in','use','adjustment','waste']);

function assertString(v,n){ if(typeof v!=='string'||!v.trim()) throw new TypeError(`${n} must be a non-empty string`); return v.trim(); }
function assertNoLegacyBoundary(v){ if(!v||typeof v!=='object') return; for(const k of LEGACY_BOUNDARY_KEYS){ if(Object.prototype.hasOwnProperty.call(v,k)) throw new Error(`legacy boundary ${k} is not allowed`); } }
function clone(v){ return v==null?v:JSON.parse(JSON.stringify(v)); }
function provenance(p,key){ assertNoLegacyBoundary(p); const source=assertString(p?.source??'inventory_runtime','provenance.source'); const idempotency_key=assertString(p?.idempotency_key??key,'provenance.idempotency_key'); const recorded_at=p?.recorded_at??new Date().toISOString(); if(Number.isNaN(Date.parse(recorded_at))) throw new TypeError('provenance.recorded_at must be an ISO date-time'); return {source,source_ref:p?.source_ref??null,recorded_at,idempotency_key,trace_id:p?.trace_id??null,correlation_id:p?.correlation_id??null}; }
function stockKey(company_id, consumable_id, stock_location_id){ return `${company_id}::${consumable_id}::${stock_location_id}`; }
function sanitizeQty(v,name,{allowZero=false,signed=false}={}){ if(typeof v!=='number'||!Number.isFinite(v)) throw new TypeError(`${name} must be a finite number`); if(!signed && (allowZero?v<0:v<=0)) throw new RangeError(`${name} must be ${allowZero?'non-negative':'positive'}`); if(signed && !allowZero && v===0) throw new RangeError(`${name} must be non-zero`); return v; }

export class ConsumableStockLedger {
  #balances = new Map();
  #events = new Map();
  #transfers = new Map();

  getBalance(company_id, consumable_id, stock_location_id){
    company_id=assertString(company_id,'company_id'); consumable_id=assertString(consumable_id,'consumable_id'); stock_location_id=assertString(stock_location_id,'stock_location_id');
    return this.#balances.get(stockKey(company_id,consumable_id,stock_location_id)) ?? 0;
  }

  listBalances(company_id){
    company_id=assertString(company_id,'company_id'); const prefix=`${company_id}::`;
    return [...this.#balances.entries()].filter(([k])=>k.startsWith(prefix)).map(([k,quantity])=>{ const [,consumable_id,stock_location_id]=k.split('::'); return {company_id,consumable_id,stock_location_id,quantity}; }).sort((a,b)=>(a.consumable_id+a.stock_location_id).localeCompare(b.consumable_id+b.stock_location_id));
  }

  listEvents(company_id){ company_id=assertString(company_id,'company_id'); return [...this.#events.values()].filter(e=>e.company_id===company_id).sort((a,b)=>a.sequence-b.sequence).map(clone); }

  applyEvent(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const stock_location_id=assertString(input.stock_location_id,'stock_location_id');
    const event_type=assertString(input.event_type,'event_type');
    if(!EVENT_TYPES.has(event_type)) throw new RangeError(`unsupported event_type: ${event_type}`);
    const p=provenance(input.provenance,`${event_type}:${company_id}:${consumable_id}:${stock_location_id}`);
    const eventKey=`${company_id}::${p.idempotency_key}`;
    if(this.#events.has(eventKey)){
      const existing=this.#events.get(eventKey);
      if(existing.event_type!==event_type || existing.consumable_id!==consumable_id || existing.stock_location_id!==stock_location_id) throw new Error('idempotency key conflict with different stock event identity');
      return {replayed:true,event:clone(existing),balance:existing.balance_after};
    }

    let delta;
    if(event_type==='adjustment') delta=sanitizeQty(input.quantity,'quantity',{signed:true});
    else {
      const q=sanitizeQty(input.quantity,'quantity');
      delta=event_type==='stock_in'?q:-q;
    }
    const key=stockKey(company_id,consumable_id,stock_location_id);
    const before=this.#balances.get(key)??0;
    const after=before+delta;
    if(after < 0) throw new RangeError('stock event would create negative stock');
    const event={
      event_id:p.idempotency_key,
      company_id,consumable_id,stock_location_id,event_type,quantity:input.quantity,delta,balance_before:before,balance_after:after,
      reason:input.reason??null,
      job_id:input.job_id??null,
      authority:{job_authority_granted:false,purchase_authority_granted:false},
      provenance:p,
      sequence:this.#events.size+1
    };
    this.#balances.set(key,after); this.#events.set(eventKey,event);
    return {replayed:false,event:clone(event),balance:after};
  }

  stockIn(args){ return this.applyEvent({...args,event_type:'stock_in'}); }
  use(args){ return this.applyEvent({...args,event_type:'use'}); }
  adjust(args){ return this.applyEvent({...args,event_type:'adjustment'}); }
  waste(args){ return this.applyEvent({...args,event_type:'waste'}); }

  transfer(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const consumable_id=assertString(input.consumable_id,'consumable_id');
    const from_stock_location_id=assertString(input.from_stock_location_id,'from_stock_location_id');
    const to_stock_location_id=assertString(input.to_stock_location_id,'to_stock_location_id');
    if(from_stock_location_id===to_stock_location_id) throw new RangeError('transfer locations must differ');
    const quantity=sanitizeQty(input.quantity,'quantity');
    const p=provenance(input.provenance,`transfer:${company_id}:${consumable_id}:${from_stock_location_id}:${to_stock_location_id}`);
    const transferKey=`${company_id}::${p.idempotency_key}`;
    if(this.#transfers.has(transferKey)){
      const existing=this.#transfers.get(transferKey);
      if(existing.consumable_id!==consumable_id || existing.from_stock_location_id!==from_stock_location_id || existing.to_stock_location_id!==to_stock_location_id) throw new Error('idempotency key conflict with different stock transfer identity');
      return {replayed:true,transfer:clone(existing)};
    }
    const source_before=this.getBalance(company_id,consumable_id,from_stock_location_id);
    if(source_before<quantity) throw new RangeError('stock transfer would create negative stock');
    const destination_before=this.getBalance(company_id,consumable_id,to_stock_location_id);
    const out=this.adjust({company_id,consumable_id,stock_location_id:from_stock_location_id,quantity:-quantity,reason:input.reason??'stock_transfer_out',provenance:{...p,idempotency_key:`${p.idempotency_key}:out`}});
    const incoming=this.adjust({company_id,consumable_id,stock_location_id:to_stock_location_id,quantity,reason:input.reason??'stock_transfer_in',provenance:{...p,idempotency_key:`${p.idempotency_key}:in`}});
    const transfer={
      transfer_id:p.idempotency_key,company_id,consumable_id,from_stock_location_id,to_stock_location_id,quantity,
      source_balance_before:source_before,source_balance_after:out.balance,
      destination_balance_before:destination_before,destination_balance_after:incoming.balance,
      event_ids:[out.event.event_id,incoming.event.event_id],
      authority:{purchase_authority_granted:false,transfer_grants_business_authority:false},
      provenance:p
    };
    this.#transfers.set(transferKey,clone(transfer));
    return {replayed:false,transfer:clone(transfer)};
  }
}


export function createConsumableStockLedger(options){ return new ConsumableStockLedger(options); }
