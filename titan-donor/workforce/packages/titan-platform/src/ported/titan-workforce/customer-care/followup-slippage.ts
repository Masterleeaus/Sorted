// Hardened convergence from ResQAI issue #723.
// Deterministic, authority-neutral assessment only. Titan CRM/customer-care records remain authoritative.

const LEGACY_COMPANY_KEYS = new Set([
  'tenant_id','tenantId','tenant_company_id','tenant_company','tenant','tenantCompanyId',
  'organisation_id','organization_id','workspace_tenant_id','account_id'
]);
const OPEN_STATUSES = new Set(['pending','in_progress']);
const PRIORITY_WEIGHT: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };
const clean = (value: unknown, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function requireCompany(value: unknown) {
  const company_id = clean(value, 128);
  if (!company_id) throw new TypeError('company_id is required');
  return company_id;
}
function rejectLegacy(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach((item, i) => rejectLegacy(item, `${path}[${i}]`)); return; }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (LEGACY_COMPANY_KEYS.has(key)) throw new Error(`legacy-company-boundary:${path}.${key}`);
    rejectLegacy(child, `${path}.${key}`);
  }
}
function dateOnly(value: unknown, field: string) {
  const raw = clean(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) throw new TypeError(`${field} must be an ISO date`);
  const parsed = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${field} must be an ISO date`);
  return parsed;
}
function daysBetween(today: Date, due: Date) { return Math.floor((today.getTime() - due.getTime()) / 86400000); }
function classify(days_overdue: number, priority: string) {
  if (days_overdue > 0) {
    if (days_overdue >= 14) return { bucket: 'OVERDUE', severity: 'CRITICAL' };
    if (days_overdue >= 7 || priority === 'urgent' || priority === 'high') return { bucket: 'OVERDUE', severity: 'HIGH' };
    if (days_overdue >= 3) return { bucket: 'OVERDUE', severity: 'MEDIUM' };
    return { bucket: 'OVERDUE', severity: 'LOW' };
  }
  if (days_overdue === 0) return { bucket: 'DUE_TODAY', severity: priority === 'urgent' || priority === 'high' ? 'MEDIUM' : 'LOW' };
  return { bucket: 'DUE_SOON', severity: 'LOW' };
}
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const bucketRank: Record<string, number> = { OVERDUE: 0, DUE_TODAY: 1, DUE_SOON: 2 };

export const FOLLOWUP_SLIPPAGE_CONTRACT = Object.freeze({
  schema: 'titan.workforce.customer-care.followup-slippage-contract.v1',
  company_boundary: 'company_id',
  source_authority: 'Titan CRM',
  assessment_only: true,
  automatic_contact: false,
  automatic_task_creation: false,
  automatic_crm_mutation: false,
  grants_authority: false
});

export function assessFollowupSlippage(input: any = {}) {
  rejectLegacy(input);
  const company_id = requireCompany(input.company_id);
  const today = dateOnly(input.today, 'today');
  const days_ahead = Math.max(0, Math.min(90, Number.isFinite(Number(input.days_ahead)) ? Math.floor(Number(input.days_ahead)) : 7));
  const followups = Array.isArray(input.followups) ? input.followups : [];
  const assessed: any[] = [];
  let excluded_outside_window = 0;
  let excluded_closed = 0;

  for (const row of followups) {
    if (!row || typeof row !== 'object') continue;
    const rowCompany = requireCompany(row.company_id);
    if (rowCompany !== company_id) throw new Error('cross-company followup evidence rejected');
    const status = clean(row.status, 40).toLowerCase();
    if (!OPEN_STATUSES.has(status)) { excluded_closed++; continue; }
    const due = dateOnly(row.due_date, 'followup.due_date');
    const days_overdue = daysBetween(today, due);
    if (days_overdue < -days_ahead) { excluded_outside_window++; continue; }
    const priority = clean(row.priority || 'normal', 40).toLowerCase();
    const classification = classify(days_overdue, priority);
    assessed.push(Object.freeze({
      followup_id: clean(row.followup_id || row.id, 180),
      company_id,
      customer_id: clean(row.customer_id, 180) || null,
      subject: clean(row.subject, 320) || null,
      status,
      priority,
      due_date: due.toISOString().slice(0, 10),
      days_overdue,
      bucket: classification.bucket,
      severity: classification.severity,
      owner_ref: clean(row.owner_ref || row.owner, 180) || null,
      related_job_id: clean(row.related_job_id || row.job_id, 180) || null,
      related_quote_id: clean(row.related_quote_id || row.quote_id, 180) || null,
      source_verified: row.source_verified === true
    }));
  }

  assessed.sort((a,b) =>
    bucketRank[a.bucket] - bucketRank[b.bucket] ||
    severityRank[a.severity] - severityRank[b.severity] ||
    b.days_overdue - a.days_overdue ||
    (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0) ||
    a.due_date.localeCompare(b.due_date) ||
    String(a.followup_id).localeCompare(String(b.followup_id))
  );

  const counts = { total_scanned: followups.length, slipping: assessed.length, overdue: 0, due_today: 0, due_soon: 0, excluded_closed, excluded_outside_window };
  for (const item of assessed) {
    if (item.bucket === 'OVERDUE') counts.overdue++;
    else if (item.bucket === 'DUE_TODAY') counts.due_today++;
    else counts.due_soon++;
  }

  return Object.freeze({
    schema: 'titan.workforce.customer-care.followup-slippage-assessment.v1',
    company_id,
    today: today.toISOString().slice(0,10),
    window: Object.freeze({ days_ahead }),
    counts: Object.freeze(counts),
    items: Object.freeze(assessed),
    next_step: assessed.length ? 'PROPOSE_FOLLOWUP_REVIEW' : 'NO_ACTION',
    requires_verified_source_before_effect: true,
    assessment_only: true,
    automatic_contact: false,
    automatic_task_creation: false,
    automatic_crm_mutation: false,
    execution_permitted: false,
    authority_granted: false,
    grants_authority: false
  });
}
