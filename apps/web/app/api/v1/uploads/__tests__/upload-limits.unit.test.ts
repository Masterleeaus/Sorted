import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as "owner" | "admin" | "tech",
  traceId: "00000000-0000-0000-0000-000000000099",
};

vi.mock("@/lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (req: NextRequest) => handler(req, mockSession),
  withRole: (_roles: string[], handler: Function) => (req: NextRequest) => handler(req, mockSession),
}));

const fsMocks = vi.hoisted(() => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  unlinkSync: vi.fn(),
}));
vi.mock("fs", () => ({ default: fsMocks, ...fsMocks }));

const dbMocks = vi.hoisted(() => ({
  withDbSession: vi.fn(),
  withExpenseContext: vi.fn(),
  clientQuery: vi.fn(),
}));
// Session-scoped reads go through withDbSession, the same path the routes use.
vi.mock("@/lib/db", () => {
  const forSession = (session: unknown, sql: string, params?: unknown[]) =>
    dbMocks.withDbSession(session, (client: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }) =>
      client.query(sql, params),
    ) as Promise<{ rows: unknown[] }>;
  return {
    withDbSession: (...args: unknown[]) => dbMocks.withDbSession(...args),
    queryForSession: async (session: unknown, sql: string, params?: unknown[]) => (await forSession(session, sql, params)).rows,
    queryOneForSession: async (session: unknown, sql: string, params?: unknown[]) =>
      ((await forSession(session, sql, params)).rows[0] as unknown) ?? null,
    getPool: () => ({ connect: async () => ({ query: dbMocks.clientQuery, release: vi.fn() }) }),
  };
});
vi.mock("@/lib/expenses/db", () => ({
  withExpenseContext: (...args: unknown[]) => dbMocks.withExpenseContext(...args),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { POST as visitPost } from "../../visits/[id]/media/route";
import { POST as vaultPost } from "../../vault-items/[itemId]/media/route";
import { POST as captures } from "../../captures/route";
import { POST as receiptPost } from "../../expenses/[id]/receipt/route";
import { POST as previewPost } from "../../expenses/import/preview/route";
import { UPLOAD_BODY_LIMITS, formatLimit } from "@/lib/uploads/body-limit";

const ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MIB = 1024 * 1024;

const cases: Array<{
  name: string;
  url: string;
  handler: (req: NextRequest, ctx: never) => Promise<Response>;
  limit: number;
}> = [
  { name: "visit media", url: `http://localhost/api/v1/visits/${ID}/media`, handler: visitPost as never, limit: UPLOAD_BODY_LIMITS.mediaPhoto },
  { name: "vault item media", url: `http://localhost/api/v1/vault-items/${ID}/media`, handler: vaultPost as never, limit: UPLOAD_BODY_LIMITS.mediaPhoto },
  { name: "captures", url: `http://localhost/api/v1/captures`, handler: captures as never, limit: UPLOAD_BODY_LIMITS.captures },
  { name: "expense receipt", url: `http://localhost/api/v1/expenses/${ID}/receipt`, handler: receiptPost as never, limit: UPLOAD_BODY_LIMITS.expenseReceipt },
  { name: "expense import preview", url: `http://localhost/api/v1/expenses/import/preview`, handler: previewPost as never, limit: UPLOAD_BODY_LIMITS.expenseImportPreview },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.role = "owner";
  // Visit and vault routes look up their parent record through withDbSession.
  dbMocks.withDbSession.mockImplementation(
    async (_session: unknown, fn: (client: { query: unknown }) => Promise<unknown>) =>
      fn({ query: dbMocks.clientQuery }),
  );
  dbMocks.clientQuery.mockResolvedValue({ rows: [{ id: ID, assigned_user_id: null }] });
});

describe.each(cases)("$name: oversized multipart body", ({ url, handler, limit }) => {
  it("returns 413 from a declared Content-Length above the cap, before any parsing or writes", async () => {
    const req = new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(limit + 1) },
      body: "--x--\r\n",
    });
    const res = await handler(req, {} as never);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(json.error.traceId).toBe(mockSession.traceId);
    expect(json.error.message).toContain(formatLimit(limit));
    expect(dbMocks.withDbSession).not.toHaveBeenCalled();
    expect(dbMocks.withExpenseContext).not.toHaveBeenCalled();
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("visit media: chunked oversized body", () => {
  it("returns 413 when a body without Content-Length streams past the cap", async () => {
    const enc = new TextEncoder();
    const prefix = enc.encode(
      `--b\r\nContent-Disposition: form-data; name="category"\r\n\r\nbefore\r\n` +
      `--b\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    );
    const chunk = new Uint8Array(1024 * 1024).fill(1);
    let sent = 0;
    let started = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!started) { started = true; controller.enqueue(prefix); return; }
        if (sent > UPLOAD_BODY_LIMITS.mediaPhoto + MIB) { controller.close(); return; }
        controller.enqueue(chunk);
        sent += chunk.byteLength;
      },
    });
    const req = new NextRequest(`http://localhost/api/v1/visits/${ID}/media`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=b" },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await visitPost(req, {} as never);
    expect(res.status).toBe(413);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("per-file checks still run after parsing", () => {
  it("keeps the 422 for a non-image file that is under the body cap", async () => {
    const form = new FormData();
    form.append("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    form.append("category", "before");
    const res = await visitPost(
      new NextRequest(`http://localhost/api/v1/visits/${ID}/media`, { method: "POST", body: form }),
      {} as never,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toBe("Only image files are allowed");
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});
