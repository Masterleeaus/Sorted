import type { CompanyBound, DataLocality, DistributedFailure } from './contracts.js';

export type SovereigntyProfile = 'maximum_privacy' | 'private_hybrid' | 'managed';
export type NetworkState = 'offline' | 'local_only' | 'online';

export interface PlacementCandidate extends CompanyBound {
  target_id: string;
  locality: DataLocality;
  capabilities: readonly string[];
  trusted: boolean;
  healthy: boolean;
  data_classes?: readonly string[];
  latency_ms?: number;
  cost_rank?: number;
  battery_constrained?: boolean;
  thermal_constrained?: boolean;
}

export interface PlacementRequest extends CompanyBound {
  capability: string;
  required_data_classes?: readonly string[];
  profile: SovereigntyProfile;
  network: NetworkState;
  allow_data_egress?: boolean;
  prefer_locality?: readonly DataLocality[];
}

const DEFAULT_LOCALITY: Record<SovereigntyProfile, readonly DataLocality[]> = {
  maximum_privacy: ['device','edge','customer_hosted'],
  private_hybrid: ['device','edge','customer_hosted','provider'],
  managed: ['device','edge','customer_hosted','provider','titan_managed'],
};

export function allowedLocalities(profile: SovereigntyProfile): readonly DataLocality[] { return DEFAULT_LOCALITY[profile]; }

export function rankPlacementCandidates(request: PlacementRequest, candidates: readonly PlacementCandidate[]): PlacementCandidate[] {
  const allowed = request.prefer_locality ?? allowedLocalities(request.profile);
  const localityRank = new Map(allowed.map((v,i)=>[v,i]));
  return candidates.filter(c =>
    c.company_id===request.company_id && c.trusted && c.healthy && c.capabilities.includes(request.capability) &&
    localityRank.has(c.locality) && (request.network!=='offline' || c.locality==='device' || c.locality==='edge' || c.locality==='customer_hosted') &&
    (request.allow_data_egress===true || c.locality!=='provider') && !c.battery_constrained && !c.thermal_constrained &&
    (request.required_data_classes??[]).every(d=>(c.data_classes??[]).includes(d))
  ).sort((a,b)=>(localityRank.get(a.locality)!-localityRank.get(b.locality)!) || ((a.cost_rank??0)-(b.cost_rank??0)) || ((a.latency_ms??Number.MAX_SAFE_INTEGER)-(b.latency_ms??Number.MAX_SAFE_INTEGER)) || a.target_id.localeCompare(b.target_id));
}

export function placementFailure(company_id:string, reason='no-sovereign-placement'): DistributedFailure {
  return {company_id,code:'NO_SOVEREIGN_PLACEMENT',disposition:'deny',authority_may_increase:false,reason};
}
