import { describe, expect, it } from 'vitest';
import { assessFollowupSlippage } from './followup-slippage';

describe('follow-up slippage assessment', () => {
  it('ranks overdue followups deterministically without granting authority', () => {
    const result = assessFollowupSlippage({
      company_id: 'company-a', today: '2026-09-22', days_ahead: 7,
      followups: [
        { company_id:'company-a', id:'soon', status:'pending', priority:'normal', due_date:'2026-09-25', source_verified:true },
        { company_id:'company-a', id:'critical', status:'in_progress', priority:'normal', due_date:'2026-09-01', source_verified:true },
        { company_id:'company-a', id:'high', status:'pending', priority:'high', due_date:'2026-09-21', source_verified:true }
      ]
    });
    expect(result.items.map((x:any)=>x.followup_id)).toEqual(['critical','high','soon']);
    expect(result.counts).toMatchObject({ slipping:3, overdue:2, due_soon:1 });
    expect(result.execution_permitted).toBe(false);
    expect(result.automatic_contact).toBe(false);
    expect(result.automatic_task_creation).toBe(false);
  });

  it('rejects cross-company evidence', () => {
    expect(() => assessFollowupSlippage({
      company_id:'company-a', today:'2026-09-22',
      followups:[{company_id:'company-b',id:'x',status:'pending',due_date:'2026-09-20'}]
    })).toThrow(/cross-company/);
  });

  it('rejects legacy tenant boundaries', () => {
    expect(() => assessFollowupSlippage({company_id:'company-a',tenant_id:'legacy',today:'2026-09-22'})).toThrow(/legacy-company-boundary/);
  });

  it('excludes closed and out-of-window followups', () => {
    const result=assessFollowupSlippage({company_id:'company-a',today:'2026-09-22',days_ahead:7,followups:[
      {company_id:'company-a',id:'done',status:'completed',due_date:'2026-09-20'},
      {company_id:'company-a',id:'later',status:'pending',due_date:'2026-10-20'}
    ]});
    expect(result.items).toHaveLength(0);
    expect(result.counts.excluded_closed).toBe(1);
    expect(result.counts.excluded_outside_window).toBe(1);
    expect(result.next_step).toBe('NO_ACTION');
  });
});
