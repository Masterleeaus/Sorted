// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/recovery-journal.mjs
const clean = value => String(value ?? '').trim();
const arr = value => Array.isArray(value) ? value : [];
const TERMINAL = new Set(['completed','failed','cancelled','aborted','superseded']);
export function assessRecoveryJournal({company_id,entries=[],now=Date.now(),stale_after_ms=300000}={}){
  const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
  const staleAfter=Math.max(0,Number(stale_after_ms)||0); const currentTime=Number(now);
  const preserve=[], quarantine=[], terminal=[];
  for(const entry of arr(entries)){
    const entryCompany=clean(entry?.company_id); if(entryCompany && entryCompany!==companyId) throw new Error(`cross-company:recovery-journal:${clean(entry?.operation_id)||'unknown'}`);
    const id=clean(entry?.operation_id||entry?.id); if(!id) continue;
    const state=clean(entry?.state).toLowerCase();
    if(TERMINAL.has(state)){ terminal.push(id); continue; }
    const updatedAt=Number(entry?.updated_at); const stale=Number.isFinite(updatedAt) ? Math.max(0,currentTime-updatedAt)>staleAfter : true;
    const cls=clean(entry?.operation_class||entry?.class).toLowerCase();
    if(state==='queued' && entry?.idempotent===true && cls==='durable_write' && !stale){ preserve.push(id); continue; }
    quarantine.push(id);
  }
  return Object.freeze({
    schema:'titan.reliability.recovery-journal-assessment.v1',company_id:companyId,company_boundary:'company_id',generated_at:currentTime,stale_after_ms:staleAfter,
    preserve_queued_ids:Object.freeze(preserve.sort()),quarantine_ids:Object.freeze(quarantine.sort()),terminal_ids:Object.freeze(terminal.sort()),
    auto_replay:false,requires_explicit_recovery_execution:true,authority_neutral:true,grants_authority:false,changes_permissions:false,changes_autonomy:false,authority_effect:false,
  });
}
