/**
 * Integration: vault item media routes run inside an account-scoped DB session.
 * Account A cannot list account B's item media or delete account B's media, and
 * account B's row is unchanged. Account A's own item media list still returns
 * data under the runtime role.
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

import { GET as listItemMedia } from "@/app/api/v1/vault-items/[itemId]/media/route";
import { DELETE as deleteItemMedia } from "@/app/api/v1/vault-items/[itemId]/media/[mediaId]/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("vault item media routes: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const clientA = randomUUID();
  const clientB = randomUUID();
  const propertyA = randomUUID();
  const propertyB = randomUUID();
  const itemA = randomUUID();
  const itemB = randomUUID();
  const mediaA = randomUUID();
  const mediaB = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Vault Media A'), ($2, 'Vault Media B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `vmedia-a-${ownerA}@test.invalid`, ownerB, accountB, `vmedia-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'VM client A'), ($3, $4, 'VM client B')`,
      [clientA, accountA, clientB, accountB],
    );
    await admin.query(
      `INSERT INTO properties (id, account_id, client_id, address)
       VALUES ($1, $2, $3, '1 VM Way'), ($4, $5, $6, '2 VM Way')`,
      [propertyA, accountA, clientA, propertyB, accountB, clientB],
    );
    await admin.query(
      `INSERT INTO property_vault_items (id, account_id, property_id, category, name, created_by)
       VALUES ($1, $2, $3, 'other', 'VM Item A', $4), ($5, $6, $7, 'other', 'VM Item B', $8)`,
      [itemA, accountA, propertyA, ownerA, itemB, accountB, propertyB, ownerB],
    );
    await admin.query(
      `INSERT INTO property_vault_item_media (id, account_id, vault_item_id, filename, original_name, mime_type, size_bytes, created_by)
       VALUES ($1, $2, $3, 'vm-a.jpg', 'a.jpg', 'image/jpeg', 10, $4),
              ($5, $6, $7, 'vm-b.jpg', 'b.jpg', 'image/jpeg', 10, $8)`,
      [mediaA, accountA, itemA, ownerA, mediaB, accountB, itemB, ownerB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  it("GET media list for account B's item returns 404", async () => {
    const res = await listItemMedia(new NextRequest(`http://localhost/api/v1/vault-items/${itemB}/media`));
    expect(res.status).toBe(404);
  });

  it("GET media list for account A's own item returns its media under the runtime role", async () => {
    const res = await listItemMedia(new NextRequest(`http://localhost/api/v1/vault-items/${itemA}/media`));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(mediaA);
    expect(text).not.toContain(mediaB);
  });

  it("DELETE account B's media returns 404 and keeps the row", async () => {
    const res = await deleteItemMedia(
      new NextRequest(`http://localhost/api/v1/vault-items/${itemB}/media/${mediaB}`, { method: "DELETE" }),
    );
    expect(res.status).toBe(404);
    const row = await admin.query("SELECT id FROM property_vault_item_media WHERE id = $1", [mediaB]);
    expect(row.rowCount).toBe(1);
  });
});
