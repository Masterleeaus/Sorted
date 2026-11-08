// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/rewindable-decision-history.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { DECISION_PACKET_DOMAINS, DECISION_PACKET_FIELDS } from './decision-packet.js';
import { canonicalCorrelationJson, stableCorrelationHash } from './correlation-layer.js';
import { reconcileDecisionPacketProjections, projectionStateMap } from './packet-dedup-supersession.js';

export const REWINDABLE_DECISION_HISTORY_VERSION = '1.0.0';
export const DECISION_RECOVERY_DISPOSITIONS = Object.freeze(['reverse','compensate','recompute','blocked','remain_intact']);

const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
const requiredText=(value,code)=>{if(typeof value!=='string'||!value.trim())throw new Error(code);return value.trim();};
const freezeClone=value=>Object.freeze(clone(value));

function assertPacket(packet, companyId) {
  if(!isObject(packet)) throw new Error('invalid_decision_packet_request');
  const keys=Object.keys(packet);
  if(DECISION_PACKET_FIELDS.some(key=>!own(packet,key))) throw new Error('missing_decision_packet_fields');
  if(keys.some(key=>!DECISION_PACKET_FIELDS.includes(key))) throw new Error('unexpected_decision_packet_fields');
  if(requiredText(packet.company_id,'company_id_required')!==companyId) throw new Error('company_mismatch');
  if(!DECISION_PACKET_DOMAINS.includes(packet.domain)) throw new Error('invalid_decision_domain');
  requiredText(packet.packet_id,'packet_id_required');
  requiredText(packet.source_provider,'source_provider_required');
  if(packet.source_revision==null) throw new Error('source_revision_required');
  if(!Number.isFinite(Date.parse(packet.generated_at))) throw new Error('invalid_generated_at');
  return packet;
}

function normalizeCorrelation(correlation, packet, companyId) {
  if(correlation==null) return null;
  if(!isObject(correlation)||!Array.isArray(correlation.refs)) throw new Error('invalid_decision_correlation');
  if(requiredText(correlation.company_id,'correlation_company_id_required')!==companyId) throw new Error('company_mismatch');
  if(requiredText(correlation.packet_id,'correlation_packet_id_required')!==packet.packet_id) throw new Error('correlation_packet_mismatch');
  if(correlation.domain!==packet.domain) throw new Error('correlation_domain_mismatch');
  if(correlation.projection_only!==true) throw new Error('correlation_must_be_projection_only');
  return correlation;
}

function chronologySort(a,b) {
  return Date.parse(a.packet.generated_at)-Date.parse(b.packet.generated_at) ||
    canonicalCorrelationJson(a.packet.source_revision).localeCompare(canonicalCorrelationJson(b.packet.source_revision)) ||
    a.packet.packet_id.localeCompare(b.packet.packet_id);
}

function entryMaterial(entry) {
  return {
    sequence:entry.sequence,
    company_id:entry.company_id,
    packet:entry.packet,
    correlation:entry.correlation,
    lineage_key:entry.lineage_key,
    material_fingerprint:entry.material_fingerprint,
    projection_state:entry.projection_state,
    source_authority:entry.source_authority,
    previous_entry_hash:entry.previous_entry_hash
  };
}

function makeEntryHash(entry) {
  return `dhh_${stableCorrelationHash(entryMaterial(entry))}`;
}

function sourceAuthority(packet) {
  return Object.freeze({
    domain:packet.domain,
    source_provider:packet.source_provider,
    source_revision:freezeClone(packet.source_revision),
    authority_preserved:true,
    decision_layer_authority_owned:false,
    recovery_mutation_authority_owned:false
  });
}

/**
 * Build an inspectable, append-only-style read model over DecisionPacket projection history.
 * This history never replaces source/domain history and never grants recovery authority.
 */
export function buildRewindableDecisionHistory(items, expectedCompanyId, options={}, now=Date.now()) {
  const companyId=requiredText(expectedCompanyId,'expected_company_id_required');
  if(!Array.isArray(items)) throw new Error('decision_history_items_array_required');
  const nowMs=Number(now);
  if(!Number.isFinite(nowMs)) throw new Error('invalid_now');
  const normalized=[];
  const ids=new Set();
  for(const raw of items) {
    const item=isObject(raw)&&own(raw,'packet')?raw:{packet:raw,correlation:null};
    const packet=assertPacket(item.packet,companyId);
    if(ids.has(packet.packet_id)) throw new Error('duplicate_packet_id');
    ids.add(packet.packet_id);
    normalized.push({packet,correlation:normalizeCorrelation(item.correlation,packet,companyId)});
  }
  const reconciliation=reconcileDecisionPacketProjections(normalized,companyId,nowMs);
  const states=projectionStateMap(reconciliation);
  normalized.sort(chronologySort);
  const entries=[];
  let previousHash=null;
  for(let index=0; index<normalized.length; index+=1) {
    const item=normalized[index];
    const state=states.get(item.packet.packet_id);
    if(!state) throw new Error('projection_state_missing');
    const draft={
      sequence:index+1,
      company_id:companyId,
      packet:clone(item.packet),
      correlation:clone(item.correlation),
      lineage_key:state.lineage_key,
      material_fingerprint:state.material_fingerprint,
      projection_state:clone(state),
      source_authority:sourceAuthority(item.packet),
      previous_entry_hash:previousHash,
      entry_hash:null,
      projection_only:true,
      read_only:true
    };
    draft.entry_hash=makeEntryHash(draft);
    previousHash=draft.entry_hash;
    entries.push(Object.freeze(draft));
  }
  const historyId=`dh_${stableCorrelationHash({company_id:companyId,entries:entries.map(e=>e.entry_hash)})}`;
  return Object.freeze({
    history_version:REWINDABLE_DECISION_HISTORY_VERSION,
    history_id:historyId,
    company_id:companyId,
    generated_at:new Date(nowMs).toISOString(),
    integrity_scheme:'canonical-json-fnv1a64-projection-integrity-not-signature',
    entry_count:entries.length,
    entries:Object.freeze(entries),
    lineages:reconciliation.lineages,
    head_hash:entries.length?entries[entries.length-1].entry_hash:null,
    source_authority_preserved:true,
    recovery_execution_authority_owned:false,
    projection_only:true,
    read_only:true
  });
}

export function verifyDecisionHistoryIntegrity(history, expectedCompanyId) {
  const companyId=requiredText(expectedCompanyId,'expected_company_id_required');
  if(!isObject(history)||history.company_id!==companyId||!Array.isArray(history.entries)) return Object.freeze({valid:false,reason:'invalid_history'});
  let previous=null;
  for(let index=0; index<history.entries.length; index+=1) {
    const entry=history.entries[index];
    try { assertPacket(entry.packet,companyId); } catch { return Object.freeze({valid:false,reason:'invalid_packet',sequence:index+1}); }
    if(entry.sequence!==index+1) return Object.freeze({valid:false,reason:'invalid_sequence',sequence:index+1});
    if(entry.previous_entry_hash!==previous) return Object.freeze({valid:false,reason:'chain_break',sequence:index+1});
    const expected=makeEntryHash(entry);
    if(entry.entry_hash!==expected) return Object.freeze({valid:false,reason:'hash_mismatch',sequence:index+1});
    previous=entry.entry_hash;
  }
  if((history.head_hash||null)!==previous) return Object.freeze({valid:false,reason:'head_hash_mismatch'});
  return Object.freeze({valid:true,reason:null,entry_count:history.entries.length,head_hash:previous});
}

export function inspectDecisionHistory(history, packetId) {
  if(!isObject(history)||!Array.isArray(history.entries)) throw new Error('invalid_decision_history');
  const id=requiredText(packetId,'packet_id_required');
  const entry=history.entries.find(item=>item.packet?.packet_id===id);
  if(!entry) throw new Error('history_packet_not_found');
  const lineage=history.entries.filter(item=>item.lineage_key===entry.lineage_key).sort((a,b)=>a.sequence-b.sequence);
  const current=[...lineage].reverse().find(item=>item.projection_state?.state==='active') || lineage[lineage.length-1] || null;
  return Object.freeze({
    history_id:history.history_id,
    company_id:history.company_id,
    entry:freezeClone(entry),
    lineage:Object.freeze(lineage.map(freezeClone)),
    current_packet_id:current?.packet?.packet_id||null,
    source_authority_preserved:true,
    projection_only:true,
    read_only:true
  });
}

function normalizeRequestedDisposition(value) {
  const requested=value==null?'recompute':String(value).trim().toLowerCase();
  if(!DECISION_RECOVERY_DISPOSITIONS.includes(requested)) throw new Error('invalid_recovery_disposition');
  return requested;
}

function chooseDisposition(requested, context) {
  if(context.irreversible===true || context.provider_reversibility==='irreversible') return 'blocked';
  if(requested==='remain_intact'||requested==='blocked') return requested;
  if(context.current_state_verified!==true) return 'recompute';
  if(requested==='reverse' && context.provider_reversibility!=='reversible') return 'recompute';
  if(requested==='compensate' && !['compensatable','reversible'].includes(context.provider_reversibility)) return 'recompute';
  return requested;
}

/** Prepare only. Recovery execution remains with the source provider / governed Command Bus path. */
export function prepareDecisionRecoveryProposal(history, packetId, expectedCompanyId, context={}, now=Date.now()) {
  const companyId=requiredText(expectedCompanyId,'expected_company_id_required');
  if(!isObject(history)||history.company_id!==companyId) throw new Error('company_mismatch');
  const currentMs=Number(now); if(!Number.isFinite(currentMs)) throw new Error('invalid_now');
  const inspection=inspectDecisionHistory(history,packetId);
  const target=inspection.entry;
  const requested=normalizeRequestedDisposition(context.requested_disposition);
  const disposition=chooseDisposition(requested,context);
  const reasons=[];
  if(context.current_state_verified!==true) reasons.push('current_authoritative_state_reconciliation_required');
  if(requested==='reverse'&&disposition!=='reverse') reasons.push('blind_reverse_not_permitted');
  if(requested==='compensate'&&disposition!=='compensate') reasons.push('compensation_capability_not_verified');
  if(disposition==='blocked') reasons.push('recovery_blocked_by_irreversibility_or_policy');
  if(target.projection_state?.state==='superseded') reasons.push('target_projection_superseded');
  if(target.projection_state?.state==='stale') reasons.push('target_projection_stale');
  if(!reasons.length) reasons.push('recovery_preview_only');
  const proposalId=`drp_${stableCorrelationHash({company_id:companyId,target_packet_id:packetId,requested,disposition,source_provider:target.packet.source_provider,source_revision:target.packet.source_revision,current_packet_id:inspection.current_packet_id})}`;
  return Object.freeze({
    recovery_proposal_id:proposalId,
    company_id:companyId,
    target_packet_id:packetId,
    current_packet_id:inspection.current_packet_id,
    lineage_key:target.lineage_key,
    domain:target.packet.domain,
    source_provider:target.packet.source_provider,
    source_revision:freezeClone(target.packet.source_revision),
    requested_disposition:requested,
    disposition,
    reason_codes:Object.freeze(reasons),
    requires_current_state_reconciliation:true,
    requires_fresh_authority:true,
    requires_governance:true,
    requires_command_bus_for_consequential_mutation:true,
    automatic_recovery:false,
    execution_permitted:false,
    authority_granted:false,
    source_authority_preserved:true,
    decision_layer_authority_owned:false,
    created_at:new Date(currentMs).toISOString(),
    projection_only:true,
    read_only:true
  });
}

async function trustedCompanyId() {
  const storage=await chrome.storage.local.get(['currentCompanyId']);
  return storage.currentCompanyId||null;
}

if(typeof chrome!=='undefined'&&chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(!['TITAN_REWINDABLE_DECISION_HISTORY_BUILD','TITAN_REWINDABLE_DECISION_HISTORY_INSPECT','TITAN_DECISION_RECOVERY_PREVIEW'].includes(message?.type)) return undefined;
    (async()=>{
      try {
        const companyId=await trustedCompanyId(); if(!companyId) throw new Error('company_context_required');
        if(message.type==='TITAN_REWINDABLE_DECISION_HISTORY_BUILD') {
          sendResponse({success:true,data:buildRewindableDecisionHistory(message.items||[],companyId,message.options||{},message.now_ms??Date.now())});
        } else if(message.type==='TITAN_REWINDABLE_DECISION_HISTORY_INSPECT') {
          if(message.history?.company_id!==companyId) throw new Error('company_mismatch');
          sendResponse({success:true,data:inspectDecisionHistory(message.history,message.packet_id)});
        } else {
          sendResponse({success:true,data:prepareDecisionRecoveryProposal(message.history,message.packet_id,companyId,message.context||{},message.now_ms??Date.now())});
        }
      } catch(error) { sendResponse({success:false,error:error instanceof Error?error.message:String(error)}); }
    })();
    return true;
  });
}
