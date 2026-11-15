/** Safe handoff into Sorted's OWN JWT and account-id session boundary.
 * No session is minted until the real product account resolver succeeds.
 * Existing email/password login remains unchanged and enabled.
 * JWT revocation/rotation still needs an app-owned durable session generation.
 */
import type {ResolvedSortedAccount} from './central-account-resolver';
export function createSortedCentralSessionGate({
 resolveAccount,createLocalSession
}:{
 resolveAccount:(selection:unknown)=>Promise<ResolvedSortedAccount|null>;
 createLocalSession:(account:ResolvedSortedAccount)=>Promise<string>;
}){
 if(typeof resolveAccount!=='function'||typeof createLocalSession!=='function')
  throw new TypeError('trusted Sorted session dependencies required');
 return async(selection:unknown):Promise<string|null>=>{
  const account=await resolveAccount(selection);
  if(!account)return null;
  try{
   const token=await createLocalSession(account);
   return typeof token==='string'&&token.length>=32&&token.length<=8192&&!/\s/.test(token)?token:null;
  }catch{return null}
 };
}
