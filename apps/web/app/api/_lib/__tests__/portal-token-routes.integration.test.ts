/**
 * Integration tests for the token-based portal routes against a real database.
 *
 * Route queries run through getPool(), which is the restricted runtime role
 * (TEST_RUNTIME_DATABASE_URL). The token lookups use queryOne, which here runs
 * as the admin role (TEST_DATABASE_URL). That stands in for the SECURITY DEFINER
 * token resolver that docs/working/rls-web-tier-flip.md (blocker 1) still needs.
 * The resolver is not part of this change.
 *
 * Skipped unless both URLs are set.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const RUNTIME_URL = process.env.TEST_RUNTIME_DATABASE_URL;
const enabled = !!ADMIN_URL && !!RUNTIME_URL;

vi.mock("@/lib/db", async () => {
  const { Pool: PgPool } = await import("pg");
  const admin = new PgPool({ connectionString: process.env.TEST_DATABASE_URL });
  const runtime = new PgPool({ connectionString: process.env.TEST_RUNTIME_DATABASE_URL });
  return {
    getPool: () => runtime,
    query: async (text: string, params?: unknown[]) => (await runtime.query(text, params)).rows,
    queryOne: async (text: string, params?: unknown[]) => (await admin.query(text, params)).rows[0] ?? null,
  };
});

vi.mock("@/lib/portal/session", () => ({
  isPortalPreview: async () => false,
  PREVIEW_READ_ONLY_MESSAGE: "Admin preview is read-only",
}));

import { GET as getPortalClient } from "@/app/api/portal/clients/[token]/route";
import { GET as getPortalEstimate, POST as respondEstimate } from "@/app/api/portal/estimates/[token]/route";
import { GET as getPortalInvoice } from "@/app/api/portal/invoices/[token]/route";

describe.skipIf(!enabled)("portal token routes under the runtime role", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const runtime = new Pool({ connectionString: RUNTIME_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const estimateA = randomUUID();
  const estimateB = randomUUID();
  const invoiceA = randomUUID();
  const invoiceB = randomUUID();
  const lineA = randomUUID();
  const lineB = randomUUID();
  const invLineA = randomUUID();
  const invLineB = randomUUID();

  let tokens: { clientA: string; clientB: string; estimateA: string; estimateB: string; invoiceA: string; invoiceB: string };

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Portal A'), ($2, 'Portal B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `portal-a-${ownerA}@test.invalid`, ownerB, accountB, `portal-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name, email) VALUES ($1, $2, 'Client A', 'a@test.invalid'), ($3, $4, 'Client B', 'b@test.invalid')`,
      [clientA, accountA, clientB, accountB],
    );
    await admin.query(
      `INSERT INTO estimates (id, account_id, client_id, created_by, status, subtotal_cents, total_cents)
       VALUES ($1, $2, $3, $4, 'sent', 1000, 1000), ($5, $6, $7, $8, 'sent', 9000, 9000)`,
      [estimateA, accountA, clientA, ownerA, estimateB, accountB, clientB, ownerB],
    );
    await admin.query(
      `INSERT INTO estimate_line_items (id, estimate_id, description, quantity, unit_price_cents, total_cents, visible_to_customer)
       VALUES ($1, $2, 'Line A', 1, 1000, 1000, true), ($3, $4, 'Line B', 1, 9000, 9000, true)`,
      [lineA, estimateA, lineB, estimateB],
    );
    await admin.query(
      `INSERT INTO invoices (id, account_id, client_id, created_by, invoice_number, status, subtotal_cents, total_cents)
       VALUES ($1, $2, $3, $4, 'INV-A', 'sent', 1000, 1000), ($5, $6, $7, $8, 'INV-B', 'sent', 9000, 9000)`,
      [invoiceA, accountA, clientA, ownerA, invoiceB, accountB, clientB, ownerB],
    );
    await admin.query(
      `INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price_cents, total_cents, visible_to_customer)
       VALUES ($1, $2, 'Inv line A', 1, 1000, 1000, true), ($3, $4, 'Inv line B', 1, 9000, 9000, true)`,
      [invLineA, invoiceA, invLineB, invoiceB],
    );
    await admin.query(
      `INSERT INTO maintenance_plans (account_id, client_id, name, frequency) VALUES ($1, $2, 'Plan A', 'annual'), ($3, $4, 'Plan B', 'annual')`,
      [accountA, clientA, accountB, clientB],
    );
    const { rows } = await admin.query<{ id: string; token: string }>(
      `SELECT id::text, portal_token::text AS token FROM clients WHERE id = ANY($1::uuid[])
       UNION ALL SELECT id::text, share_token::text FROM estimates WHERE id = ANY($2::uuid[])
       UNION ALL SELECT id::text, share_token::text FROM invoices WHERE id = ANY($3::uuid[])`,
      [[clientA, clientB], [estimateA, estimateB], [invoiceA, invoiceB]],
    );
    const t = Object.fromEntries(rows.map((r) => [r.id, r.token]));
    tokens = {
      clientA: t[clientA],
      clientB: t[clientB],
      estimateA: t[estimateA],
      estimateB: t[estimateB],
      invoiceA: t[invoiceA],
      invoiceB: t[invoiceB],
    };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
    await runtime.end();
  });

  const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
  const req = (path: string, method = "GET") => new NextRequest(`http://localhost${path}`, { method });

  it("connects as the restricted runtime role, not a superuser or BYPASSRLS role", async () => {
    const { rows } = await runtime.query<{ u: string; su: boolean; byp: boolean }>(
      `SELECT current_user AS u, rolsuper AS su, rolbypassrls AS byp FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ u: "ai_fsm_web", su: false, byp: false });
  });

  it("with no account context the runtime role sees no line items", async () => {
    const { rows } = await runtime.query<{ n: number }>("SELECT count(*)::int AS n FROM estimate_line_items");
    expect(rows[0].n).toBe(0);
  });

  it("portal client page returns only the token's client's estimates, invoices and plans", async () => {
    const res = await getPortalClient(req("/api/portal/clients/t"), ctx(tokens.clientA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client.name).toBe("Client A");
    expect(body.estimates.map((e: { id: string }) => e.id)).toEqual([estimateA]);
    expect(body.invoices.map((i: { id: string }) => i.id)).toEqual([invoiceA]);
    expect(body.plans.map((p: { name: string }) => p.name)).toEqual(["Plan A"]);
  });

  it("portal estimate page returns only the token's line items and no account_id", async () => {
    const res = await getPortalEstimate(req("/api/portal/estimates/t"), ctx(tokens.estimateA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.estimate).not.toHaveProperty("account_id");
    expect(body.lineItems.map((l: { id: string }) => l.id)).toEqual([lineA]);
  });

  it("portal invoice page returns only the token's line items and no account_id", async () => {
    const res = await getPortalInvoice(req("/api/portal/invoices/t"), ctx(tokens.invoiceA));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice).not.toHaveProperty("account_id");
    expect(body.lineItems.map((l: { id: string }) => l.id)).toEqual([invLineA]);
  });

  it("respond writes only the token's estimate, under account A's context", async () => {
    const withBody = new NextRequest("http://localhost/api/portal/estimates/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "decline" }),
    });
    const declined = await respondEstimate(withBody, ctx(tokens.estimateA));
    expect(declined.status).toBe(200);
    expect(await declined.json()).toEqual({ status: "declined" });
    const { rows } = await admin.query<{ id: string; status: string }>(
      "SELECT id::text, status FROM estimates WHERE id = ANY($1::uuid[])",
      [[estimateA, estimateB]],
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[estimateA]).toBe("declined");
    expect(byId[estimateB]).toBe("sent");
  });
});
