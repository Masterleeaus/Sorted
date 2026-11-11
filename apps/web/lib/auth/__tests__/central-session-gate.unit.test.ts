import {describe,it,expect,vi} from 'vitest';
import {createSortedCentralSessionGate} from '../central-session-gate';
const account={userId:'u-1',accountId:'a-1',role:'owner' as const,linkRevision:1};
describe('Sorted native account session gate',()=>{
 it('only creates a product-local credential after exact account resolution',async()=>{
  const mint=vi.fn(async()=> 'x'.repeat(64));
  const gate=createSortedCentralSessionGate({resolveAccount:async()=>account,createLocalSession:mint});
  expect(await gate({verified:true})).toBe('x'.repeat(64));
  expect(mint).toHaveBeenCalledWith(account);
 });
 it('never calls mint for denied tenant or user binding',async()=>{
  const mint=vi.fn(async()=> 'x'.repeat(64));
  const gate=createSortedCentralSessionGate({resolveAccount:async()=>null,createLocalSession:mint});
  expect(await gate({companyId:'foreign'})).toBeNull();expect(mint).not.toHaveBeenCalled();
 });
 it('refuses empty, malformed or failed native credentials',async()=>{
  for(const token of ['', 'bad token','x'.repeat(8193)]){
   const gate=createSortedCentralSessionGate({resolveAccount:async()=>account,createLocalSession:async()=>token});
   expect(await gate({})).toBeNull();
  }
  const failed=createSortedCentralSessionGate({resolveAccount:async()=>account,
   createLocalSession:async()=>{throw Error('storage failure')}});
  expect(await failed({})).toBeNull();
 });
});
