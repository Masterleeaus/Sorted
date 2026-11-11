/** Explicit preconditions for a Sorted-local Central SSO handoff.
 * Verification of OIDC tokens and Central entitlements happens upstream.
 * This module does NOT accept a browser query parameter as the company.
 */
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SUBJECT=/^[^\s\x00-\x1f\x7f]{1,256}$/u;
export type CentralVerifiedSelection={
 issuer:string;subject:string;companyId:string;accountId:string;
 audience:string;verifiedAt:string;authority:'central-verified';
};
export function validateCentralSelection(value:unknown,audience:string):CentralVerifiedSelection|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const r=value as Record<string,unknown>;
 if(Object.keys(r).sort().join(',')!=='accountId,audience,authority,companyId,issuer,subject,verifiedAt')return null;
 if(r.authority!=='central-verified'||r.audience!==audience||
  typeof r.issuer!=='string'||typeof r.subject!=='string'||!SUBJECT.test(r.subject)||
  typeof r.accountId!=='string'||!UUID.test(r.accountId)||
  typeof r.companyId!=='string'||!UUID.test(r.companyId)||
  typeof r.verifiedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(r.verifiedAt))return null;
 try{
  const u=new URL(r.issuer);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||
     (u.href!==r.issuer&&u.origin!==r.issuer))return null;
  const ms=Date.parse(r.verifiedAt);
  if(!Number.isFinite(ms)||Math.abs(Date.now()-ms)>120_000)return null;
 }catch{return null}
 return r as CentralVerifiedSelection;
}
