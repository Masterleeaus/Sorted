/**
 * Tenant (company) scoping from Central's verified organisation claim.
 *
 * Central owns identity, organisation and membership. Sorted derives the
 * tenant key only from the verified `titan_organisation_id` claim (CONFIG.md
 * section 4.1), never from request input. The membership is looked up in
 * Sorted's durable `organisation_memberships` table (migration 202), which
 * maps the Central identity and organisation to one local account. A user can
 * hold several memberships; the active session is scoped to exactly one
 * organisation and one account, and a membership that is not active is refused.
 */

const ORGANISATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/** The verified token claim that names the organisation. */
export const ORGANISATION_CLAIM = "titan_organisation_id";

export class TenantError extends Error {
  readonly code: "missing_organisation" | "invalid_organisation" | "membership_not_active" | "tenant_mismatch";

  constructor(code: TenantError["code"], message: string) {
    super(message);
    this.name = "TenantError";
    this.code = code;
  }
}

export interface MembershipRecord {
  readonly accountId: string;
  readonly userId: string;
  readonly role: string;
  readonly state: "active" | "revoked" | "suspended" | string;
  readonly revision: number;
}

export type MembershipLookup = (identitySubject: string, organisationId: string) => Promise<MembershipRecord | null>;

export interface SessionTenant {
  readonly accountId: string;
  readonly userId: string;
  readonly organisationId: string;
  readonly role: string;
  readonly membershipRevision: number;
}

/** Reads the organisation from verified claims. Refuses anything missing or malformed. */
export function organisationFromVerifiedClaims(claims: { readonly titan_organisation_id?: unknown }): string {
  const value = claims.titan_organisation_id;
  if (value === undefined || value === null || value === "") {
    throw new TenantError("missing_organisation", `verified token has no ${ORGANISATION_CLAIM} claim`);
  }
  if (typeof value !== "string" || !ORGANISATION_ID_RE.test(value)) {
    throw new TenantError("invalid_organisation", `${ORGANISATION_CLAIM} claim is malformed`);
  }
  return value;
}

/** Scopes a session to one organisation. Refuses a missing, revoked or suspended membership. */
export async function resolveSessionTenant(args: {
  subject: string;
  claims: { readonly titan_organisation_id?: unknown };
  lookup: MembershipLookup;
}): Promise<SessionTenant> {
  const organisationId = organisationFromVerifiedClaims(args.claims);
  const membership = await args.lookup(args.subject, organisationId);
  if (!membership || membership.state !== "active") {
    throw new TenantError("membership_not_active", "no active membership for this organisation");
  }
  return {
    accountId: membership.accountId,
    userId: membership.userId,
    organisationId,
    role: membership.role,
    membershipRevision: membership.revision,
  };
}

/**
 * Whether a session that was issued for `expectedRevision` still matches the
 * stored membership. A revoked, suspended, missing or changed membership fails.
 */
export function membershipIsCurrent(
  stored: { readonly state: string; readonly revision: number } | null,
  expectedRevision: number,
): boolean {
  return stored !== null && stored.state === "active" && stored.revision === expectedRevision;
}

/** Defence check for a row read under a session: refuses any row from another tenant. */
export function assertRowInTenant(rowOrganisationId: string, session: Pick<SessionTenant, "organisationId">): void {
  if (rowOrganisationId !== session.organisationId) {
    throw new TenantError("tenant_mismatch", "row belongs to another organisation");
  }
}
