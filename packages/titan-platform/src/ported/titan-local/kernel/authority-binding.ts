// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-local/kernel/authority-binding.mjs
export const AUTHORITY_BINDINGS = Object.freeze(['local_primary','remote_primary','mirror']);
const SET = new Set(AUTHORITY_BINDINGS);

export function normalizeAuthorityBinding(value='local_primary') {
  const binding=String(value||'local_primary').trim().toLowerCase();
  if(!SET.has(binding)) throw new Error(`Invalid authority binding: ${value}`);
  return binding;
}

export function authorityBindingSemantics(value='local_primary') {
  const binding=normalizeAuthorityBinding(value);
  if(binding==='local_primary') return Object.freeze({binding,local_writes:'authoritative',remote_writes:'reconciled_replica'});
  if(binding==='remote_primary') return Object.freeze({binding,local_writes:'provisional',remote_writes:'authoritative'});
  return Object.freeze({binding,local_writes:'forbidden',remote_writes:'projection_only'});
}
