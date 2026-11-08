// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/authority/index.mjs
export {
  AUTHORITY_LEASE_STATES,
  normalizeAuthorityDecisionProvenance, buildAuthorityDecisionProvenanceSeal, assertAuthorityDecisionProvenanceContinuity, assertAuthorityDecisionProvenanceHistory,
  evaluateAuthorityDecisionLease,
} from './authority-lease.js';
export {
  COMPANY_ID_FIELD, LEGACY_COMPANY_FIELDS,
  assertAuthorityCompanyId, rejectLegacyAuthorityBoundaryDeep,
} from './company-boundary.js';
export {
  LEGACY_AUTONOMY_LEVELS, LEGACY_RISK_LEVELS,
  createWorkerIdentity, createAuthorityRequirement, createApprovalState,
} from './worker-authority.js';

export const RUNTIME_ID = 'authority';
export const RUNTIME_NAME = 'Authority Runtime';
export const RUNTIME_KIND = 'authority';
export const RUNTIME_PURPOSE = 'Enforces company-scoped worker authority boundaries; identity and activation never grant authority.';
export const AUTHORITY_CONFERRED_BY_ACTIVATION = false;
export const runtimeDescriptor = Object.freeze({
  id:RUNTIME_ID, name:RUNTIME_NAME, kind:RUNTIME_KIND, purpose:RUNTIME_PURPOSE,
  authority_conferred_by_activation:false,
});
export {
  AUTONOMY_BANDS, bandForScore,
  normalizeVerifiedAutonomySnapshot, computeContractionOnlyAuthority,
} from './autonomy.js';
export { isProtectedAction } from './protected-actions.js';
export {
  AUTHORITY_DECISIONS, RISK_LEVELS,
  evaluateWorkerAuthorityDecision, assertAuthorityDecisionAllowsExecution, assertAuthorityDecisionSupersessionContinuity, assertAuthorityDecisionSupersessionGraph, buildAuthorityDecisionSupersessionHistorySeal, assertAuthorityDecisionSupersessionPersistenceContinuity, buildAuthorityDecisionSupersessionHistorySnapshotSeal, assertAuthorityDecisionSupersessionHistorySnapshotChain,
} from './authority-evaluator.js';
export {
  prepareGovernedCommandEnvelope, buildGovernedReplayBinding, buildExecutionContextBinding, assertCommandProofCurrent, assertCurrentExecutionContextBinding, assertCommandAuthorityCurrentAt,
  assertAuthoritativeExecutionReceipt, assertAuthoritativeExecutionReceiptContinuity, assertAuthoritativeExecutionReceiptHistory, buildAuthoritativeExecutionReceiptHistorySeal, assertAuthoritativeExecutionReceiptPersistenceContinuity, assertExecutionReceiptForCommand,
  assertPostActionVerification, assertPostActionVerificationContinuity, assertPostActionVerificationHistory, buildPostActionVerificationHistorySeal, assertPostActionVerificationPersistenceContinuity, assertReceiptVerificationHistoryLink, buildReceiptVerificationHistoryPairSeal, buildReceiptVerificationHistorySnapshotSeal, assertReceiptVerificationHistorySnapshotChain, assertReceiptVerificationPersistenceContinuity, assertPostActionVerificationForCommand,
} from './execution-boundary.js';

export {
  MAX_AUTHORITY_DELEGATION_DEPTH, DELEGATION_EXTINCTION_REASONS,
  normalizeAuthorityDelegation, assertAuthorityDelegationContinuity, assertAuthorityDelegationAncestry, buildAuthorityDelegationHistorySeal, buildAuthorityDelegationHistorySnapshotSeal, assertAuthorityDelegationHistorySnapshotChain, assertAuthorityDelegationPersistenceContinuity, assertAuthorityDelegationDecisionStatusContinuity, evaluateDelegationExtinction, evaluateDelegationChainExtinction,
} from './delegation.js';

export { normalizeAuthorityLeaseControl, assertAuthorityLeaseControlContinuity, assertAuthorityLeaseControlHistory, buildAuthorityLeaseControlHistorySeal, buildAuthorityLeaseControlHistorySnapshotSeal, assertAuthorityLeaseControlHistorySnapshotChain, assertAuthorityCurrentDecisionSnapshotContinuity, assertAuthorityLeaseControlPersistenceContinuity, assertAuthorityLeaseControlAgainstCurrentDecision, applyAuthorityLeaseControl } from './lease-control.js';

export { buildAuthorityHistoryIntegritySeal, buildAuthorityHistorySnapshotSeal, assertAuthorityHistorySnapshotLink, assertAuthorityHistorySnapshotChain, stableAuthorityHistoryCanonical } from './history-integrity.js';
