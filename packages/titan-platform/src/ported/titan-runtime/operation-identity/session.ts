// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-runtime/operation-identity/session.mjs
import { assertOperationIdentity, createOperationIdentity } from './identity.js';
import { bindOperationStage, assertOperationContinuity } from './envelope.js';

export class OperationIdentitySession {
  constructor(identity) {
    this.identity = assertOperationIdentity(identity);
    this.stageEnvelopes = [];
  }

  static create(input, options = {}) {
    return new OperationIdentitySession(createOperationIdentity(input, options));
  }

  bind(stage, payload = {}) {
    const envelope = bindOperationStage(this.identity, stage, payload);
    assertOperationContinuity(this.identity, envelope);
    this.stageEnvelopes.push(envelope);
    return envelope;
  }

  snapshot() {
    return Object.freeze({
      identity: this.identity,
      stages: Object.freeze([...this.stageEnvelopes]),
      authority_neutral: true,
      identity_confers_authority: false,
    });
  }
}
