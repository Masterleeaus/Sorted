import type { DistributedFailure, IntelligencePlacement, StoragePlacement } from './contracts.js';
export const COST_SOVEREIGNTY_ORDER = ['device','customer_hosted','customer_provider','entitled_titan','metered_titan'] as const;
export function assertSingleCanonicalOwner(placements: readonly StoragePlacement[], dataClass: string): StoragePlacement {
  const owners=placements.filter(p=>p.role==='canonical' && p.data_classes.includes(dataClass));
  if (owners.length!==1) throw new Error(`canonical-storage-owner-count:${dataClass}:${owners.length}`); return owners[0]!;
}
export function offlineAuthorityFailure(company_id:string, reason='offline-authority-recheck-required'): DistributedFailure {
  return {company_id,code:'OFFLINE_AUTHORITY_CONTRACTED',disposition:'queue_for_recheck',authority_may_increase:false,reason};
}
export function assertIntelligenceNoImplicitTitanCost(p: IntelligencePlacement, titanEntitled=false): void {
  if ((p.cost_class==='entitled_titan'||p.cost_class==='metered_titan') && !titanEntitled) throw new Error('titan-funded-intelligence-not-entitled');
}
