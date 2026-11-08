// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/lease-expiry-guard.mjs
const clean=v=>String(v??'').trim();
const freeze=v=>Object.freeze(v);
export function evaluateLeaseExpiry({company_id,operation_id=null,lease_owner_id=null,lease_expires_at,observed_at=Date.now()}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const expires=Number(lease_expires_at); const observed=Number(observed_at);
  const leaseValid=Number.isFinite(expires)&&Number.isFinite(observed)&&observed<expires;
  return freeze({
    schema:'titan.reliability.lease-expiry-guard.v1', company_id:companyId,
    operation_id:clean(operation_id)||null, lease_owner_id:clean(lease_owner_id)||null,
    lease_expires_at:Number.isFinite(expires)?expires:null, observed_at:Number.isFinite(observed)?observed:null,
    lease_valid:leaseValid, safe_to_continue:leaseValid,
    reason:leaseValid?'lease_valid':'lease_expired', grants_authority:false,
    assigns_replacement_owner:false, authority_effect:false,
  });
}
