/**
 * Integration: GET /api/v1/booking-requests/[id]/photos runs inside an
 * account-scoped DB session. Account A gets 404 for account B's booking request
 * and never sees B's photo rows. Account A's own request lists only its own
 * linked photos, under the runtime role (no RLS bypass).
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
  current: null as null | { userId: string; accountId: string; role: "owner" | "admin" | "tech"; traceId: string },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ DATABASE_URL: process.env.TEST_WEB_DATABASE_URL ?? process.env.TEST_DATABASE_URL }),
}));
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: async () => session.current,
}));

import { GET } from "@/app/api/v1/booking-requests/[id]/photos/route";

const enabled = !!ADMIN_URL;

describe.skipIf(!enabled)("booking request photos route: tenant isolation", () => {
  const admin = new Pool({ connectionString: ADMIN_URL });
  const accountA = randomUUID();
  const accountB = randomUUID();
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const brA = randomUUID();
  const brB = randomUUID();
  const inviteA = randomUUID();
  const inviteB = randomUUID();
  const photoA = randomUUID();
  const photoB = randomUUID();
  const photoBUnlinked = randomUUID();

  beforeAll(async () => {
    await admin.query("INSERT INTO accounts (id, name) VALUES ($1, 'Photo List A'), ($2, 'Photo List B')", [accountA, accountB]);
    await admin.query(
      `INSERT INTO users (id, account_id, email, full_name, password_hash, role)
       VALUES ($1, $2, $3, 'Owner A', 'x', 'owner'), ($4, $5, $6, 'Owner B', 'x', 'owner')`,
      [ownerA, accountA, `photos-a-${ownerA}@test.invalid`, ownerB, accountB, `photos-b-${ownerB}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO booking_requests (id, account_id, name, email, service_description, routing_path, preferred_contact, sms_consent, status)
       VALUES ($1, $2, 'Lead A', 'lead-pa@test.invalid', 'Fix gate', 'site_visit', 'email', false, 'pending'),
              ($3, $4, 'Lead B', 'lead-pb@test.invalid', 'Fix fence', 'site_visit', 'email', false, 'pending')`,
      [brA, accountA, brB, accountB],
    );
    await admin.query(
      `INSERT INTO intake_invites (id, account_id, booking_request_id, lead_name, lead_email, used_at)
       VALUES ($1, $2, $3, 'Lead A', 'lead-pa@test.invalid', now()),
              ($4, $5, $6, 'Lead B', 'lead-pb@test.invalid', now())`,
      [inviteA, accountA, brA, inviteB, accountB, brB],
    );
    await admin.query(
      `INSERT INTO intake_media (id, account_id, intake_invite_id, booking_request_id, filename, original_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, 'a-photo.jpg', 'a-roof.jpg', 'image/jpeg', 100),
              ($5, $6, $7, $8, 'b-photo.jpg', 'b-secret.jpg', 'image/jpeg', 100),
              ($9, $6, $7, NULL, 'b-unlinked.jpg', 'b-unlinked.jpg', 'image/jpeg', 100)`,
      [photoA, accountA, inviteA, brA, photoB, accountB, inviteB, brB, photoBUnlinked],
    );
    session.current = { userId: ownerA, accountId: accountA, role: "owner", traceId: "t" };
  });

  afterAll(async () => {
    await admin.query("DELETE FROM accounts WHERE id = ANY($1::uuid[])", [[accountA, accountB]]);
    await admin.end();
  });

  const request = (id: string) => new NextRequest(`http://localhost/api/v1/booking-requests/${id}/photos`);

  it("GET on account B's booking request returns 404 and no photo metadata", async () => {
    const res = await GET(request(brB));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain(photoB);
    expect(text).not.toContain("b-secret.jpg");
  });

  it("GET on account A's own booking request lists only its linked photos", async () => {
    const res = await GET(request(brA));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string; original_name: string }> };
    expect(body.data.map((p) => p.id)).toEqual([photoA]);
    expect(JSON.stringify(body)).not.toContain("a-photo.jpg");
  });
});
