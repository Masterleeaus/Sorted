// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/duplicate-lease-ownership.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
const arr=v=>Array.isArray(v)?v:[];
export function evaluateLeaseOwnership({company_id,operation_id=null,claims=[],observed_at=Date.now()}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const observed=Number(observed_at);
  const owners=[];
  for(const claim of arr(claims)){
    const claimCompany=clean(claim?.company_id);
    if(claimCompany && claimCompany!==companyId) throw new Error('cross-company:lease-claim');
    const owner=clean(claim?.lease_owner_id);
    const expires=Number(claim?.lease_expires_at);
    if(owner && Number.isFinite(expires) && Number.isFinite(observed) && observed<expires && !owners.includes(owner)) owners.push(owner);
  }
  owners.sort();
  const duplicate=owners.length>1;
  return freeze({
    schema:'titan.reliability.duplicate-lease-ownership.v1', company_id:companyId,
    operation_id:clean(operation_id)||null, observed_at:Number.isFinite(observed)?observed:null,
    active_owner_ids:freeze(owners), active_owner_count:owners.length,
    duplicate_active_ownership:duplicate, safe_to_continue:!duplicate,
    reason:duplicate?'duplicate_active_lease_owners':owners.length===1?'single_active_lease_owner':'no_active_lease_owner',
    assigns_replacement_owner:false, grants_authority:false, changes_permissions:false, changes_autonomy:false, authority_effect:false,
  });
}
