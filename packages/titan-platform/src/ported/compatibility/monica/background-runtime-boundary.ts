// @ts-nocheck
// Ported from Titan Zero extension (portable-core): compatibility/monica/background-runtime-boundary.mjs
/**
 * Titan Zero compatibility background boundary.
 *
 * Legacy chat compatibility remains loaded for retained compatibility only.
 * This module is the single active background import boundary for those
 * engines; it does not grant company, execution, module, worker or AI authority.
 */
import '../../titan-zero-chat-background.compat.js';

const loaded_at=Date.now();
const protocol='titan.compatibility.background.v1';

const snapshot=()=>Object.freeze({
  protocol:'titan.compatibility.background.v1',
  company_boundary:'company_id',
  compatibility_not_authority:true,
  grants_authority:false,
  authority_effect:false,
  direct_mutation_authority:false,
  legacy_runtime_count:1,
  loaded_at,
});

const boundary=Object.freeze({
  protocol:'titan.compatibility.background.v1',
  snapshot,
  company_boundary:'company_id',
  compatibility_not_authority:true,
  grants_authority:false,
  authority_effect:false,
  direct_mutation_authority:false,
});

globalThis.__TITAN_COMPATIBILITY_BACKGROUND__=boundary;
