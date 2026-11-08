import type { TitanSurface } from "./interaction-client";
import type { GeneratedUiKind, PresentationIntentEnvelope } from "./presentation-intent";

function kindFor(surface: TitanSurface, text: string): GeneratedUiKind {
  if (/invoice|pay|money|overdue/i.test(text)) return "payment";
  if (/issue|hazard|problem|incident|recover/i.test(text)) return "recovery";
  if (/workforce|agent|manager|specialist/i.test(text)) return "workforce";
  if (/decision|approve|needs me/i.test(text)) return "decision";
  if (surface === "go") return "schedule";
  if (surface === "hub") return "service";
  return "summary";
}

export function demoPresentationIntent(input: { company_id: string; conversation_id: string; surface: TitanSurface; text: string }): PresentationIntentEnvelope {
  const kind = kindFor(input.surface, input.text);
  const labels: Record<GeneratedUiKind, [string, string]> = {
    summary: ["Live business brief", "The highest-value operational context is ready."],
    decision: ["Decisions needing you", "Two governed decisions are waiting; routine work continues."],
    schedule: ["Next field priority", "Access, timing and equipment context for the next job."],
    service: ["Your next service", "Booking status and the most useful service options."],
    payment: ["Account and payment", "Payment context is ready; no charge occurs without confirmation."],
    workforce: ["Your active team", "The relevant managers and specialists can join this conversation."],
    recovery: ["Recovery workspace", "The issue can be prepared for review without advancing canonical state."],
  };
  const [title, summary] = labels[kind];
  return { schema: "titan-presentation-intent/v1", ...input, purpose: "Conversation context", cards: [
    { id: `primary-${kind}`, kind, priority: 100, title, summary, facts: [{ label: "Authority", value: "Receipt-controlled" }, { label: "Scope", value: input.surface.toUpperCase() }], actions: [{ id: "details", label: "View details", mode: "navigate" }, { id: "prepare", label: "Prepare action", mode: "prepare_intent", capability: `surface.${kind}.prepare` }], text_fallback: `${title}. ${summary}` },
    { id: "context", kind: "summary", priority: 60, title: "Context retained", summary: "Zero and joined workers share this conversation context.", text_fallback: "Conversation context is retained across worker handoffs." },
    { id: "trust", kind: "summary", priority: 40, title: "Governed execution", summary: "Generated UI can prepare work but cannot bypass authority gates.", text_fallback: "Generated UI cannot directly execute consequential business changes." },
    { id: "low-priority", kind: "summary", priority: 1, title: "Additional detail", summary: "Available in the detail surface when needed.", text_fallback: "Additional detail is available outside the primary three-card view." }
  ] };
}
