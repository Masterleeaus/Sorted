/**
 * Real-database check for the intake photo routes (upload and remove).
 *
 * Skip condition: TEST_DATABASE_URL absent. Requires db/migrations applied
 * through 203. The filesystem is mocked, so no files are written.
 *
 *   TEST_DATABASE_URL=postgresql://... pnpm --filter @ai-fsm/web exec vitest run \
 *     --config vitest.integration.config.ts "app/api/intake/\[token\]/media"
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Pool } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));
vi.mock("fs", () => ({ default: fsMocks, ...fsMocks }));

describe.skipIf(!TEST_DB)("intake photos against Postgres", () => {
  let admin: Pool;
  let POST: typeof import("../route").POST;
  let DELETE: typeof import("../[mediaId]/route").DELETE;
  const accountId = randomUUID();
  const token = randomUUID();
  let inviteId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.AUTH_SECRET ??= "integration-test-secret-at-least-32-chars-long";
    process.env.TRUSTED_PROXY_COUNT = "1";
    admin = new Pool({ connectionString: TEST_DB, max: 2 });
    await admin.query(`INSERT INTO accounts (id, name) VALUES ($1, 'intake-photo-test')`, [accountId]);
    inviteId = randomUUID();
    await admin.query(
      `INSERT INTO intake_invites (id, account_id, token, lead_name, lead_email)
       VALUES ($1, $2, $3, 'Photo Client', 'photo@example.com')`,
      [inviteId, accountId, token],
    );
    POST = (await import("../route")).POST;
    DELETE = (await import("../[mediaId]/route")).DELETE;
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await admin.end();
  });

  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  let n = 0;

  function upload(name = "roof.jpg", bytes: Uint8Array = JPEG) {
    const form = new FormData();
    form.append("file", new File([bytes], name, { type: "image/jpeg" }));
    return new NextRequest(`http://localhost/api/intake/${token}/media`, {
      method: "POST",
      body: form,
      headers: { "x-forwarded-for": `10.77.0.${++n}` },
    });
  }

  it("stores a photo, counts it, and removes it again", async () => {
    const res = await POST(upload("roof.jpg"), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(201);
    const { data } = await res.json();

    const { rows } = await admin.query(
      `SELECT account_id, intake_invite_id, mime_type, original_name FROM intake_media WHERE id = $1`,
      [data.id],
    );
    expect(rows[0]).toMatchObject({
      account_id: accountId,
      intake_invite_id: inviteId,
      mime_type: "image/jpeg",
      original_name: "roof.jpg",
    });

    const del = await DELETE(
      new NextRequest(`http://localhost/api/intake/${token}/media/${data.id}`, {
        method: "DELETE",
        headers: { "x-forwarded-for": `10.77.1.${++n}` },
      }),
      { params: Promise.resolve({ token, mediaId: data.id }) },
    );
    expect(del.status).toBe(200);
    const after = await admin.query(`SELECT 1 FROM intake_media WHERE id = $1`, [data.id]);
    expect(after.rowCount).toBe(0);
  });

  it("rejects a ninth photo on one invite with no row written", async () => {
    for (let i = 0; i < 8; i++) {
      const ok = await POST(upload(`p${i}.jpg`), { params: Promise.resolve({ token }) });
      expect(ok.status).toBe(201);
    }
    const ninth = await POST(upload("p8.jpg"), { params: Promise.resolve({ token }) });
    expect(ninth.status).toBe(422);
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n FROM intake_media WHERE intake_invite_id = $1`,
      [inviteId],
    );
    expect(rows[0].n).toBe(8);
  });

  it("refuses new photos once the invite is submitted", async () => {
    await admin.query(`UPDATE intake_invites SET used_at = now() WHERE id = $1`, [inviteId]);
    const res = await POST(upload("late.jpg"), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(409);
    await admin.query(`UPDATE intake_invites SET used_at = NULL WHERE id = $1`, [inviteId]);
  });
});
