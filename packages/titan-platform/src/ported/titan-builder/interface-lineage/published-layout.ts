// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-builder/interface-lineage/published-layout.mjs
import { createHash } from 'node:crypto';
export function makeImmutablePublishedLayout({company_id,screen_key,runtime_owner,spec,source_fingerprint}) {
  if (!company_id) throw new Error('company_id-required');
  const snapshot=JSON.parse(JSON.stringify({company_id,screen_key,runtime_owner,spec,source_fingerprint}));
  const checksum=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  return Object.freeze({...snapshot, checksum, mutable:false, authority_granted:false});
}

export function canValidateForward(snapshot,currentContract,validator) {
  const result=validator(snapshot,currentContract,snapshot.company_id);
  return result.accepted ? {status:'validated-forward', current_fingerprint:result.validated_fingerprint, source_fingerprint:snapshot.source_fingerprint} : {status:'rejected',reason:result.reason};
}
