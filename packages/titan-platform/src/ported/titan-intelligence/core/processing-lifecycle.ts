// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/core/processing-lifecycle.mjs
import { ZERO_KEYS, readLocal, writeLocal, updateLocal, timestamp } from './storage.js';

export const PROCESSING_STATES = Object.freeze({
  RECEIVED: 'RECEIVED',
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  APPROVED: 'APPROVED',
  AUTHORISED: 'AUTHORISED',
  FLUX: 'FLUX',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  HELD: 'HELD',
  REJECTED: 'REJECTED',
  SUPERSEDED: 'SUPERSEDED',
  CANCELLED: 'CANCELLED'
});

export const PROCESSING_ORDER = Object.freeze([
  PROCESSING_STATES.RECEIVED,
  PROCESSING_STATES.PROCESSING,
  PROCESSING_STATES.PROCESSED,
  PROCESSING_STATES.APPROVED
]);

export const SIDE_STATES = Object.freeze([
  PROCESSING_STATES.NEEDS_INFORMATION,
  PROCESSING_STATES.HELD,
  PROCESSING_STATES.REJECTED,
  PROCESSING_STATES.SUPERSEDED,
  PROCESSING_STATES.CANCELLED
]);

export const PAUSABLE_SIDE_STATES = Object.freeze([
  PROCESSING_STATES.NEEDS_INFORMATION,
  PROCESSING_STATES.HELD
]);

export const TERMINAL_SIDE_STATES = Object.freeze([
  PROCESSING_STATES.REJECTED,
  PROCESSING_STATES.SUPERSEDED,
  PROCESSING_STATES.CANCELLED
]);

export const DEFAULT_PROCESSING = Object.freeze({
  items: [],
  approved: [],
  authorised: [],
  flux: [],
  needs_information: [],
  held: [],
  rejected: [],
  superseded: [],
  cancelled: [],
  revision_resets: [],
  updatedAt: 0
});

const bounded = (items, limit) => Array.isArray(items) ? items.slice(-limit) : [];
const cleanCompany = value => value == null || value === '' ? null : String(value);
const cleanDomain = value => value == null || value === '' ? null : String(value);

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function revisionDigest(revision) {
  const input = stable(revision ?? null);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function requireIdentity(input = {}) {
  if (!input.item_id) throw new Error('processing-item-id-required');
  if (!input.revision_id) throw new Error('processing-revision-id-required');
}

function assertExactRevision(item, revision_id, revision) {
  if (String(revision_id) !== String(item.revision_id)) throw new Error('processing-revision-mismatch');
  if (revision !== undefined && revisionDigest(revision) !== item.revision_digest) throw new Error('processing-revision-content-mismatch');
}

function assertNextState(currentState, targetState) {
  const current = PROCESSING_ORDER.indexOf(currentState);
  const target = PROCESSING_ORDER.indexOf(targetState);
  if (current < 0 || target < 0) throw new Error('processing-state-invalid');
  if (target !== current + 1) throw new Error(`processing-transition-invalid:${currentState}->${targetState}`);
}

function checksForExactRevision(item, checks = []) {
  return bounded(checks, 100).map(check => ({
    ...check,
    revision_id: item.revision_id,
    revision_digest: item.revision_digest,
    checkedAt: check?.checkedAt || timestamp()
  }));
}

function allRequiredChecksPassed(checks = []) {
  const required = checks.filter(check => check?.required !== false);
  return required.length > 0 && required.every(check => check?.passed === true);
}

function requiresReceivingDomainAcceptance(item) {
  return !!item?.source_domain && !!item?.receiving_domain && item.source_domain !== item.receiving_domain;
}

function assertAcceptanceRevision(item, acceptance, prefix) {
  if (acceptance.revision_id && String(acceptance.revision_id) !== item.revision_id) throw new Error(`${prefix}-revision-mismatch`);
  if (acceptance.revision_digest && String(acceptance.revision_digest) !== item.revision_digest) throw new Error(`${prefix}-revision-digest-mismatch`);
}

export async function initialiseProcessingLifecycle() {
  const stored = await readLocal(ZERO_KEYS.processing, DEFAULT_PROCESSING);
  const next = {
    ...DEFAULT_PROCESSING,
    ...stored,
    items: bounded(stored.items, 500),
    approved: bounded(stored.approved, 500),
    authorised: bounded(stored.authorised, 500),
    flux: bounded(stored.flux, 500),
    needs_information: bounded(stored.needs_information, 500),
    held: bounded(stored.held, 500),
    rejected: bounded(stored.rejected, 500),
    superseded: bounded(stored.superseded, 500),
    cancelled: bounded(stored.cancelled, 500),
    revision_resets: bounded(stored.revision_resets, 500),
    updatedAt: stored.updatedAt || timestamp()
  };
  await writeLocal(ZERO_KEYS.processing, next);
  return next;
}

export async function getProcessingState() {
  return readLocal(ZERO_KEYS.processing, DEFAULT_PROCESSING);
}

export async function receiveForProcessing(input = {}) {
  requireIdentity(input);
  const now = timestamp();
  const digest = revisionDigest(input.revision);
  return updateLocal(ZERO_KEYS.processing, DEFAULT_PROCESSING, current => {
    const items = [...(current.items || [])];
    const existing = items.find(item => item.item_id === String(input.item_id));
    if ([PROCESSING_STATES.APPROVED, PROCESSING_STATES.AUTHORISED, PROCESSING_STATES.FLUX, ...SIDE_STATES].includes(existing?.state) && existing.revision_id === String(input.revision_id) && existing.revision_digest === digest) return current;
    if (existing && existing.revision_id === String(input.revision_id) && existing.revision_digest !== digest) throw new Error('processing-revision-id-reused-with-different-content');
    if (existing?.company_id && cleanCompany(input.company_id) && existing.company_id !== cleanCompany(input.company_id)) throw new Error('processing-company-boundary-mismatch');

    const changedRevision = !!existing && (existing.revision_id !== String(input.revision_id) || existing.revision_digest !== digest);
    const approvedAuthorityState = existing && [PROCESSING_STATES.APPROVED, PROCESSING_STATES.AUTHORISED].includes(existing.state);
    if (approvedAuthorityState && changedRevision) {
      if (input.material_change === false) throw new Error('processing-approved-revision-change-must-be-reprocessed');
      const resetReason = String(input.material_change_reason || 'material-revision-changed');
      const resetBy = String(input.changed_by || 'TITAN_ZERO');
      const reset = {
        item_id: existing.item_id,
        company_id: existing.company_id ?? cleanCompany(input.company_id),
        subject: input.subject ?? existing.subject ?? null,
        revision_id: String(input.revision_id),
        revision_digest: digest,
        revision: structuredClone(input.revision ?? null),
        state: PROCESSING_STATES.PROCESSING,
        intelligence_checks: [],
        requires_authorisation: input.requires_authorisation == null ? existing.requires_authorisation === true : input.requires_authorisation === true,
        risk_level: input.risk_level == null ? existing.risk_level ?? null : String(input.risk_level),
        source_domain: input.source_domain == null ? existing.source_domain ?? null : cleanDomain(input.source_domain),
        receiving_domain: input.receiving_domain == null ? existing.receiving_domain ?? null : cleanDomain(input.receiving_domain),
        history: bounded([...(existing.history || []), {
          state: PROCESSING_STATES.PROCESSING,
          event: 'MATERIAL_REVISION_RESET',
          prior_state: existing.state,
          prior_revision_id: existing.revision_id,
          prior_revision_digest: existing.revision_digest,
          revision_id: String(input.revision_id),
          revision_digest: digest,
          reason: resetReason,
          changed_by: resetBy,
          at: now
        }], 100),
        receivedAt: existing.receivedAt || now,
        processingStartedAt: now,
        updatedAt: now,
        material_revision_reset: true,
        previous_revision_id: existing.revision_id,
        previous_revision_digest: existing.revision_digest,
        previous_authority_state: existing.state,
        titan_compliant: false,
        authority_suspended: false,
        propagation_blocked: false,
        operational_final: false,
        approvedAt: null,
        approved_revision_id: null,
        approved_revision_digest: null,
        authorisedAt: null,
        authorised_revision_id: null,
        authorised_revision_digest: null,
        authorised_by: null,
        authorisation_reason: null,
        source_domain_processing: null,
        receiving_domain_acceptance: null,
        receiving_domain_accepted_by: null
      };
      const withoutPrior = items.filter(candidate => candidate.item_id !== reset.item_id);
      const resetRecord = {
        item_id: reset.item_id,
        company_id: reset.company_id,
        prior_state: existing.state,
        prior_revision_id: existing.revision_id,
        prior_revision_digest: existing.revision_digest,
        revision_id: reset.revision_id,
        revision_digest: reset.revision_digest,
        reason: resetReason,
        changed_by: resetBy,
        resetAt: now
      };
      return {
        ...current,
        items: bounded([...withoutPrior, reset], 500),
        approved: (current.approved || []).filter(candidate => candidate.item_id !== reset.item_id),
        authorised: (current.authorised || []).filter(candidate => candidate.item_id !== reset.item_id),
        revision_resets: bounded([...(current.revision_resets || []), resetRecord], 500),
        updatedAt: now
      };
    }
    const item = {
      item_id: String(input.item_id),
      company_id: cleanCompany(input.company_id),
      subject: input.subject ?? null,
      revision_id: String(input.revision_id),
      revision_digest: digest,
      revision: structuredClone(input.revision ?? null),
      state: PROCESSING_STATES.RECEIVED,
      intelligence_checks: [],
      requires_authorisation: input.requires_authorisation === true,
      risk_level: input.risk_level == null ? null : String(input.risk_level),
      source_domain: cleanDomain(input.source_domain),
      receiving_domain: cleanDomain(input.receiving_domain),
      history: [{ state: PROCESSING_STATES.RECEIVED, revision_id: String(input.revision_id), revision_digest: digest, at: now }],
      receivedAt: now,
      updatedAt: now
    };
    const withoutPrior = items.filter(candidate => candidate.item_id !== item.item_id);
    return { ...current, items: bounded([...withoutPrior, item], 500), updatedAt: now };
  });
}

export async function transitionProcessing(input = {}) {
  requireIdentity(input);
  const target = String(input.target_state || '');
  if (![...PROCESSING_ORDER, PROCESSING_STATES.AUTHORISED, PROCESSING_STATES.FLUX, ...SIDE_STATES].includes(target)) throw new Error('processing-target-state-invalid');
  return updateLocal(ZERO_KEYS.processing, DEFAULT_PROCESSING, current => {
    const items = [...(current.items || [])];
    const index = items.findIndex(item => item.item_id === String(input.item_id));
    if (index < 0) throw new Error('processing-item-not-found');
    const item = items[index];
    assertExactRevision(item, input.revision_id, input.revision);
    const elevatedTransition = item.state === PROCESSING_STATES.APPROVED && target === PROCESSING_STATES.AUTHORISED;
    const fluxTransition = target === PROCESSING_STATES.FLUX && item.state !== PROCESSING_STATES.FLUX;
    const sideTransition = SIDE_STATES.includes(target) && !SIDE_STATES.includes(item.state);
    const sideResume = PAUSABLE_SIDE_STATES.includes(item.state) && target === item.side_prior_state && input.resume_side_state === true;
    if (item.state === PROCESSING_STATES.FLUX) throw new Error('processing-flux-state-isolated');
    if (TERMINAL_SIDE_STATES.includes(item.state)) throw new Error('processing-terminal-side-state-final');
    if (PAUSABLE_SIDE_STATES.includes(item.state) && !sideResume) throw new Error('processing-side-state-paused');
    if (item.state === PROCESSING_STATES.AUTHORISED && !fluxTransition && !sideTransition) throw new Error('processing-authorised-state-final');
    if (item.state === PROCESSING_STATES.APPROVED && !elevatedTransition && !fluxTransition && !sideTransition) throw new Error('processing-approved-normal-state-final');
    if (!elevatedTransition && !fluxTransition && !sideTransition && !sideResume) assertNextState(item.state, target);

    const now = timestamp();
    const suppliedChecks = checksForExactRevision(item, input.intelligence_checks || []);
    const intelligenceChecks = suppliedChecks.length ? suppliedChecks : [...(item.intelligence_checks || [])];

    if (target === PROCESSING_STATES.PROCESSED && !allRequiredChecksPassed(intelligenceChecks)) {
      throw new Error('processing-required-intelligence-checks-not-passed');
    }
    if (target === PROCESSING_STATES.PROCESSED && requiresReceivingDomainAcceptance(item)) {
      const source = input.source_domain_processing;
      if (!source || source.processed !== true) throw new Error('processing-source-domain-seal-required');
      if (!source.processor_id) throw new Error('processing-source-domain-processor-id-required');
      if (!source.source_domain || String(source.source_domain) !== item.source_domain) throw new Error('processing-source-domain-mismatch');
      assertAcceptanceRevision(item, source, 'processing-source-domain');
    }
    if (target === PROCESSING_STATES.APPROVED && !allRequiredChecksPassed(intelligenceChecks)) {
      throw new Error('processing-approval-requires-passed-intelligence-checks');
    }
    if (target === PROCESSING_STATES.APPROVED && requiresReceivingDomainAcceptance(item)) {
      const acceptance = input.receiving_domain_acceptance;
      if (!acceptance || acceptance.accepted !== true) throw new Error('processing-approval-requires-receiving-domain-acceptance');
      if (!acceptance.receiver_id) throw new Error('processing-receiving-domain-receiver-id-required');
      if (!acceptance.receiving_domain || String(acceptance.receiving_domain) !== item.receiving_domain) throw new Error('processing-receiving-domain-mismatch');
      assertAcceptanceRevision(item, acceptance, 'processing-receiving-domain');
      if (item.source_domain_processing?.processor_id && String(acceptance.receiver_id) === String(item.source_domain_processing.processor_id)) {
        throw new Error('processing-receiving-domain-independence-required');
      }
    }
    if (target === PROCESSING_STATES.FLUX) {
      const isolation = input.flux_isolation || {};
      if (!isolation.reason) throw new Error('processing-flux-reason-required');
      if (!isolation.isolated_by) throw new Error('processing-flux-isolator-required');
    }
    if (SIDE_STATES.includes(target)) {
      const side = input.side_state || {};
      if (!side.reason) throw new Error('processing-side-state-reason-required');
      if (!side.changed_by) throw new Error('processing-side-state-actor-required');
      if (PAUSABLE_SIDE_STATES.includes(target) && ![PROCESSING_STATES.RECEIVED, PROCESSING_STATES.PROCESSING, PROCESSING_STATES.PROCESSED].includes(item.state)) {
        throw new Error('processing-pausable-side-state-preapproval-only');
      }
      if (target === PROCESSING_STATES.SUPERSEDED && !side.replacement_revision_id && !side.replacement_item_id) {
        throw new Error('processing-superseded-replacement-reference-required');
      }
    }
    if (target === PROCESSING_STATES.AUTHORISED) {
      if (item.requires_authorisation !== true) throw new Error('processing-authorisation-not-required');
      const acceptance = input.receiving_specialist_acceptance;
      if (!acceptance || acceptance.accepted !== true) throw new Error('processing-authorisation-requires-receiving-specialist-acceptance');
      if (!acceptance.specialist_id) throw new Error('processing-authorisation-specialist-id-required');
      if (!acceptance.receiving_domain) throw new Error('processing-authorisation-receiving-domain-required');
      if (item.receiving_domain && String(acceptance.receiving_domain) !== item.receiving_domain) throw new Error('processing-authorisation-receiving-domain-mismatch');
      if (acceptance.revision_id && String(acceptance.revision_id) !== item.revision_id) throw new Error('processing-authorisation-revision-mismatch');
      if (acceptance.revision_digest && String(acceptance.revision_digest) !== item.revision_digest) throw new Error('processing-authorisation-revision-digest-mismatch');
    }

    const historyEntry = { state: target, revision_id: item.revision_id, revision_digest: item.revision_digest, at: now };
    if (target === PROCESSING_STATES.FLUX) {
      const isolation = input.flux_isolation || {};
      historyEntry.prior_state = item.state;
      historyEntry.flux_isolation = {
        reason: String(isolation.reason),
        isolated_by: String(isolation.isolated_by),
        authority: isolation.authority == null ? 'TITAN_ZERO' : String(isolation.authority),
        evidence_refs: bounded(isolation.evidence_refs || [], 100).map(String)
      };
    }
    if (SIDE_STATES.includes(target)) {
      const side = input.side_state || {};
      historyEntry.prior_state = item.state;
      historyEntry.side_state = {
        reason: String(side.reason),
        changed_by: String(side.changed_by),
        evidence_refs: bounded(side.evidence_refs || [], 100).map(String),
        replacement_revision_id: side.replacement_revision_id == null ? null : String(side.replacement_revision_id),
        replacement_item_id: side.replacement_item_id == null ? null : String(side.replacement_item_id)
      };
    }
    if (sideResume) {
      historyEntry.resumed_from_side_state = item.state;
      historyEntry.resume_reason = input.resume_reason == null ? null : String(input.resume_reason);
    }
    if (target === PROCESSING_STATES.PROCESSED && requiresReceivingDomainAcceptance(item)) {
      const source = input.source_domain_processing;
      historyEntry.source_domain_processing = {
        processor_id: String(source.processor_id),
        processor_role: source.processor_role == null ? null : String(source.processor_role),
        source_domain: item.source_domain,
        processed: true
      };
    }
    if (target === PROCESSING_STATES.APPROVED && requiresReceivingDomainAcceptance(item)) {
      const acceptance = input.receiving_domain_acceptance;
      historyEntry.receiving_domain_acceptance = {
        receiver_id: String(acceptance.receiver_id),
        receiver_role: acceptance.receiver_role == null ? null : String(acceptance.receiver_role),
        receiving_domain: item.receiving_domain,
        accepted: true
      };
    }
    if (target === PROCESSING_STATES.AUTHORISED) {
      const acceptance = input.receiving_specialist_acceptance;
      historyEntry.receiving_specialist_acceptance = {
        specialist_id: String(acceptance.specialist_id),
        specialist_role: acceptance.specialist_role == null ? null : String(acceptance.specialist_role),
        receiving_domain: String(acceptance.receiving_domain),
        accepted: true
      };
    }
    const next = {
      ...item,
      state: target,
      intelligence_checks: intelligenceChecks,
      history: bounded([...(item.history || []), historyEntry], 100),
      updatedAt: now
    };
    if (target === PROCESSING_STATES.PROCESSING) next.processingStartedAt = now;
    if (target === PROCESSING_STATES.PROCESSED) {
      next.processedAt = now;
      if (requiresReceivingDomainAcceptance(item)) {
        const source = input.source_domain_processing;
        next.source_domain_processing = {
          processor_id: String(source.processor_id),
          processor_role: source.processor_role == null ? null : String(source.processor_role),
          source_domain: item.source_domain,
          revision_id: item.revision_id,
          revision_digest: item.revision_digest,
          processedAt: source.processedAt || now
        };
      }
    }
    if (target === PROCESSING_STATES.APPROVED) {
      next.approvedAt = now;
      next.approved_revision_id = item.revision_id;
      next.approved_revision_digest = item.revision_digest;
      next.titan_compliant = true;
      next.authorisation_required = item.requires_authorisation === true;
      next.operational_final = item.requires_authorisation !== true;
      if (requiresReceivingDomainAcceptance(item)) {
        const acceptance = input.receiving_domain_acceptance;
        next.receiving_domain_acceptance = {
          receiver_id: String(acceptance.receiver_id),
          receiver_role: acceptance.receiver_role == null ? null : String(acceptance.receiver_role),
          receiving_domain: item.receiving_domain,
          revision_id: item.revision_id,
          revision_digest: item.revision_digest,
          accepted: true,
          reason: acceptance.reason == null ? null : String(acceptance.reason),
          acceptedAt: acceptance.acceptedAt || now
        };
        next.receiving_domain_accepted_by = next.receiving_domain_acceptance;
      }
    }
    if (target === PROCESSING_STATES.FLUX) {
      const isolation = input.flux_isolation || {};
      next.fluxEnteredAt = now;
      next.flux_prior_state = item.state;
      next.authority_suspended = true;
      next.propagation_blocked = true;
      next.operational_final = false;
      next.flux_isolation = {
        reason: String(isolation.reason),
        isolated_by: String(isolation.isolated_by),
        authority: isolation.authority == null ? 'TITAN_ZERO' : String(isolation.authority),
        evidence_refs: bounded(isolation.evidence_refs || [], 100).map(String),
        isolatedAt: now
      };
    }
    if (SIDE_STATES.includes(target)) {
      const side = input.side_state || {};
      next.side_prior_state = item.state;
      next.side_state_entered_at = now;
      next.side_state_detail = {
        reason: String(side.reason),
        changed_by: String(side.changed_by),
        evidence_refs: bounded(side.evidence_refs || [], 100).map(String),
        replacement_revision_id: side.replacement_revision_id == null ? null : String(side.replacement_revision_id),
        replacement_item_id: side.replacement_item_id == null ? null : String(side.replacement_item_id),
        changedAt: now
      };
      next.operational_final = TERMINAL_SIDE_STATES.includes(target);
      next.authority_suspended = true;
      next.propagation_blocked = true;
      if (target === PROCESSING_STATES.REJECTED) next.rejectedAt = now;
      if (target === PROCESSING_STATES.SUPERSEDED) next.supersededAt = now;
      if (target === PROCESSING_STATES.CANCELLED) next.cancelledAt = now;
      if (target === PROCESSING_STATES.NEEDS_INFORMATION) next.needsInformationAt = now;
      if (target === PROCESSING_STATES.HELD) next.heldAt = now;
    }
    if (sideResume) {
      next.side_prior_state = null;
      next.side_state_resumed_at = now;
      next.side_state_detail = null;
      next.authority_suspended = false;
      next.propagation_blocked = false;
      next.operational_final = false;
    }
    if (target === PROCESSING_STATES.AUTHORISED) {
      const acceptance = input.receiving_specialist_acceptance;
      next.authorisedAt = now;
      next.authorised_revision_id = item.revision_id;
      next.authorised_revision_digest = item.revision_digest;
      next.authorised_by = {
        specialist_id: String(acceptance.specialist_id),
        specialist_role: acceptance.specialist_role == null ? null : String(acceptance.specialist_role),
        receiving_domain: String(acceptance.receiving_domain),
        company_id: item.company_id,
        acceptedAt: acceptance.acceptedAt || now
      };
      next.authorisation_reason = acceptance.reason == null ? null : String(acceptance.reason);
      next.titan_compliant = true;
      next.authorisation_required = true;
      next.operational_final = true;
    }
    items[index] = next;
    const approved = target === PROCESSING_STATES.APPROVED
      ? bounded([...(current.approved || []).filter(candidate => candidate.item_id !== next.item_id), {
          item_id: next.item_id,
          company_id: next.company_id,
          source_domain: next.source_domain,
          receiving_domain: next.receiving_domain,
          revision_id: next.approved_revision_id,
          revision_digest: next.approved_revision_digest,
          approvedAt: next.approvedAt,
          titan_compliant: true,
          authorisation_required: next.authorisation_required,
          operational_final: next.operational_final,
          receiving_domain_acceptance: next.receiving_domain_acceptance || null
        }], 500)
      : current.approved || [];
    const authorisedBase = current.authorised || [];
    const authorised = target === PROCESSING_STATES.AUTHORISED
      ? bounded([...authorisedBase.filter(candidate => candidate.item_id !== next.item_id), {
          item_id: next.item_id,
          company_id: next.company_id,
          revision_id: next.authorised_revision_id,
          revision_digest: next.authorised_revision_digest,
          authorisedAt: next.authorisedAt,
          authorised_by: next.authorised_by,
          titan_compliant: true,
          operational_final: true
        }], 500)
      : target === PROCESSING_STATES.FLUX || SIDE_STATES.includes(target)
        ? authorisedBase.filter(candidate => candidate.item_id !== next.item_id)
        : authorisedBase;
    const approvedFinal = target === PROCESSING_STATES.FLUX || SIDE_STATES.includes(target)
      ? approved.filter(candidate => candidate.item_id !== next.item_id)
      : approved;
    const flux = target === PROCESSING_STATES.FLUX
      ? bounded([...(current.flux || []).filter(candidate => candidate.item_id !== next.item_id), {
          item_id: next.item_id,
          company_id: next.company_id,
          revision_id: next.revision_id,
          revision_digest: next.revision_digest,
          prior_state: next.flux_prior_state,
          fluxEnteredAt: next.fluxEnteredAt,
          isolation: next.flux_isolation,
          authority_suspended: true,
          propagation_blocked: true
        }], 500)
      : current.flux || [];
    const sideProjection = (bucket, stateName) => target === stateName
      ? bounded([...(current[bucket] || []).filter(candidate => candidate.item_id !== next.item_id), {
          item_id: next.item_id,
          company_id: next.company_id,
          revision_id: next.revision_id,
          revision_digest: next.revision_digest,
          prior_state: next.side_prior_state,
          enteredAt: next.side_state_entered_at,
          detail: next.side_state_detail,
          terminal: TERMINAL_SIDE_STATES.includes(stateName)
        }], 500)
      : (current[bucket] || []).filter(candidate => sideResume ? candidate.item_id !== next.item_id : true);
    return {
      ...current,
      items,
      approved: approvedFinal,
      authorised,
      flux,
      needs_information: sideProjection('needs_information', PROCESSING_STATES.NEEDS_INFORMATION),
      held: sideProjection('held', PROCESSING_STATES.HELD),
      rejected: sideProjection('rejected', PROCESSING_STATES.REJECTED),
      superseded: sideProjection('superseded', PROCESSING_STATES.SUPERSEDED),
      cancelled: sideProjection('cancelled', PROCESSING_STATES.CANCELLED),
      updatedAt: now
    };
  });
}

export async function getProcessingItem(item_id) {
  const current = await getProcessingState();
  return (current.items || []).find(item => item.item_id === String(item_id)) || null;
}
