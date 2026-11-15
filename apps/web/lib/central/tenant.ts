/**
 * Tenant (company) scoping from Central's verified organisation claim.
 *
 * Central owns identity, organisation and membership. Sorted derives the
 * tenant key only from the verified `org` claim (Logto organisation id), never
 * from request input. A user can hold several memberships; the active session
 * is scoped to exactly one organisation, and a membership that is not active
 * is refused.
 *
 * The membership lookup is injected. Its production source (Central's
 * memberships or a Sorted mapping table) is not built here.
 */

const ORGANISATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export class TenantError extends Error {
  readonly code: "missing_organisation" | "invalid_organisation" | "membership_not_active" | "tenant_mismatch";

  constructor(code: TenantError["code"], message: string) {
    super(message);
    this.name = "TenantError";
    this.code = code;
  }
}

export interface MembershipRecord {
  readonly role: string;
  readonly state: "active" | "revoked" | "suspended" | string;
  readonly revision: number;
}

export type MembershipLookup = (identitySubject: string, organisationId: string) => Promise<MembershipRecord | null>;

export interface SessionTenant {
  readonly organisationId: string;
  readonly role: string;
  readonly membershipRevision: number;
}

/** Reads the organisation from verified claims. Refuses anything missing or malformed. */
export function organisationFromVerifiedClaims(claims: { readonly org?: unknown }): string {
  if (claims.org === undefined || claims.org === null || claims.org === "") {
    throw new TenantError("missing_organisation", "verified token has no organisation claim");
  }
  if (typeof claims.org !== "string" || !ORGANISATION_ID_RE.test(claims.org)) {
    throw new TenantError("invalid_organisation", "organisation claim is malformed");
  }
  return claims.org;
}

/** Scopes a session to one organisation. Refuses a missing, revoked or suspended membership. */
export async function resolveSessionTenant(args: {
  subject: string;
  claims: { readonly org?: unknown };
  lookup: MembershipLookup;
}): Promise<SessionTenant> {
  const organisationId = organisationFromVerifiedClaims(args.claims);
  const membership = await args.lookup(args.subject, organisationId);
  if (!membership || membership.state !== "active") {
    throw new TenantError("membership_not_active", "no active membership for this organisation");
  }
  return { organisationId, role: membership.role, membershipRevision: membership.revision };
}

/** Defence check for a row read under a session: refuses any row from another tenant. */
export function assertRowInTenant(rowOrganisationId: string, session: Pick<SessionTenant, "organisationId">): void {
  if (rowOrganisationId !== session.organisationId) {
    throw new TenantError("tenant_mismatch", "row belongs to another organisation");
  }
}
