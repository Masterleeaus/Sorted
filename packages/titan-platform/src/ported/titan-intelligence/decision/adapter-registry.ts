// @ts-nocheck
// Ported from Titan Zero extension (browser-adapter-required): titan-intelligence/decision/adapter-registry.js
// QUARANTINE: not exported to standalone runtime until browser/DOM dependencies are adapted.
import { adaptMoneyActionToDecisionPacket, MONEY_DECISION_ADAPTER } from "../financial-engine/decision-packet-adapter.js";
import { adaptTrustEvaluationToDecisionPacket, TRUST_DECISION_ADAPTER } from "../trust/decision-packet-adapter.js";
import { adaptShieldPreviewToDecisionPacket, SHIELD_DECISION_ADAPTER } from "../shield/decision-packet-adapter.js";
import { adaptRewindPreviewToDecisionPacket, REWIND_DECISION_ADAPTER } from "../rewind/decision-packet-adapter.js";
import { correlateMoneyDecision } from "../financial-engine/decision-packet-correlation.js";
import { correlateTrustDecision } from "../trust/decision-packet-correlation.js";
import { correlateShieldDecision } from "../shield/decision-packet-correlation.js";
import { correlateRewindDecision } from "../rewind/decision-packet-correlation.js";

export const DECISION_ADAPTER_REGISTRY_VERSION = "1.2.0";

const entries = Object.freeze({
  money: Object.freeze({descriptor:MONEY_DECISION_ADAPTER, project:adaptMoneyActionToDecisionPacket, correlate:correlateMoneyDecision}),
  trust: Object.freeze({descriptor:TRUST_DECISION_ADAPTER, project:adaptTrustEvaluationToDecisionPacket, correlate:correlateTrustDecision}),
  assurance: Object.freeze({descriptor:SHIELD_DECISION_ADAPTER, project:adaptShieldPreviewToDecisionPacket, correlate:correlateShieldDecision}),
  recovery: Object.freeze({descriptor:REWIND_DECISION_ADAPTER, project:adaptRewindPreviewToDecisionPacket, correlate:correlateRewindDecision})
});

export function listDecisionPacketAdapters() {
  return Object.values(entries).map(entry => ({...entry.descriptor}));
}

export function projectThroughDecisionAdapter(domain, payload, expectedCompanyId, packetMeta = {}) {
  const entry = entries[domain];
  if (!entry) throw new Error("invalid_decision_domain");
  return entry.project(payload, expectedCompanyId, packetMeta);
}

export function correlateThroughDecisionAdapter(domain, packet, payload, expectedCompanyId) {
  const entry = entries[domain];
  if (!entry) throw new Error("invalid_decision_domain");
  return entry.correlate(packet, payload, expectedCompanyId);
}

export function projectAndCorrelateThroughDecisionAdapter(domain, payload, expectedCompanyId, packetMeta = {}) {
  const packet = projectThroughDecisionAdapter(domain, payload, expectedCompanyId, packetMeta);
  const correlation = correlateThroughDecisionAdapter(domain, packet, payload, expectedCompanyId);
  return Object.freeze({packet, correlation});
}

async function getCurrentCompanyId() {
  const storage = await chrome.storage.local.get(["currentCompanyId"]);
  return storage.currentCompanyId || null;
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!["TITAN_DECISION_ADAPTER_PROJECT", "TITAN_DECISION_PACKET_PROJECT", "TITAN_DECISION_PACKET_PROJECT_CORRELATED"].includes(message?.type)) return undefined;
    (async () => {
      try {
        const expectedCompanyId = await getCurrentCompanyId();
        if (!expectedCompanyId) throw new Error("company_context_required");
        const result = projectAndCorrelateThroughDecisionAdapter(message.domain, message.payload, expectedCompanyId, message.packet_meta || {});
        sendResponse({
          success:true,
          data:result.packet,
          packet:result.packet,
          correlation:result.correlation,
          adapter:entries[message.domain].descriptor
        });
      } catch (error) {
        sendResponse({success:false,error:error instanceof Error ? error.message : String(error)});
      }
    })();
    return true;
  });
}
