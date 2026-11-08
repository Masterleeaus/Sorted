import {
  classifyRisk as classifyRiskRaw,
  riskRequiresElevatedAuthorisation as riskRequiresElevatedAuthorisationRaw,
} from "./ported/titan-intelligence/core/risk-classification.js";

export type TitanRiskLevel = "low" | "medium" | "high" | "exceptional";

export type TitanRiskInput = {
  company_id: string;
  item_id?: string;
  revision_id?: string;
  classified_at?: number;
  evidence?: Record<string, unknown>;
  [key: string]: unknown;
};

export type TitanRiskAssessment = Readonly<{
  company_id: string;
  item_id: string | null;
  revision_id: string | null;
  level: TitanRiskLevel;
  score: number;
  deterministic: true;
  model_used: false;
  evidence: Record<string, unknown>;
  factors: Array<Record<string, unknown>>;
  exceptional_reasons: string[];
  topology_constraints: Record<string, unknown>;
  classified_at: number;
}>;

export const classifyRisk = classifyRiskRaw as (input: TitanRiskInput) => TitanRiskAssessment;
export const riskRequiresElevatedAuthorisation = riskRequiresElevatedAuthorisationRaw as (
  assessment: Pick<TitanRiskAssessment, "level">,
) => boolean;


export * from "./intelligence-runtime/index.js";

export { AIProviderRegistry, AI_PROVIDER_ROUTING_POLICY } from "./ported/titan-ai-core/provider-registry.js";

export { normalizeSignal, prioritizeSignals, SIGNAL_POLICY } from "./ported/titan-intelligence/signal/index.js";

export { buildModelCouncilRecommendation, MODEL_COUNCIL_POLICY } from "./ported/titan-intelligence/model-council/index.js";

export { createNexusOrchestration, NEXUS_POLICY } from "./ported/titan-intelligence/nexus/index.js";
