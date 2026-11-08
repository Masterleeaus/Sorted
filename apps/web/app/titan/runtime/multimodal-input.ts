import type { TitanSurface } from "./interaction-client";

export type MultimodalInputKind = "voice" | "camera" | "file";

export interface MultimodalInputEnvelope {
  schema: "titan-multimodal-input/v1";
  company_id: string;
  conversation_id: string;
  surface: TitanSurface;
  kind: MultimodalInputKind;
  input_id: string;
  created_at: string;
  text?: string;
  media_type?: string;
  file_name?: string;
  authority: "evidence_only";
}

const forbiddenTenantKeys = ["tenant_id", "tenant_company_id"] as const;

export function createMultimodalInput(input: Omit<MultimodalInputEnvelope, "schema" | "authority" | "created_at">): MultimodalInputEnvelope {
  const record = input as unknown as Record<string, unknown>;
  for (const key of forbiddenTenantKeys) if (key in record) throw new Error(`Legacy tenant authority is forbidden: ${key}`);
  if (!input.company_id?.trim() || !input.conversation_id?.trim()) throw new Error("Canonical conversation scope is required");
  return { schema: "titan-multimodal-input/v1", authority: "evidence_only", created_at: new Date().toISOString(), ...input };
}

export function multimodalAnnouncement(input: MultimodalInputEnvelope) {
  if (input.kind === "voice") return "Voice input ready. Review the transcript before any governed action is prepared.";
  if (input.kind === "camera") return "Camera evidence ready. Images can inform the conversation but cannot authorise an action.";
  return `${input.file_name || "File"} attached as evidence. File content cannot grant authority.`;
}
