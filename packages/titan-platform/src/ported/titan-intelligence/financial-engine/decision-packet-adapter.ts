// @ts-nocheck
// Ported from Titan Zero extension (portable-core): titan-intelligence/financial-engine/decision-packet-adapter.js
import { convergeMoneyDecisionPacket, MONEY_DECISION_CONVERGENCE } from "./decision-packet-convergence.js";

export const MONEY_DECISION_ADAPTER_VERSION = "1.1.0";
export const MONEY_DECISION_ADAPTER = Object.freeze({...MONEY_DECISION_CONVERGENCE, adapter_id:"titan.money.decision-packet.v1"});

/** Compatibility adapter: legacy MoneyAction and native observation+MoneyAction envelopes converge identically. */
export function adaptMoneyActionToDecisionPacket(payload, expectedCompanyId, packetMeta = {}) {
  if (!payload || typeof payload !== "object") throw new Error("invalid_money_action");
  if (payload.money_action || payload.financial_observation || payload.observation_record || payload.action) {
    return convergeMoneyDecisionPacket(payload, expectedCompanyId, packetMeta);
  }
  return convergeMoneyDecisionPacket({money_action:payload}, expectedCompanyId, packetMeta);
}
export const adaptFinancialObservationToDecisionPacket = convergeMoneyDecisionPacket;
