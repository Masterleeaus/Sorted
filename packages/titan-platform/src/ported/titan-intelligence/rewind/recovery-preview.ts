// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/rewind/recovery-preview.js
export const REWIND_RECOVERY_PREVIEW_VERSION = "1.2.0";
export const REQUIRED_FIELDS = ["recovery_candidate_id","company_id","what_changed","failure_detected_at","current_revision","last_verified_revision","recoverable_revision","records_affected","downstream_effects","excluded_changes","risk","reversibility","evidence_refs","approval_required","preview_revision","preview_expires_at"];
export function isRecoveryPreview(value, expectedCompanyId, now=Date.now()) {
  if (!value || typeof value !== "object") return false;
  if (!REQUIRED_FIELDS.every(k => Object.prototype.hasOwnProperty.call(value, k))) return false;
  if (value.company_id !== expectedCompanyId) return false;
  if (value.approval_required !== true || value.preview_only !== true || value.mutations_performed !== 0) return false;
  if (!Number.isFinite(Number(value.preview_expires_at)) || Number(value.preview_expires_at) <= now) return false;
  return true;
}
export function recoveryPreviewStatus(value, expectedCompanyId, now=Date.now()) {
  if (!value || value.company_id !== expectedCompanyId) return "invalid_company";
  if (Number(value.preview_expires_at) <= now) return "expired";
  if (value.recoverable_revision === "unknown" || value.supported !== true) return "unknown";
  return "approval_required";
}
