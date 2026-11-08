// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/financial-engine/money-action-queue.js
export const FINANCIAL_ENGINE_VERSION = "0.9.0";
export const MONEY_ACTION_STATUSES = Object.freeze(["open","acknowledged","in_progress","waiting","resolved","dismissed","superseded","expired"]);
export const MONEY_ACTION_FIELDS = Object.freeze(["action_id","company_id","metric","observation","priority","urgency","evidence","recommended_response","expected_effect","status","owner","due_at","source_revision","created_at","expires_at"]);
export const ACTIVE_MONEY_ACTION_STATUSES = Object.freeze(["open","acknowledged","in_progress","waiting"]);
export const TERMINAL_MONEY_ACTION_STATUSES = Object.freeze(["resolved","dismissed","superseded","expired"]);
export function validateMoneyAction(action, expectedCompanyId) {
  if (!action || typeof action !== "object") return {valid:false,error:"invalid_action"};
  const missing=MONEY_ACTION_FIELDS.filter(k=>!Object.prototype.hasOwnProperty.call(action,k));
  if (missing.length) return {valid:false,error:"missing_fields",missing};
  if (action.company_id!==expectedCompanyId) return {valid:false,error:"company_mismatch"};
  if (!MONEY_ACTION_STATUSES.includes(action.status)) return {valid:false,error:"invalid_status"};
  if (!Array.isArray(action.evidence)) return {valid:false,error:"evidence_must_be_array"};
  return {valid:true};
}
export function isActiveMoneyAction(action){return !!action&&ACTIVE_MONEY_ACTION_STATUSES.includes(action.status)}
export function isTerminalMoneyAction(action){return !!action&&TERMINAL_MONEY_ACTION_STATUSES.includes(action.status)}
