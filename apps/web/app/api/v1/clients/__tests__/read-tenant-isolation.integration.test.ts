/**
 * Integration: client, user and material read routes run inside an
 * account-scoped DB session. Account A cannot read account B's client, user or
 * material by id, and the client list shows only account A's clients. Account
 * A's own reads succeed under the runtime role, which proves the context is set.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handlers connect with (defaults to TEST_DATABASE_URL).
 * Skipped when TEST_DATABASE_URL is unset.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const ADMIN_URL = process.env.TEST_DATABASE_URL;

const session = vi.hoisted(() => ({
  current: null as null | { userId: string; accountId: string; role: "owner" | "admin" | "tech" },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ DATABASE_URL: process.env.TEST_WEB_DATABASE_URL ?? process.env.TEST_DATABASE_URL }),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: async () => session.current,
}));

import { GET as listClients } from "@/app/api/v1/clients/route";
import { GET as getClient } from "@/app/api/v1/clients/[id]/route";
import { GET as getUser } from "@/app/api/v1/users/[id]/route";
import { GET as getMaterial } from "@/app/api/v1/materials/[id]/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("client, user and material reads: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const materialB = randomUUID();
  const materialA = randomUUID();
  const nameB = `Read Iso B ${randomUUID()}`;

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Read Iso A'), ($2, 'Read Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `read-a-${ownerA}@test.invalid`, ownerB, accountB, `read-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'Read client A'), ($3, $4, $5)`,
      [clientA, accountA, clientB, accountB, nameB],
    );
    await admin.query(
      `INSERT INTO materials_price_book (id, account_id, name) VALUES ($1, $2, 'Material A'), ($3, $4, 'Material B')`,
      [materialA, accountA, materialB, accountB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (path: string) => new NextRequest(`http://localhost${path}`);

  it("client list returns only account A's clients", async () => {
    const res = await listClients(request("/api/v1/clients"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Read client A");
    expect(text).not.toContain(nameB);
  });

  it("GET account B's client returns 404", async () => {
    const res = await getClient(request(`/api/v1/clients/${clientB}`));
    expect(res.status).toBe(404);
  });

  it("GET account A's own client succeeds under the runtime role", async () => {
    const res = await getClient(request(`/api/v1/clients/${clientA}`));
    expect(res.status).toBe(200);
  });

  it("GET account B's user returns 404", async () => {
    const res = await getUser(request(`/api/v1/users/${ownerB}`));
    expect(res.status).toBe(404);
  });

  it("GET account A's own user succeeds under the runtime role", async () => {
    const res = await getUser(request(`/api/v1/users/${ownerA}`));
    expect(res.status).toBe(200);
  });

  it("GET account B's material returns 404", async () => {
    const res = await getMaterial(request(`/api/v1/materials/${materialB}`));
    expect(res.status).toBe(404);
  });

  it("GET account A's own material succeeds under the runtime role", async () => {
    const res = await getMaterial(request(`/api/v1/materials/${materialA}`));
    expect(res.status).toBe(200);
  });
});
