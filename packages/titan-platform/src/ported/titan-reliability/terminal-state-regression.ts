// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-reliability/terminal-state-regression.mjs
const clean=v=>String(v??'').trim();
const TERMINAL=new Set(['completed','failed','cancelled','canceled','aborted','rejected','expired']);
export function evaluateTerminalStateRegression({company_id,operation_id,previous_status,next_status}={}){
 const companyId=clean(company_id); if(!companyId) throw new Error('company_id-required');
 const operationId=clean(operation_id); if(!operationId) throw new Error('operation_id-required');
 const prev=clean(previous_status).toLowerCase(), next=clean(next_status).toLowerCase();
 const regression=TERMINAL.has(prev) && next && next!==prev;
 return Object.freeze({company_id:companyId,operation_id:operationId,previous_status:prev||null,next_status:next||null,regression_detected:regression,safe_to_apply:!regression,reason:regression?'terminal_state_regression':null,auto_apply:false,authority_effect:false,grants_authority:false,changes_permissions:false,changes_autonomy:false});
}
