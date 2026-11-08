// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/shield/remediation-preview.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
export const TITAN_SHIELD_VERSION = "1.0.0";

const ALLOWED_SEVERITIES = new Set(["critical", "high", "medium", "low", "info", "unknown"]);
const ALLOWED_RISKS = new Set(["critical", "high", "medium", "low", "none", "unknown"]);

const isObject = value => !!value && typeof value === "object" && !Array.isArray(value);
const cloneJson = value => value == null ? value : JSON.parse(JSON.stringify(value));
const asArray = value => Array.isArray(value) ? cloneJson(value) : [];
const asText = (value, fallback = "unknown") => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
};
const normalizeEnum = (value, allowed, fallback = "unknown") => {
  const normalized = String(value ?? "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : fallback;
};

/**
 * Build a Shield remediation preview. This function is projection-only.
 * It does not execute, schedule, enqueue, approve, mutate, persist, or invoke remediation.
 */
export function buildRemediationPreview(input, expectedCompanyId) {
  if (!isObject(input)) throw new Error("invalid_shield_preview_request");
  if (!expectedCompanyId || typeof expectedCompanyId !== "string") throw new Error("expected_company_id_required");
  if (!input.company_id || typeof input.company_id !== "string") throw new Error("company_id_required");
  if (input.company_id !== expectedCompanyId) throw new Error("company_mismatch");
  if (!input.finding_id || typeof input.finding_id !== "string") throw new Error("finding_id_required");

  const proposed = asArray(input.proposed_remediation);
  const evidence = asArray(input.evidence);

  return Object.freeze({
    finding_id: input.finding_id,
    company_id: input.company_id,
    issue: asText(input.issue),
    severity: normalizeEnum(input.severity, ALLOWED_SEVERITIES),
    affected_resources: asArray(input.affected_resources),
    evidence,
    proposed_remediation: proposed,
    expected_result: asText(input.expected_result),
    risk: normalizeEnum(input.risk, ALLOWED_RISKS),
    side_effects: asArray(input.side_effects),
    approval_required: true
  });
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "TITAN_SHIELD_PREVIEW_REMEDIATION") return undefined;
    (async () => {
      try {
        const expectedCompanyId = await getCurrentCompanyId();
        if (!expectedCompanyId) throw new Error("company_context_required");
        const result = buildRemediationPreview(message.payload, expectedCompanyId);
        sendResponse({success: true, data: result});
      } catch (error) {
        sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
