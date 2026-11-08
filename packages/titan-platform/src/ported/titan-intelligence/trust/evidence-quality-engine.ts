// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/trust/evidence-quality-engine.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
export const TITAN_TRUST_VERSION = "2.4.0";

export const EVIDENCE_QUALITY_STATES = Object.freeze([
  "verified",
  "partial",
  "stale",
  "contradictory",
  "missing",
  "expired",
  "untrusted"
]);

export const EVIDENCE_QUALITY_PRECEDENCE = Object.freeze([
  "missing",
  "untrusted",
  "contradictory",
  "expired",
  "stale",
  "partial",
  "verified"
]);

export const REASON_CODES = Object.freeze({
  EVIDENCE_MISSING: "evidence_missing",
  REQUIRED_EVIDENCE_MISSING: "required_evidence_missing",
  PROVENANCE_MISSING: "provenance_missing",
  PROVENANCE_UNTRUSTED: "provenance_untrusted",
  AUTHORITY_MISSING: "authority_missing",
  AUTHORITY_INSUFFICIENT: "authority_insufficient",
  INTEGRITY_MISSING: "integrity_missing",
  INTEGRITY_FAILED: "integrity_failed",
  EVIDENCE_EXPIRED: "evidence_expired",
  EVIDENCE_STALE: "evidence_stale",
  COMPLETENESS_INSUFFICIENT: "completeness_insufficient",
  SCOPE_MISMATCH: "scope_mismatch",
  CORROBORATION_MISSING: "corroboration_missing",
  CONTRADICTION_PRESENT: "contradiction_present"
});

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const uniqSorted = values => [...new Set(values.filter(Boolean).map(String))].sort();
const toMillis = value => {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
};
const refOf = (evidence, index) => String(evidence?.ref || evidence?.evidence_ref || evidence?.id || `evidence:${index}`);

function normalizeRequirements(requirements = {}) {
  const source = isObject(requirements) ? requirements : {};
  return {
    require_provenance: source.require_provenance !== false,
    require_authority: source.require_authority === true,
    require_integrity: source.require_integrity !== false,
    require_corroboration: source.require_corroboration === true,
    required_evidence_refs: Array.isArray(source.required_evidence_refs) ? uniqSorted(source.required_evidence_refs) : [],
    required_fields: Array.isArray(source.required_fields) ? uniqSorted(source.required_fields) : [],
    required_scope: source.required_scope ?? null,
    freshness_ms: Number.isFinite(Number(source.freshness_ms)) && Number(source.freshness_ms) >= 0 ? Number(source.freshness_ms) : null
  };
}

function evaluateEvidenceItem(item, index, requirements, nowMs) {
  const evidence = isObject(item) ? item : {};
  const ref = refOf(evidence, index);
  const reasons = [];
  const missing = [];
  let trusted = true;

  const provenance = isObject(evidence.provenance) ? evidence.provenance : null;
  if (requirements.require_provenance) {
    if (!provenance || provenance.known !== true) {
      reasons.push(REASON_CODES.PROVENANCE_MISSING);
      missing.push(`provenance:${ref}`);
      trusted = false;
    } else if (provenance.trusted === false || provenance.status === "untrusted") {
      reasons.push(REASON_CODES.PROVENANCE_UNTRUSTED);
      trusted = false;
    }
  } else if (provenance && (provenance.trusted === false || provenance.status === "untrusted")) {
    reasons.push(REASON_CODES.PROVENANCE_UNTRUSTED);
    trusted = false;
  }

  const authority = isObject(evidence.authority) ? evidence.authority : null;
  if (requirements.require_authority) {
    if (!authority || authority.present !== true) {
      reasons.push(REASON_CODES.AUTHORITY_MISSING);
      missing.push(`authority:${ref}`);
      trusted = false;
    } else if (authority.sufficient !== true && authority.authoritative !== true) {
      reasons.push(REASON_CODES.AUTHORITY_INSUFFICIENT);
      trusted = false;
    }
  } else if (authority && authority.sufficient === false) {
    reasons.push(REASON_CODES.AUTHORITY_INSUFFICIENT);
    trusted = false;
  }

  const integrity = isObject(evidence.integrity) ? evidence.integrity : null;
  if (requirements.require_integrity) {
    if (!integrity || integrity.checked !== true) {
      reasons.push(REASON_CODES.INTEGRITY_MISSING);
      missing.push(`integrity:${ref}`);
      trusted = false;
    } else if (integrity.valid !== true || integrity.hash_match === false || integrity.signature_valid === false) {
      reasons.push(REASON_CODES.INTEGRITY_FAILED);
      trusted = false;
    }
  } else if (integrity && (integrity.valid === false || integrity.hash_match === false || integrity.signature_valid === false)) {
    reasons.push(REASON_CODES.INTEGRITY_FAILED);
    trusted = false;
  }

  const expiresAt = toMillis(evidence.expires_at);
  const observedAt = toMillis(evidence.observed_at ?? evidence.created_at ?? evidence.generated_at);
  const expired = expiresAt !== null && expiresAt <= nowMs;
  const stale = !expired && requirements.freshness_ms !== null && (observedAt === null || nowMs - observedAt > requirements.freshness_ms);
  if (expired) reasons.push(REASON_CODES.EVIDENCE_EXPIRED);
  if (stale) reasons.push(REASON_CODES.EVIDENCE_STALE);

  const completeness = isObject(evidence.completeness) ? evidence.completeness : null;
  let complete = true;
  if (requirements.required_fields.length) {
    const present = new Set(Array.isArray(completeness?.present_fields) ? completeness.present_fields.map(String) : []);
    const missingFields = requirements.required_fields.filter(field => !present.has(field));
    if (missingFields.length) {
      complete = false;
      reasons.push(REASON_CODES.COMPLETENESS_INSUFFICIENT);
      missing.push(...missingFields.map(field => `field:${field}`));
    }
  } else if (completeness && completeness.complete === false) {
    complete = false;
    reasons.push(REASON_CODES.COMPLETENESS_INSUFFICIENT);
    if (Array.isArray(completeness.missing_requirements)) missing.push(...completeness.missing_requirements);
  }

  let scopeMatch = true;
  if (requirements.required_scope !== null) {
    const actualScope = evidence.scope?.value ?? evidence.scope ?? null;
    scopeMatch = JSON.stringify(actualScope) === JSON.stringify(requirements.required_scope);
    if (!scopeMatch) {
      reasons.push(REASON_CODES.SCOPE_MISMATCH);
      missing.push("scope_match");
    }
  } else if (isObject(evidence.scope) && evidence.scope.match === false) {
    scopeMatch = false;
    reasons.push(REASON_CODES.SCOPE_MISMATCH);
    missing.push("scope_match");
  }

  const contradictionRefs = uniqSorted([
    ...(Array.isArray(evidence.contradiction_refs) ? evidence.contradiction_refs : []),
    ...(Array.isArray(evidence.contradiction?.refs) ? evidence.contradiction.refs : [])
  ]);
  const contradictory = evidence.contradiction === true || evidence.contradiction?.present === true || contradictionRefs.length > 0;
  if (contradictory) reasons.push(REASON_CODES.CONTRADICTION_PRESENT);

  const corroboratingRefs = uniqSorted([
    ...(Array.isArray(evidence.corroborating_refs) ? evidence.corroborating_refs : []),
    ...(Array.isArray(evidence.corroboration?.supporting_refs) ? evidence.corroboration.supporting_refs : [])
  ]);
  const corroborated = !requirements.require_corroboration || evidence.corroboration?.satisfied === true || corroboratingRefs.length > 0;
  if (!corroborated) {
    reasons.push(REASON_CODES.CORROBORATION_MISSING);
    missing.push(`corroboration:${ref}`);
  }

  return {
    ref,
    trusted,
    expired,
    stale,
    complete,
    scope_match: scopeMatch,
    corroborated,
    contradictory,
    contradiction_refs: contradictionRefs,
    corroborating_refs: corroboratingRefs,
    reason_codes: uniqSorted(reasons),
    missing_requirements: uniqSorted(missing)
  };
}

export function evaluateEvidenceQuality(input, expectedCompanyId, options = {}) {
  if (!isObject(input)) throw new Error("invalid_evidence_quality_request");
  if (!expectedCompanyId || typeof expectedCompanyId !== "string") throw new Error("expected_company_id_required");
  if (input.company_id !== expectedCompanyId) throw new Error("company_mismatch");

  const nowMs = Number.isFinite(Number(options.now_ms)) ? Number(options.now_ms) : Date.now();
  const requirements = normalizeRequirements(input.requirements);
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const reasonCodes = [];
  const missingRequirements = [];

  if (!evidence.length) {
    reasonCodes.push(REASON_CODES.EVIDENCE_MISSING);
    missingRequirements.push("evidence");
  }

  const refsPresent = new Set(evidence.map(refOf));
  const absentRequiredRefs = requirements.required_evidence_refs.filter(ref => !refsPresent.has(ref));
  if (absentRequiredRefs.length) {
    reasonCodes.push(REASON_CODES.REQUIRED_EVIDENCE_MISSING);
    missingRequirements.push(...absentRequiredRefs.map(ref => `evidence_ref:${ref}`));
  }

  const evaluations = evidence.map((item, index) => evaluateEvidenceItem(item, index, requirements, nowMs));
  for (const result of evaluations) {
    reasonCodes.push(...result.reason_codes);
    missingRequirements.push(...result.missing_requirements);
  }

  const supportingRefs = uniqSorted(evaluations
    .filter(result => result.trusted && !result.expired && result.scope_match)
    .map(result => result.ref));

  const hasMissing = !evidence.length || absentRequiredRefs.length > 0;
  const hasUntrusted = evaluations.some(result => !result.trusted);
  const hasContradiction = evaluations.some(result => result.contradictory);
  const hasExpired = evaluations.some(result => result.expired);
  const hasStale = evaluations.some(result => result.stale);
  const hasPartial = evaluations.some(result => !result.complete || !result.scope_match || !result.corroborated);

  let state = "verified";
  if (hasMissing) state = "missing";
  else if (hasUntrusted) state = "untrusted";
  else if (hasContradiction) state = "contradictory";
  else if (hasExpired) state = "expired";
  else if (hasStale) state = "stale";
  else if (hasPartial) state = "partial";

  return Object.freeze({
    company_id: input.company_id,
    state,
    reason_codes: uniqSorted(reasonCodes),
    supporting_refs: supportingRefs,
    missing_requirements: uniqSorted(missingRequirements),
    source_revision: input.source_revision ?? null,
    evaluated_at: new Date(nowMs).toISOString(),
    engine_version: TITAN_TRUST_VERSION,
    deterministic: true
  });
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_TRUST_EVALUATE_EVIDENCE") return undefined;
    (async () => {
      try {
        const expectedCompanyId = await getCurrentCompanyId();
        if (!expectedCompanyId) throw new Error("company_context_required");
        const result = evaluateEvidenceQuality(message.payload, expectedCompanyId, {now_ms: message.now_ms});
        sendResponse({success:true,data:result});
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
