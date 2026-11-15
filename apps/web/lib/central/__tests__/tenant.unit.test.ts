import { describe, it, expect } from "vitest";
import {
  TenantError,
  assertRowInTenant,
  organisationFromVerifiedClaims,
  resolveSessionTenant,
  type MembershipLookup,
} from "../tenant";

const ORG_A = "org_4hq8c1zd";
const ORG_B = "org_9xk2m7qp";
const SUBJECT = "usr_7f3k2m9a";

/** One identity with two memberships: A is active, B is revoked. */
const lookup: MembershipLookup = async (subject, org) => {
  if (subject !== SUBJECT) return null;
  if (org === ORG_A) return { role: "owner", state: "active", revision: 4 };
  if (org === ORG_B) return { role: "technician", state: "revoked", revision: 2 };
  return null;
};

describe("organisation claim", () => {
  it("is required and must be well formed", () => {
    expect(() => organisationFromVerifiedClaims({})).toThrow(TenantError);
    expect(() => organisationFromVerifiedClaims({ org: "" })).toThrow(/no organisation claim/);
    expect(() => organisationFromVerifiedClaims({ org: "has space@x" })).toThrow(/malformed/);
    expect(organisationFromVerifiedClaims({ org: ORG_A })).toBe(ORG_A);
  });
});

describe("session tenant", () => {
  it("scopes a user with two memberships to the organisation in the verified claim", async () => {
    const session = await resolveSessionTenant({ subject: SUBJECT, claims: { org: ORG_A }, lookup });
    expect(session).toEqual({ organisationId: ORG_A, role: "owner", membershipRevision: 4 });
    expect(() => assertRowInTenant(ORG_A, session)).not.toThrow();
  });

  it("refuses a row from the user's other company", async () => {
    const session = await resolveSessionTenant({ subject: SUBJECT, claims: { org: ORG_A }, lookup });
    expect(() => assertRowInTenant(ORG_B, session)).toThrow(/another organisation/);
  });

  it("refuses a revoked membership", async () => {
    await expect(resolveSessionTenant({ subject: SUBJECT, claims: { org: ORG_B }, lookup })).rejects.toMatchObject({ code: "membership_not_active" });
  });

  it("refuses an organisation with no membership at all", async () => {
    await expect(resolveSessionTenant({ subject: SUBJECT, claims: { org: "org_unknown_01" }, lookup })).rejects.toMatchObject({ code: "membership_not_active" });
  });

  it("refuses a missing organisation claim without consulting membership", async () => {
    let asked = false;
    await expect(
      resolveSessionTenant({ subject: SUBJECT, claims: {}, lookup: async () => { asked = true; return null; } }),
    ).rejects.toMatchObject({ code: "missing_organisation" });
    expect(asked).toBe(false);
  });
});
