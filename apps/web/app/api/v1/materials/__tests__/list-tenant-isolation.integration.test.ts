/**
 * Integration: GET /api/v1/materials lists only the caller's account under the
 * runtime role, and includes the caller's own material.
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

import { GET as listMaterials } from "@/app/api/v1/materials/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("materials list: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const materialA = randomUUID();
  const materialB = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Mat List A'), ($2, 'Mat List B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner')`,
      [ownerA, accountA, `mat-list-a-${ownerA}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO materials_price_book (id, account_id, name) VALUES ($1, $2, 'Mat list A item'), ($3, $4, 'Mat list B item')`,
      [materialA, accountA, materialB, accountB],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  it("lists account A's material and not account B's", async () => {
    const res = await listMaterials(new NextRequest("http://localhost/api/v1/materials"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(materialA);
    expect(text).not.toContain(materialB);
  });
});
