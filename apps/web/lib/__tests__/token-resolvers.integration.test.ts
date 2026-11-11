import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Migration 204 resolvers, exercised as the restricted web role (ai_fsm_web,
// NOSUPERUSER, NOBYPASSRLS) against a scratch database with all migrations applied.
const enabled = !!process.env.TEST_DATABASE_URL && !!process.env.TEST_RUNTIME_DATABASE_URL;
if (process.env.CI && !enabled) {
  throw new Error("Token resolver integration requires TEST_DATABASE_URL and TEST_RUNTIME_DATABASE_URL");
}

describe.skipIf(!enabled)("token resolvers as the restricted web role", () => {
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const runtime = new Pool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const userA = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const invoiceNumber = `TR-${randomUUID().slice(0, 8)}`;
  let portalTokenA: string;
  let portalTokenB: string;
  let estimateShareA: string;
  let invoiceShareA: string;
  const liveLink = randomUUID();
  const expiredLink = randomUUID();
  const pendingLink = randomUUID();
  const openInvite = randomUUID();
  const usedInvite = randomUUID();
  const locationId = `LOC-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Resolver A'), ($2, 'Resolver B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Resolver owner', 'x', 'owner')`,
      [userA, accountA, `resolver-${randomUUID()}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name, email) VALUES ($1, $2, 'Client A', 'a@test.invalid'), ($3, $4, 'Client B', 'b@test.invalid')`,
      [clientA, accountA, clientB, accountB],
    );
    ({ rows: [{ portal_token: portalTokenA }] } = await admin.query("SELECT portal_token::text FROM clients WHERE id = $1", [clientA]));
    ({ rows: [{ portal_token: portalTokenB }] } = await admin.query("SELECT portal_token::text FROM clients WHERE id = $1", [clientB]));
    await admin.query(
      `INSERT INTO estimates (account_id, client_id, created_by) VALUES ($1, $2, $3)`,
      [accountA, clientA, userA],
    );
    ({ rows: [{ share_token: estimateShareA }] } = await admin.query(
      "SELECT share_token::text FROM estimates WHERE account_id = $1 AND client_id = $2", [accountA, clientA],
    ));
    await admin.query(
      `INSERT INTO invoices (account_id, client_id, created_by, invoice_number, subtotal_cents, tax_cents, total_cents, paid_cents, status)
       VALUES ($1, $2, $3, $4, 0, 0, 0, 0, 'sent')`,
      [accountA, clientA, userA, invoiceNumber],
    );
    ({ rows: [{ share_token: invoiceShareA }] } = await admin.query(
      "SELECT share_token::text FROM invoices WHERE invoice_number = $1", [invoiceNumber],
    ));
    await admin.query(
      `INSERT INTO portal_magic_links (client_id, token, expires_at) VALUES ($1, $2, now() + interval '1 hour'), ($3, $4, now() - interval '1 minute')`,
      [clientA, liveLink, clientA, expiredLink],
    );
    await admin.query(
      `INSERT INTO portal_magic_links (client_id, token, expires_at, pending_email) VALUES ($1, $2, now() + interval '1 hour', 'new@test.invalid')`,
      [clientA, pendingLink],
    );
    await admin.query(
      `INSERT INTO intake_invites (account_id, token, lead_name, lead_email, expires_at, used_at)
       VALUES ($1, $2, 'Open Lead', 'open@test.invalid', now() + interval '1 day', NULL),
              ($1, $3, 'Used Lead', 'used@test.invalid', now() + interval '1 day', now())`,
      [accountA, openInvite, usedInvite],
    );
    await admin.query(
      `INSERT INTO integration_settings (account_id, provider, config) VALUES ($1, 'square', $2::jsonb)`,
      [accountA, JSON.stringify({ locationId, webhookUrl: "https://example.test/hook" })],
    );
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
    await runtime.end();
  });

  it("runs as the restricted role", async () => {
    const { rows: [role] } = await runtime.query(
      "SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(role).toEqual({ name: "ai_fsm_web", rolsuper: false, rolbypassrls: false });
  });

  it("cannot read the protected tables directly without account context", async () => {
    // intake_invites is intentionally absent: migration 183 keeps its SELECT
    // permissive (the token is the boundary), so the role can read it today.
    for (const table of ["clients", "estimates", "invoices", "integration_settings"]) {
      const { rows } = await runtime.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n, table).toBe(0);
    }
  });

  it("resolves a portal token only to its own account", async () => {
    const { rows } = await runtime.query("SELECT resolve_portal_client_account($1::uuid) AS account_id", [portalTokenA]);
    expect(rows).toEqual([{ account_id: accountA }]);
    const other = await runtime.query("SELECT resolve_portal_client_account($1::uuid) AS account_id", [portalTokenB]);
    expect(other.rows).toEqual([{ account_id: accountB }]);
    expect(other.rows[0].account_id).not.toBe(accountA);
  });

  it("returns nothing for an unknown portal token", async () => {
    const { rows } = await runtime.query("SELECT resolve_portal_client_account($1::uuid) AS account_id", [randomUUID()]);
    expect(rows[0].account_id).toBeNull();
  });

  it("resolves estimate and invoice share tokens to their account", async () => {
    const est = await runtime.query("SELECT resolve_estimate_share_account($1::uuid) AS account_id", [estimateShareA]);
    const inv = await runtime.query("SELECT resolve_invoice_share_account($1::uuid) AS account_id", [invoiceShareA]);
    expect(est.rows[0].account_id).toBe(accountA);
    expect(inv.rows[0].account_id).toBe(accountA);
    const none = await runtime.query("SELECT resolve_invoice_share_account($1::uuid) AS account_id", [randomUUID()]);
    expect(none.rows[0].account_id).toBeNull();
  });

  it("consumes a live sign-in link once and returns its client", async () => {
    const first = await runtime.query("SELECT * FROM consume_portal_magic_link($1::uuid)", [liveLink]);
    expect(first.rows).toEqual([{ client_id: clientA, portal_token: portalTokenA }]);
    const second = await runtime.query("SELECT * FROM consume_portal_magic_link($1::uuid)", [liveLink]);
    expect(second.rows).toEqual([]);
  });

  it("does not consume an expired link or an email-change link as a sign-in", async () => {
    expect((await runtime.query("SELECT * FROM consume_portal_magic_link($1::uuid)", [expiredLink])).rows).toEqual([]);
    expect((await runtime.query("SELECT * FROM consume_portal_magic_link($1::uuid)", [pendingLink])).rows).toEqual([]);
  });

  it("consumes a pending email change and returns the change", async () => {
    const { rows } = await runtime.query("SELECT * FROM consume_portal_email_change($1::uuid)", [pendingLink]);
    expect(rows).toEqual([{
      client_id: clientA,
      email: "new@test.invalid",
      old_email: "a@test.invalid",
      portal_token: portalTokenA,
      account_id: accountA,
    }]);
    expect((await runtime.query("SELECT * FROM consume_portal_email_change($1::uuid)", [pendingLink])).rows).toEqual([]);
  });

  it("resolves only open intake invites, and reports used state separately", async () => {
    const open = await runtime.query("SELECT * FROM resolve_open_intake_invite($1::uuid)", [openInvite]);
    expect(open.rows).toMatchObject([{ account_id: accountA, lead_name: "Open Lead" }]);
    expect((await runtime.query("SELECT * FROM resolve_open_intake_invite($1::uuid)", [usedInvite])).rows).toEqual([]);
    expect((await runtime.query("SELECT * FROM resolve_open_intake_invite($1::uuid)", [randomUUID()])).rows).toEqual([]);
    expect((await runtime.query("SELECT * FROM resolve_intake_invite_state($1::uuid)", [usedInvite])).rows).toEqual([{ is_used: true }]);
    expect((await runtime.query("SELECT * FROM resolve_intake_invite_state($1::uuid)", [randomUUID()])).rows).toEqual([]);
  });

  it("resolves a Square location to its account settings", async () => {
    const { rows } = await runtime.query("SELECT * FROM resolve_square_location_settings($1)", [locationId]);
    expect(rows).toMatchObject([{ account_id: accountA, webhook_url: "https://example.test/hook" }]);
    expect((await runtime.query("SELECT * FROM resolve_square_location_settings($1)", ["NO-SUCH-LOCATION"])).rows).toEqual([]);
  });

  it("finds the first owner account and a visit candidate's account", async () => {
    const { rows: [owner] } = await runtime.query("SELECT resolve_owner_account_id() AS account_id");
    expect(owner.account_id).not.toBeNull();
    const { rows: [expected] } = await admin.query(
      "SELECT u.account_id FROM users u JOIN accounts a ON a.id = u.account_id WHERE u.role = 'owner' ORDER BY u.created_at, u.id LIMIT 1",
    );
    expect(owner.account_id).toBe(expected.account_id);
    const missing = await runtime.query("SELECT resolve_visit_candidate_account($1::uuid) AS account_id", [randomUUID()]);
    expect(missing.rows[0].account_id).toBeNull();
  });
});
