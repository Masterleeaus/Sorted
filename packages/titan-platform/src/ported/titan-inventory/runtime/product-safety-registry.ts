// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-inventory/runtime/product-safety-registry.mjs
const LEGACY_BOUNDARY_KEYS=['tenant_id','tenant_company_id','business_id','account_id','workspace_id'];
function assertString(value,name){ if(typeof value!=='string'||!value.trim()) throw new TypeError(`${name} must be a non-empty string`); return value.trim(); }
function optionalString(value,name){ return value==null?null:assertString(value,name); }
function assertNoLegacyBoundary(value){ if(!value||typeof value!=='object') return; for(const key of LEGACY_BOUNDARY_KEYS){ if(Object.prototype.hasOwnProperty.call(value,key)) throw new Error(`legacy boundary ${key} is not allowed`); } }
function clone(value){ return value==null?value:JSON.parse(JSON.stringify(value)); }
function strings(value){ return Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))]:[]; }
function provenance(input,fallback){
  assertNoLegacyBoundary(input);
  const source=assertString(input?.source??'inventory_runtime','provenance.source');
  const idempotency_key=assertString(input?.idempotency_key??fallback,'provenance.idempotency_key');
  const recorded_at=input?.recorded_at??new Date().toISOString();
  if(Number.isNaN(Date.parse(recorded_at))) throw new TypeError('provenance.recorded_at must be an ISO date-time');
  return {source,source_ref:input?.source_ref??null,recorded_at,idempotency_key,trace_id:input?.trace_id??null,correlation_id:input?.correlation_id??null};
}
function key(company_id,product_id){ return `${company_id}::${product_id}`; }
function normalizeSupplier(input){
  const supplier_id=optionalString(input?.supplier_id,'supplier_id');
  const supplier_sku=optionalString(input?.supplier_sku,'supplier_sku');
  const manufacturer=optionalString(input?.manufacturer,'manufacturer');
  if(!supplier_id&&!supplier_sku&&!manufacturer) return null;
  return {supplier_id,supplier_sku,manufacturer};
}
function safetyState(safety_note,sds_ref){
  if(sds_ref) return 'SDS_REFERENCE_AVAILABLE';
  if(typeof safety_note==='string' && /\bSDS\b|safety data sheet/i.test(safety_note)) return 'SDS_REFERENCE_REQUIRED_NOT_PROVIDED';
  return 'SDS_REFERENCE_NOT_PROVIDED';
}

export class ProductSafetyRegistry {
  #records=new Map();

  register(input){
    assertNoLegacyBoundary(input);
    const company_id=assertString(input.company_id,'company_id');
    const catalog_product_id=optionalString(input.catalog_product_id,'catalog_product_id');
    const marketplace_product_id=optionalString(input.marketplace_product_id,'marketplace_product_id');
    const product_id=catalog_product_id??marketplace_product_id;
    if(!product_id) throw new TypeError('catalog_product_id or marketplace_product_id is required');
    const p=provenance(input.provenance,`product-safety:${company_id}:${product_id}`);
    const recordKey=key(company_id,product_id);
    const existing=this.#records.get(recordKey);
    if(existing && existing.provenance.idempotency_key===p.idempotency_key) return {replayed:true,record:clone(existing)};
    const safety_note=optionalString(input.safety_note,'safety_note');
    const sds_ref=optionalString(input.sds_ref,'sds_ref');
    const record={
      company_id,
      product_id,
      catalog_product_id,
      marketplace_product_id,
      name:optionalString(input.name,'name'),
      category:optionalString(input.category,'category'),
      supplier:normalizeSupplier(input),
      compatibility:{
        tags:strings(input.tags),
        job_types:strings(input.job_types),
        surface_notes:strings(input.surface_notes),
        incompatibility_notes:strings(input.incompatibility_notes)
      },
      safety:{
        safety_note,
        sds_ref,
        sds_state:safetyState(safety_note,sds_ref),
        hazard_class:optionalString(input.hazard_class,'hazard_class'),
        ppe_refs:strings(input.ppe_refs)
      },
      lifecycle_state:input.lifecycle_state??'active',
      authority:{purchase_authority_granted:false,execution_authority_granted:false,safety_metadata_grants_authority:false},
      provenance:p
    };
    this.#records.set(recordKey,record);
    return {replayed:false,record:clone(record)};
  }

  importCleaningSupplyCatalog(company_id,catalog,{provenance_source='titan_cleaning_supply_catalog'}={}){
    company_id=assertString(company_id,'company_id');
    if(!catalog||typeof catalog!=='object'||!Array.isArray(catalog.products)) throw new TypeError('catalog.products array is required');
    return catalog.products.map(product=>this.register({
      company_id,
      catalog_product_id:assertString(product.id,'product.id'),
      name:product.name??null,
      category:product.category??null,
      tags:product.tags,
      job_types:product.job_types,
      safety_note:product.safety??null,
      sds_ref:product.sds_ref??null,
      supplier_id:product.supplier_id??null,
      supplier_sku:product.supplier_sku??null,
      manufacturer:product.manufacturer??null,
      provenance:{source:provenance_source,source_ref:catalog.schema??null,recorded_at:new Date().toISOString(),idempotency_key:`catalog:${catalog.version??'unknown'}:${product.id}`}
    }));
  }

  get(company_id,product_id){ company_id=assertString(company_id,'company_id'); product_id=assertString(product_id,'product_id'); return clone(this.#records.get(key(company_id,product_id))??null); }
  list(company_id){ company_id=assertString(company_id,'company_id'); return [...this.#records.values()].filter(r=>r.company_id===company_id).sort((a,b)=>a.product_id.localeCompare(b.product_id)).map(clone); }
  findForJob(company_id,job_type){ company_id=assertString(company_id,'company_id'); job_type=assertString(job_type,'job_type'); return this.list(company_id).filter(r=>r.compatibility.job_types.includes('all')||r.compatibility.job_types.includes(job_type)); }
  requiresSdsAttention(company_id){ return this.list(company_id).filter(r=>r.safety.sds_state==='SDS_REFERENCE_REQUIRED_NOT_PROVIDED'); }
}
export function createProductSafetyRegistry(){ return new ProductSafetyRegistry(); }
