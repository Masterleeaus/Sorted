// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/operation-identity/index.mjs
export {
  OPERATION_IDENTITY_SCHEMA_VERSION,
  OPERATION_STAGES,
  OPERATION_STATES,
  createOperationIdentity,
  assertOperationIdentity,
  operationIdentityKey,
  transitionOperationIdentity,
  operationStorageRecord,
  operationEventFields,
  sameOperation,
} from './identity.js';
export { bindOperationStage, assertOperationContinuity, toLedgerIdentity } from './envelope.js';
export { OperationIdentitySession } from './session.js';

export { TitanOperationIdentityStore } from './store.js';
