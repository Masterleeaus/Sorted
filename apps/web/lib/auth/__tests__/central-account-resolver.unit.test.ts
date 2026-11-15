import {describe,it,expect,vi} from 'vitest';
import {createSortedCentralAccountResolver} from '../central-account-resolver';
const accountId='00000000-0000-4000-8000-000000000001';
const companyId='00000000-0000-4000-8000-000000000002';
const selection=()=>({issuer:'https://issuer.example',subject:'verified-subject',companyId,accountId,
 audience:'sorted',verifiedAt:new Date().toISOString(),authority:'central-verified' as const});
const row={user_id:'u-1',account_id:accountId,role:'owner',revision:3};
function setup(overrides:Record<string,unknown>={}){
 const map=vi.fn(async()=>accountId),allow=vi.fn(async()=>true);
 const lookup=vi.fn(async()=>[row]);
 const resolver=createSortedCentralAccountResolver({audience:'sorted',verifiedAccountMap:map,
 authoriseCentralCompany:allow,lookup,...overrides});
 return {resolver,map,allow,lookup};
}
describe('Sorted Central exact account boundary',()=>{
 it('maps one verified identity to one account-owned local user',async()=>{
  const x=setup();expect(await x.resolver(selection())).toEqual({
   userId:'u-1',accountId,role:'owner',linkRevision:3});
  expect(x.lookup).toHaveBeenCalledWith('https://issuer.example','verified-subject',accountId);
 });
 it('rejects a company mapped to a different Sorted account before local lookup',async()=>{
  const x=setup({verifiedAccountMap:async()=> '00000000-0000-4000-8000-000000000099'});
  expect(await x.resolver(selection())).toBeNull();expect(x.lookup).not.toHaveBeenCalled();
 });
 it('rejects revoked Central company entitlement',async()=>{
  const x=setup({authoriseCentralCompany:async()=>false});
  expect(await x.resolver(selection())).toBeNull();expect(x.lookup).not.toHaveBeenCalled();
 });
 it('rejects ambiguous and mismatched local links',async()=>{
  for(const rows of [[],[row,row],[{...row,account_id:'foreign'}],[{...row,revision:0}]]){
   const x=setup({lookup:async()=>rows});expect(await x.resolver(selection())).toBeNull();
  }
 });
 it('rejects browser-supplied extra company or email and stale identity',async()=>{
  const x=setup();
  expect(await x.resolver({...selection(),email:'any@example.org'})).toBeNull();
  expect(await x.resolver({...selection(),verifiedAt:'2020-01-01T00:00:00.000Z'})).toBeNull();
  expect(x.lookup).not.toHaveBeenCalled();
 });
 it('never grants access when trusted lookup is unavailable',async()=>{
  const x=setup({lookup:async()=>{throw Error('db unavailable')}});
  expect(await x.resolver(selection())).toBeNull();
 });
});
