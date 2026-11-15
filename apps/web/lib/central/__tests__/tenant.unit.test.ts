import { describe, it, expect } from "vitest";
import {
  TenantError,
  assertRowInTenant,
  membershipIsCurrent,
  organisationFromVerifiedClaims,
  resolveSessionTenant,
  type MembershipLookup,
} from "../tenant";

const ORG_A = "org_4hq8c1zd";
const ORG_B = "org_9xk2m7qp";
const SUBJECT = "usr_7f3k2m9a";
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";

/** One identity with two memberships: A is active, B is revoked. */
const lookup: MembershipLookup = async (subject, org) => {
  if (subject !== SUBJECT) return null;
  if (org === ORG_A) return { accountId: ACCOUNT_A, userId: USER_A, role: "owner", state: "active", revision: 4 };
  if (org === ORG_B) return { accountId: ACCOUNT_B, userId: USER_B, role: "tech", state: "revoked", revision: 2 };
  return null;
};

describe("organisation claim", () => {
  it("reads titan_organisation_id and requires it to be well formed", () => {
    expect(() => organisationFromVerifiedClaims({})).toThrow(TenantError);
    expect(() => organisationFromVerifiedClaims({ titan_organisation_id: "" })).toThrow(/no titan_organisation_id claim/);
    expect(() => organisationFromVerifiedClaims({ titan_organisation_id: "has space@x" })).toThrow(/malformed/);
    expect(organisationFromVerifiedClaims({ titan_organisation_id: ORG_A })).toBe(ORG_A);
  });

  it("does not read the legacy org claim", () => {
    expect(() => organisationFromVerifiedClaims({ org: ORG_A } as { titan_organisation_id?: unknown })).toThrow(/no titan_organisation_id claim/);
  });
});

describe("session tenant", () => {
  it("scopes a user with two memberships to the account of the verified organisation", async () => {
    const session = await resolveSessionTenant({ subject: SUBJECT, claims: { titan_organisation_id: ORG_A }, lookup });
    expect(session).toEqual({
      accountId: ACCOUNT_A,
      userId: USER_A,
      organisationId: ORG_A,
      role: "owner",
      membershipRevision: 4,
    });
    expect(() => assertRowInTenant(ORG_A, session)).not.toThrow();
  });

  it("refuses a row from the user's other company", async () => {
    const session = await resolveSessionTenant({ subject: SUBJECT, claims: { titan_organisation_id: ORG_A }, lookup });
    expect(() => assertRowInTenant(ORG_B, session)).toThrow(/another organisation/);
  });

  it("refuses a revoked membership", async () => {
    await expect(
      resolveSessionTenant({ subject: SUBJECT, claims: { titan_organisation_id: ORG_B }, lookup }),
    ).rejects.toMatchObject({ code: "membership_not_active" });
  });

  it("refuses an organisation with no membership at all", async () => {
    await expect(
      resolveSessionTenant({ subject: SUBJECT, claims: { titan_organisation_id: "org_unknown_01" }, lookup }),
    ).rejects.toMatchObject({ code: "membership_not_active" });
  });

  it("refuses a suspended membership", async () => {
    const suspended: MembershipLookup = async () => ({ accountId: ACCOUNT_A, userId: USER_A, role: "tech", state: "suspended", revision: 5 });
    await expect(
      resolveSessionTenant({ subject: SUBJECT, claims: { titan_organisation_id: ORG_A }, lookup: suspended }),
    ).rejects.toMatchObject({ code: "membership_not_active" });
  });

  it("refuses a missing organisation claim without consulting membership", async () => {
    let asked = false;
    await expect(
      resolveSessionTenant({ subject: SUBJECT, claims: {}, lookup: async () => { asked = true; return null; } }),
    ).rejects.toMatchObject({ code: "missing_organisation" });
    expect(asked).toBe(false);
  });
});

describe("membership currency for a session", () => {
  it("accepts an active membership at the revision the session was issued for", () => {
    expect(membershipIsCurrent({ state: "active", revision: 4 }, 4)).toBe(true);
  });

  it("refuses a revoked or suspended membership even at the same revision", () => {
    expect(membershipIsCurrent({ state: "revoked", revision: 4 }, 4)).toBe(false);
    expect(membershipIsCurrent({ state: "suspended", revision: 4 }, 4)).toBe(false);
  });

  it("refuses a changed revision and a missing row", () => {
    expect(membershipIsCurrent({ state: "active", revision: 5 }, 4)).toBe(false);
    expect(membershipIsCurrent(null, 4)).toBe(false);
    expect(membershipIsCurrent({ state: "active", revision: 4 }, Number.NaN)).toBe(false);
  });
});
