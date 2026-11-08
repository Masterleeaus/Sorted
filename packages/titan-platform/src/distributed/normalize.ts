import type { TitanSurface } from './contracts.js';
const LEGACY_COMPANY_KEYS = new Set(['tenant_id','tenant_company_id','tenant_company','tenant','tenantCompanyId','organisation_id','organization_id','workspace_tenant_id']);
const SURFACES: Record<string,TitanSurface> = {zero:'zero',bos:'zero',command:'zero',owner:'zero',manager:'zero',business:'zero',go:'go',field:'go',worker:'go',hub:'hub',customer:'hub'};
export function assertDistributedCompanyBoundary(value: unknown, path='input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) return value.forEach((v,i)=>assertDistributedCompanyBoundary(v,`${path}[${i}]`));
  for (const [k,v] of Object.entries(value as Record<string,unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(k)) throw new Error(`legacy-company-boundary:${path}.${k}`);
    assertDistributedCompanyBoundary(v,`${path}.${k}`);
  }
}
export function requireCompanyId(input: {company_id?: string}, expected?: string): string {
  assertDistributedCompanyBoundary(input);
  const supplied=String(input.company_id??'').trim(); const required=String(expected??'').trim();
  if (!supplied && !required) throw new Error('company_id-required');
  if (supplied && required && supplied!==required) throw new Error('cross-company-distributed-contract');
  return supplied||required;
}
export function normalizeTitanSurface(value: unknown): TitanSurface {
  const key=String(value??'').trim().toLowerCase(); const surface=SURFACES[key];
  if (!surface) throw new Error('unsupported-titan-surface'); return surface;
}
