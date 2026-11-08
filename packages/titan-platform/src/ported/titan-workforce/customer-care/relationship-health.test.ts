import { describe, expect, it } from 'vitest';
import { assessRelationshipHealth } from './relationship-health';

describe('relationship health assessment',()=>{
 it('explains deterioration without mutating or granting authority',()=>{
  const r=assessRelationshipHealth({company_id:'c1',today:'2026-09-22',lookback_days:120,evidence:{company_id:'c1',customer_id:'u1',last_contact_at:'2025-12-01',last_service_at:'2025-10-01',lifetime_jobs:4,open_followups:5,overdue_followups:4,unresolved_customer_care_items:1}});
  expect(r.signals.map((x:any)=>x.code)).toEqual(expect.arrayContaining(['STALE_CONTACT','STALE_SERVICE','FOLLOWUP_SLIPPAGE','UNRESOLVED_CUSTOMER_CARE']));
  expect(['SLIPPING','CRITICAL']).toContain(r.health_band);
  expect(r.writes_health_state).toBe(false); expect(r.execution_permitted).toBe(false); expect(r.automatic_contact).toBe(false);
 });
 it('keeps healthy verified relationships healthy',()=>{
  const r=assessRelationshipHealth({company_id:'c1',today:'2026-09-22',evidence:{company_id:'c1',customer_id:'u1',last_contact_at:'2026-09-20',last_service_at:'2026-09-10',lifetime_jobs:8}});
  expect(r.health_band).toBe('HEALTHY'); expect(r.score).toBe(1); expect(r.signals).toHaveLength(0);
 });
 it('rejects cross-company evidence',()=>expect(()=>assessRelationshipHealth({company_id:'c1',today:'2026-09-22',evidence:{company_id:'c2'}})).toThrow(/cross-company/));
 it('rejects legacy tenant boundaries',()=>expect(()=>assessRelationshipHealth({company_id:'c1',tenant_id:'old',today:'2026-09-22'})).toThrow(/legacy-company-boundary/));
 it('uses canonical customer-care evidence rather than donor dispute state',()=>{
  const r=assessRelationshipHealth({company_id:'c1',today:'2026-09-22',evidence:{company_id:'c1',last_contact_at:'2026-09-20',last_service_at:'2026-09-10',lifetime_jobs:5,unresolved_customer_care_items:1,critical_customer_care_items:1}});
  expect(r.signals.map((x:any)=>x.code)).toEqual(expect.arrayContaining(['UNRESOLVED_CUSTOMER_CARE','CRITICAL_CUSTOMER_CARE']));
  expect(r.next_step).toBe('PROPOSE_HUMAN_REVIEW');
 });
});
