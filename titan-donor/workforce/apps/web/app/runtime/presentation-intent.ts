import type { TitanSurface } from "./interaction-client";

export type GeneratedUiKind = "summary" | "decision" | "schedule" | "service" | "payment" | "workforce" | "recovery";
export type GeneratedUiActionMode = "navigate" | "prepare_intent";

export interface GeneratedUiAction {
  id: string;
  label: string;
  mode: GeneratedUiActionMode;
  capability?: string;
}

export interface GeneratedUiCardIntent {
  id: string;
  kind: GeneratedUiKind;
  priority: number;
  title: string;
  summary: string;
  facts?: Array<{ label: string; value: string }>;
  actions?: GeneratedUiAction[];
  text_fallback: string;
}

export interface PresentationIntentEnvelope {
  schema: "titan-presentation-intent/v1";
  company_id: string;
  conversation_id: string;
  surface: TitanSurface;
  purpose: string;
  cards: GeneratedUiCardIntent[];
}

const allowedKinds = new Set<GeneratedUiKind>(["summary", "decision", "schedule", "service", "payment", "workforce", "recovery"]);
const forbiddenTenantKeys = ["tenant_id", "tenant_company_id"] as const;

export function validatePresentationIntent(value: PresentationIntentEnvelope, expected: { company_id: string; conversation_id: string; surface: TitanSurface }) {
  const record = value as unknown as Record<string, unknown>;
  for (const key of forbiddenTenantKeys) if (key in record) throw new Error(`Legacy tenant authority is forbidden: ${key}`);
  if (value.schema !== "titan-presentation-intent/v1") throw new Error("Unsupported PresentationIntent schema");
  if (value.company_id !== expected.company_id || value.conversation_id !== expected.conversation_id || value.surface !== expected.surface) throw new Error("PresentationIntent scope mismatch");
  for (const card of value.cards) {
    if (!allowedKinds.has(card.kind)) throw new Error(`Generated UI kind is not allowlisted: ${String(card.kind)}`);
    if (!card.text_fallback?.trim()) throw new Error(`Generated UI card ${card.id} requires text fallback`);
    for (const action of card.actions ?? []) if (action.mode !== "navigate" && action.mode !== "prepare_intent") throw new Error("Generated UI actions cannot execute domain mutations directly");
  }
  return value;
}

export function selectHighestValueCards(intent: PresentationIntentEnvelope, maximum = 3) {
  return [...intent.cards].sort((a, b) => b.priority - a.priority).slice(0, Math.max(0, Math.min(3, maximum)));
}
