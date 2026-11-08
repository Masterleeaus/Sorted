/**
 * Unit tests for the public intake photo routes (upload and remove).
 *
 * The database is an in-memory model: a transaction stages its inserts and
 * applies them on COMMIT, and drops them on ROLLBACK. Files go to a mocked fs.
 * This is a model, not Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Invite = {
  id: string;
  token: string;
  account_id: string;
  booking_request_id: string | null;
  used: boolean;
  expired: boolean;
};
type Media = {
  id: string;
  account_id: string;
  intake_invite_id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
};

const db = vi.hoisted(() => {
  const state = {
    invites: [] as Invite[],
    media: [] as Media[],
    pending: [] as Media[],
    failInsert: false,
    nextId: 1,
  };

  const unusedInvite = (token: string) =>
    state.invites.find((i) => i.token === token && !i.used && !i.expired);

  async function run(sql: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
    if (sql.startsWith("BEGIN") || sql.includes("set_config")) return { rows: [] };

    if (sql.startsWith("SELECT id, account_id, booking_request_id")) {
      const inv = unusedInvite(params[0] as string);
      return { rows: inv ? [inv] : [] };
    }
    if (sql.startsWith("SELECT used_at FROM intake_invites")) {
      const inv = state.invites.find((i) => i.token === params[0]);
      return { rows: inv ? [{ used_at: inv.used ? "2026-01-01T00:00:00Z" : null }] : [] };
    }
    if (sql.includes("FROM intake_invites") && sql.includes("FOR UPDATE")) {
      const inv = state.invites.find((i) => i.id === params[0] && !i.used && !i.expired);
      return { rows: inv ? [{ id: inv.id }] : [] };
    }
    if (sql.includes("count(*)") && sql.includes("FROM intake_media")) {
      const n = [...state.media, ...state.pending].filter((m) => m.intake_invite_id === params[0]).length;
      return { rows: [{ n }] };
    }
    if (sql.startsWith("INSERT INTO intake_media")) {
      if (state.failInsert) throw new Error("simulated insert failure");
      const row: Media = {
        id: `00000000-0000-4000-8000-${String(state.nextId++).padStart(12, "0")}`,
        account_id: params[0] as string,
        intake_invite_id: params[1] as string,
        filename: params[2] as string,
        original_name: params[3] as string,
        mime_type: params[4] as string,
        size_bytes: params[5] as number,
      };
      state.pending.push(row);
      return { rows: [{ id: row.id, original_name: row.original_name, mime_type: row.mime_type, size_bytes: row.size_bytes }] };
    }
    if (sql.startsWith("DELETE FROM intake_media")) {
      const idx = state.media.findIndex(
        (m) => m.id === params[0] && m.intake_invite_id === params[1] && m.account_id === params[2],
      );
      if (idx === -1) return { rows: [] };
      const [removed] = state.media.splice(idx, 1);
      return { rows: [{ filename: removed.filename }] };
    }
    if (sql === "COMMIT") {
      state.media.push(...state.pending);
      state.pending = [];
      return { rows: [] };
    }
    if (sql === "ROLLBACK") {
      state.pending = [];
      return { rows: [] };
    }
    throw new Error(`unexpected SQL in test model: ${sql.slice(0, 70)}`);
  }

  const pool = {
    query: (sql: string, params?: unknown[]) => run(sql, params),
    connect: async () => ({ query: (sql: string, params?: unknown[]) => run(sql, params), release: () => {} }),
  };
  return { state, pool };
});

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  failWrite: false,
}));
vi.mock("fs", () => ({ default: fsMocks, ...fsMocks }));

vi.mock("@/lib/db", () => ({ getPool: () => db.pool }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from "../route";
import { DELETE } from "../[mediaId]/route";
import { _resetStore } from "@/lib/rate-limit";

const TOKEN = "11111111-1111-4111-8111-111111111111";
const INVITE_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const BOOKING_ID = "44444444-4444-4444-8444-444444444444";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const JPEG_BYTES = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];

let ipCounter = 0;

function photo(name = "kitchen.jpg", type = "image/jpeg", bytes: number[] = JPEG_BYTES): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function uploadRequest(file: File | null, token = TOKEN): NextRequest {
  const form = new FormData();
  if (file) form.append("file", file);
  return new NextRequest(`http://localhost/api/intake/${token}/media`, {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": `10.9.0.${++ipCounter}` },
  });
}

function postCtx(token = TOKEN) {
  return { params: Promise.resolve({ token }) };
}

function deleteRequest(mediaId: string, token = TOKEN): NextRequest {
  return new NextRequest(`http://localhost/api/intake/${token}/media/${mediaId}`, {
    method: "DELETE",
    headers: { "x-forwarded-for": `10.8.0.${++ipCounter}` },
  });
}

function deleteCtx(mediaId: string, token = TOKEN) {
  return { params: Promise.resolve({ token, mediaId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetStore();
  fsMocks.failWrite = false;
  fsMocks.writeFileSync.mockImplementation(() => {
    if (fsMocks.failWrite) throw new Error("disk full");
  });
  db.state.invites = [
    { id: INVITE_ID, token: TOKEN, account_id: ACCOUNT_ID, booking_request_id: BOOKING_ID, used: false, expired: false },
  ];
  db.state.media = [];
  db.state.pending = [];
  db.state.failInsert = false;
});

describe("POST /api/intake/[token]/media", () => {
  it("stores a valid photo under the invite's directory and associates it with the account and invite", async () => {
    const res = await POST(uploadRequest(photo("kitchen.jpg")), postCtx());
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({ mime_type: "image/jpeg", original_name: "kitchen.jpg", size_bytes: JPEG_BYTES.length });

    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(`/app/uploads/intake/${INVITE_ID}`, { recursive: true });
    const writePath = fsMocks.writeFileSync.mock.calls[0]?.[0] as string;
    expect(writePath).toMatch(new RegExp(`^/app/uploads/intake/${INVITE_ID}/[0-9a-f-]{36}\\.jpg$`));

    expect(db.state.media).toHaveLength(1);
    expect(db.state.media[0]).toMatchObject({
      account_id: ACCOUNT_ID,
      intake_invite_id: INVITE_ID,
      mime_type: "image/jpeg",
    });
  });

  it("uses a server-generated stored name, not the client file name", async () => {
    await POST(uploadRequest(photo("../../etc/passwd.jpg")), postCtx());
    const writePath = fsMocks.writeFileSync.mock.calls[0]?.[0] as string;
    expect(writePath).not.toContain("passwd");
    expect(writePath).not.toContain("..");
    expect(db.state.media[0]?.original_name).toBe("passwd.jpg");
  });

  it("returns 404 for an unknown token and writes nothing", async () => {
    const res = await POST(uploadRequest(photo(), "99999999-9999-4999-8999-999999999999"), postCtx("99999999-9999-4999-8999-999999999999"));
    expect(res.status).toBe(404);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("returns 409 for an invite that was already submitted", async () => {
    db.state.invites[0].used = true;
    const res = await POST(uploadRequest(photo()), postCtx());
    expect(res.status).toBe(409);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("returns 410 for an expired invite", async () => {
    db.state.invites[0].expired = true;
    const res = await POST(uploadRequest(photo()), postCtx());
    expect(res.status).toBe(410);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects a request without a file", async () => {
    const res = await POST(uploadRequest(null), postCtx());
    expect(res.status).toBe(422);
  });

  it("rejects a disallowed declared type", async () => {
    const res = await POST(uploadRequest(photo("notes.pdf", "application/pdf")), postCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/Only photos/);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects text renamed to .jpg because the bytes are not an image", async () => {
    const text = Array.from("this is just a note, not a photo", (c) => c.charCodeAt(0));
    const res = await POST(uploadRequest(photo("fake.jpg", "image/jpeg", text)), postCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/not a supported photo/);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(db.state.media).toHaveLength(0);
  });

  it("rejects an empty file", async () => {
    const res = await POST(uploadRequest(photo("empty.jpg", "image/jpeg", [])), postCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/empty/);
  });

  it("rejects a file over 10 MB", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(JPEG_BYTES, 0);
    const res = await POST(uploadRequest(new File([big], "huge.jpg", { type: "image/jpeg" })), postCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/10 MB/);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("refuses a ninth photo on one request and writes nothing", async () => {
    db.state.media = Array.from({ length: 8 }, (_, i) => ({
      id: `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
      account_id: ACCOUNT_ID,
      intake_invite_id: INVITE_ID,
      filename: `f${i}.jpg`,
      original_name: `f${i}.jpg`,
      mime_type: "image/jpeg",
      size_bytes: 10,
    }));
    const res = await POST(uploadRequest(photo()), postCtx());
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toMatch(/up to 8/);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(db.state.media).toHaveLength(8);
  });

  it("returns 500 and removes the written file when the row insert fails", async () => {
    db.state.failInsert = true;
    const res = await POST(uploadRequest(photo()), postCtx());
    expect(res.status).toBe(500);
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith(fsMocks.writeFileSync.mock.calls[0]?.[0]);
    expect(db.state.media).toHaveLength(0);
  });

  it("returns 500 and records no row when the file write fails", async () => {
    fsMocks.failWrite = true;
    const res = await POST(uploadRequest(photo()), postCtx());
    expect(res.status).toBe(500);
    expect(db.state.media).toHaveLength(0);
  });
});

describe("DELETE /api/intake/[token]/media/[mediaId]", () => {
  beforeEach(() => {
    db.state.media = [
      {
        id: MEDIA_ID,
        account_id: ACCOUNT_ID,
        intake_invite_id: INVITE_ID,
        filename: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg",
        original_name: "kitchen.jpg",
        mime_type: "image/jpeg",
        size_bytes: 10,
      },
    ];
  });

  it("removes the row and the stored file", async () => {
    const res = await DELETE(deleteRequest(MEDIA_ID), deleteCtx(MEDIA_ID));
    expect(res.status).toBe(200);
    expect(db.state.media).toHaveLength(0);
    expect(fsMocks.unlinkSync).toHaveBeenCalledWith(
      `/app/uploads/intake/${INVITE_ID}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg`,
    );
  });

  it("returns 404 for a photo id that is not on this invite and removes nothing", async () => {
    db.state.media[0].intake_invite_id = "77777777-7777-4777-8777-777777777777";
    const res = await DELETE(deleteRequest(MEDIA_ID), deleteCtx(MEDIA_ID));
    expect(res.status).toBe(404);
    expect(db.state.media).toHaveLength(1);
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed photo id without touching the database", async () => {
    const res = await DELETE(deleteRequest("../../etc"), deleteCtx("../../etc"));
    expect(res.status).toBe(404);
    expect(db.state.media).toHaveLength(1);
  });

  it("returns 409 once the invite has been submitted", async () => {
    db.state.invites[0].used = true;
    const res = await DELETE(deleteRequest(MEDIA_ID), deleteCtx(MEDIA_ID));
    expect(res.status).toBe(409);
    expect(db.state.media).toHaveLength(1);
  });
});
