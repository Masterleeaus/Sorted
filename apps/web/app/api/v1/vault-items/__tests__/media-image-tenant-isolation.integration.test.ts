/**
 * Integration: GET /api/v1/vault-items/[itemId]/media/[mediaId]/image looks up
 * the vault item and media inside an account-scoped DB session. Account A gets
 * 404 for account B's item and media. For account A's own item, the lookups
 * succeed under the runtime role; the request then fails only at the file step
 * (no file is stored in this test), so the error is not the lookup error.
 *
 * Requires:
 *   TEST_DATABASE_URL       admin URL, used to seed fixtures
 *   TEST_WEB_DATABASE_URL   URL the handler connects with (defaults to TEST_DATABASE_URL).
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

import { GET as getVaultImage } from "@/app/api/v1/vault-items/[itemId]/media/[mediaId]/image/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("vault media image route: tenant isolation", () => {
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
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Vault Iso A'), ($2, 'Vault Iso B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `vault-a-${ownerA}@test.invalid`, ownerB, accountB, `vault-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO clients (id, account_id, name) VALUES ($1, $2, 'Vault client A'), ($3, $4, 'Vault client B')`,
      [clientA, accountA, clientB, accountB],
    );
    await admin.query(
      `INSERT INTO properties (id, account_id, client_id, address)
       VALUES ($1, $2, $3, '1 Vault Way'), ($4, $5, $6, '2 Vault Way')`,
      [propertyA, accountA, clientA, propertyB, accountB, clientB],
    );
    await admin.query(
      `INSERT INTO property_vault_items (id, account_id, property_id, category, name, created_by)
       VALUES ($1, $2, $3, 'other', 'Item A', $4), ($5, $6, $7, 'other', 'Item B', $8)`,
      [itemA, accountA, propertyA, ownerA, itemB, accountB, propertyB, ownerB],
    );
    await admin.query(
      `INSERT INTO property_vault_item_media (id, account_id, vault_item_id, filename, original_name, mime_type, size_bytes, created_by)
       VALUES ($1, $2, $3, 'a-photo.jpg', 'a.jpg', 'image/jpeg', 10, $4),
              ($5, $6, $7, 'b-photo.jpg', 'b.jpg', 'image/jpeg', 10, $8)`,
      [mediaA, accountA, itemA, ownerA, mediaB, accountB, itemB, ownerB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (itemId: string, mediaId: string) =>
    new NextRequest(`http://localhost/api/v1/vault-items/${itemId}/media/${mediaId}/image`);

  it("GET account B's item and media returns 404 with the vault item lookup error", async () => {
    const res = await getVaultImage(request(itemB, mediaB));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Vault item not found");
  });

  it("GET account A's own item passes both lookups under the runtime role", async () => {
    const res = await getVaultImage(request(itemA, mediaA));
    // No file is stored for this fixture, so the request ends at the file step.
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Image file not found");
  });
});
