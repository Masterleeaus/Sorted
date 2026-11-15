/** Live Sorted-local account binding: requires independently verified
 * Central account mapping, fresh product entitlements and an offline
 * provisioned exact (issuer,subject,account) local user relationship.
 */
import {roleSchema,type Role} from '@ai-fsm/domain';
import {query} from '../db';
import {validateCentralSelection,type CentralVerifiedSelection} from './central-link-contract';
export type ResolvedSortedAccount={userId:string;accountId:string;role:Role;linkRevision:number};
type Row={user_id:string;account_id:string;role:string;revision:string|number;[key:string]:unknown};
export function createSortedCentralAccountResolver({
 audience,verifiedAccountMap,authoriseCentralCompany,lookup
}:{
 audience:string;
 verifiedAccountMap:(companyId:string)=>Promise<string|null>;
 authoriseCentralCompany:(selection:CentralVerifiedSelection)=>Promise<boolean>;
 lookup?:(issuer:string,subject:string,accountId:string)=>Promise<Row[]>;
}){
 if(typeof audience!=='string'||!audience||typeof verifiedAccountMap!=='function'||
  typeof authoriseCentralCompany!=='function')throw new TypeError('trusted Sorted Central resolver required');
 const read=lookup??((issuer:string,subject:string,accountId:string)=>query<Row>(
  'SELECT user_id,account_id,role,revision FROM app_central_resolve_account_link($1,$2,$3::uuid)',
  [issuer,subject,accountId]));
 return async(value:unknown):Promise<ResolvedSortedAccount|null>=>{
  const selection=validateCentralSelection(value,audience);
  if(!selection)return null;
  try{
   const mapped=await verifiedAccountMap(selection.companyId);
   if(mapped!==selection.accountId)return null;
   if(await authoriseCentralCompany(selection)!==true)return null;
   const rows=await read(selection.issuer,selection.subject,selection.accountId);
   if(rows.length!==1)return null;
   const row=rows[0],role=roleSchema.safeParse(row.role);
   const revision=Number(row.revision);
   if(!role.success||row.account_id!==selection.accountId||
     typeof row.user_id!=='string'||!row.user_id||
     !Number.isSafeInteger(revision)||revision<1)return null;
   return {userId:row.user_id,accountId:row.account_id,role:role.data,linkRevision:revision};
  }catch{return null}
 };
}
