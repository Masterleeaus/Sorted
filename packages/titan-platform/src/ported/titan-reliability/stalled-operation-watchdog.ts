// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/stalled-operation-watchdog.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];
const terminal = new Set(['completed','failed','cancelled','aborted','superseded']);

export function evaluateStalledOperations({company_id,operations=[],now=Date.now(),stall_after_ms=60_000}={}) {
  const companyId=clean(company_id);
  if (!companyId) throw new Error('company_id-required');
  const threshold=Math.max(1,Number(stall_after_ms)||60_000);
  const stalled=[];
  const blocked=[];
  for (const operation of arr(operations)) {
    const operationCompany=clean(operation?.company_id);
    if (operationCompany && operationCompany!==companyId) throw new Error('cross-company:stalled-operation');
    const status=clean(operation?.status).toLowerCase();
    if (terminal.has(status)) continue;
    const last=Number(operation?.last_progress_at);
    if (!Number.isFinite(last)) continue;
    if (Number(now)-last > threshold) {
      const id=clean(operation?.operation_id) || 'unknown';
      stalled.push(id);
      if (operation?.authority_sensitive===true) blocked.push(id);
    }
  }
  return Object.freeze({
    schema:'titan.reliability.stalled-operation-watchdog.v1',
    company_id:companyId,
    stalled_ids:Object.freeze(stalled),
    blocked_authority_ids:Object.freeze(blocked),
    safe_to_auto_resume:stalled.length===0,
    advisory_only:true,
    grants_authority:false,
    authority_effect:false,
  });
}
