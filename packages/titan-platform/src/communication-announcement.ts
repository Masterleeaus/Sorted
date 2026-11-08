export type AnnouncementSeverity = "information" | "operational" | "safety" | "compliance" | "onboarding" | "release";
export type AnnouncementReceiptKind = "read" | "acknowledged" | "dismissed";

export type AnnouncementAudience = Readonly<{
  roles?: readonly string[];
  teams?: readonly string[];
  locations?: readonly string[];
  verticals?: readonly string[];
  individual_ids?: readonly string[];
}>;

export type CommunicationAnnouncement = Readonly<{
  schema: "titan.communication.announcement.v1";
  announcement_id: string;
  company_id: string;
  author_ref: string;
  source_ref: string;
  audience: AnnouncementAudience;
  severity: AnnouncementSeverity;
  title: string;
  body: string;
  action_ref: string | null;
  effective_at: string;
  expires_at: string | null;
  acknowledgement_required: boolean;
  dismissible: boolean;
  frequency_cap: number | null;
  channels: readonly string[];
  provenance_ref: string;
}>;

export type AnnouncementReceipt = Readonly<{
  schema: "titan.communication.announcement-receipt.v1";
  receipt_id: string;
  announcement_id: string;
  company_id: string;
  actor_ref: string;
  kind: AnnouncementReceiptKind;
  recorded_at: string;
  provenance_ref: string;
}>;

function required(value: unknown, field: string): string { const result = String(value ?? "").trim(); if (!result) throw new Error(`${field} is required`); return result; }
function list(values: readonly string[] | undefined): readonly string[] { return Object.freeze([...(values ?? [])].map((value) => required(value, "audience_value"))); }
function assertSafeBody(value: string): void { if (/<\/?script|javascript:|data:text\/html|\bon[a-z]+\s*=/i.test(value)) throw new Error("announcement-executable-content-rejected"); }

export function createAnnouncement(input: Partial<CommunicationAnnouncement> & { announcement_id: string; company_id: string; author_ref: string; source_ref: string; title: string; body: string; effective_at: string; provenance_ref: string }): CommunicationAnnouncement {
  const effective = new Date(input.effective_at); if (Number.isNaN(effective.valueOf())) throw new Error("announcement-effective-at-invalid");
  const expires = input.expires_at ? new Date(input.expires_at) : null; if (expires && (Number.isNaN(expires.valueOf()) || expires <= effective)) throw new Error("announcement-expiry-invalid");
  const title = required(input.title, "title"); const body = required(input.body, "body"); assertSafeBody(body);
  return Object.freeze({ schema: "titan.communication.announcement.v1", announcement_id: required(input.announcement_id, "announcement_id"), company_id: required(input.company_id, "company_id"), author_ref: required(input.author_ref, "author_ref"), source_ref: required(input.source_ref, "source_ref"), audience: Object.freeze({ roles: list(input.audience?.roles), teams: list(input.audience?.teams), locations: list(input.audience?.locations), verticals: list(input.audience?.verticals), individual_ids: list(input.audience?.individual_ids) }), severity: input.severity ?? "information", title, body, action_ref: input.action_ref ? required(input.action_ref, "action_ref") : null, effective_at: effective.toISOString(), expires_at: expires?.toISOString() ?? null, acknowledgement_required: input.acknowledgement_required === true, dismissible: input.dismissible !== false, frequency_cap: input.frequency_cap == null ? null : Math.max(1, Math.floor(input.frequency_cap)), channels: Object.freeze(list(input.channels)), provenance_ref: required(input.provenance_ref, "provenance_ref") });
}

export function recordAnnouncementReceipt(announcement: CommunicationAnnouncement, input: { receipt_id: string; company_id: string; actor_ref: string; kind: AnnouncementReceiptKind; recorded_at?: string }): AnnouncementReceipt {
  if (input.company_id !== announcement.company_id) throw new Error("announcement-company-context-mismatch");
  if (input.kind === "acknowledged" && !announcement.acknowledgement_required) throw new Error("announcement-acknowledgement-not-required");
  if (input.kind === "dismissed" && !announcement.dismissible) throw new Error("announcement-not-dismissible");
  return Object.freeze({ schema: "titan.communication.announcement-receipt.v1", receipt_id: required(input.receipt_id, "receipt_id"), announcement_id: announcement.announcement_id, company_id: announcement.company_id, actor_ref: required(input.actor_ref, "actor_ref"), kind: input.kind, recorded_at: new Date(input.recorded_at ?? new Date().toISOString()).toISOString(), provenance_ref: announcement.provenance_ref });
}

export class AnnouncementLedger {
  #company_id: string;
  #receipts = new Map<string, AnnouncementReceipt>();
  constructor(company_id: string) { this.#company_id = required(company_id, "company_id"); }
  record(announcement: CommunicationAnnouncement, input: Omit<Parameters<typeof recordAnnouncementReceipt>[1], "company_id">): AnnouncementReceipt {
    if (announcement.company_id !== this.#company_id) throw new Error("announcement-company-context-mismatch");
    const key = `${announcement.announcement_id}:${input.actor_ref}:${input.kind}`;
    const existing = this.#receipts.get(key); if (existing) return existing;
    const receipt = recordAnnouncementReceipt(announcement, { ...input, company_id: this.#company_id }); this.#receipts.set(key, receipt); return receipt;
  }
  snapshot(): readonly AnnouncementReceipt[] { return Object.freeze([...this.#receipts.values()]); }
}

