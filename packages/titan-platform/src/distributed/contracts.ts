export type TitanSurface = 'zero' | 'go' | 'hub';
export type DataLocality = 'device' | 'edge' | 'customer_hosted' | 'provider' | 'titan_managed';
export type StorageRole = 'canonical' | 'replica' | 'authorised_projection' | 'cache' | 'evidence' | 'backup' | 'archive';
export type FailureDisposition = 'deny' | 'queue_for_recheck' | 'fallback' | 'degrade' | 'retry';

export interface CompanyBound { company_id: string }
export interface DistributedNodeRef extends CompanyBound {
  node_id: string;
  node_kind: 'phone'|'tablet'|'pwa'|'browser_extension'|'desktop'|'computer'|'nas'|'raspberry_pi'|'vps'|'cloud'|'titan_managed'|'future_hardware';
  locality: DataLocality;
  capabilities: readonly string[];
  trust_ref?: string;
  authority_granted: false;
}
export interface StoragePlacement extends CompanyBound {
  storage_id: string;
  role: StorageRole;
  provider: string;
  locality: DataLocality;
  data_classes: readonly string[];
  canonical_owner_ref?: string;
}
export interface IntelligencePlacement extends CompanyBound {
  request_id: string;
  capability: string;
  locality: DataLocality;
  provider?: string;
  model?: string;
  data_egress: 'none'|'minimised'|'authorised';
  cost_class: 'device'|'customer'|'entitled_titan'|'metered_titan';
  authority_granted: false;
}
export interface ExecutionReceipt extends CompanyBound {
  receipt_id: string;
  capability: string;
  node_id?: string;
  storage_id?: string;
  provider?: string;
  model?: string;
  locality: DataLocality;
  data_egress: 'none'|'minimised'|'authorised';
  authority_effect: false;
  created_at: string;
}
export interface DistributedFailure extends CompanyBound {
  code: string;
  disposition: FailureDisposition;
  authority_may_increase: false;
  reason: string;
}
