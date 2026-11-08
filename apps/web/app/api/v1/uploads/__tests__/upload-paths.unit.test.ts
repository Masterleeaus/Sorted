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
  readFileSync: vi.fn(() => Buffer.from("img")),
  existsSync: vi.fn(() => true),
  unlinkSync: vi.fn(),
}));
vi.mock("fs", () => ({ default: fsMocks, ...fsMocks }));

// Every session-scoped read and write goes through withDbSession, which hands the callback a
// client. clientQuery is that client: it returns rows based on the SQL it is given (see rowsFor).
const dbMocks = vi.hoisted(() => ({
  withDbSession: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  storedFilename: { value: "" },
}));
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
    getPool: () => ({ connect: async () => ({ query: dbMocks.clientQuery, release: dbMocks.release }) }),
  };
});

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import { POST as visitPost } from "../../visits/[id]/media/route";
import { GET as visitImageGet } from "../../visits/[id]/media/[mediaId]/image/route";
import { DELETE as visitDelete } from "../../visits/[id]/media/[mediaId]/route";
import { POST as vaultPost } from "../../vault-items/[itemId]/media/route";
import { GET as vaultImageGet } from "../../vault-items/[itemId]/media/[mediaId]/image/route";
import { DELETE as vaultDelete } from "../../vault-items/[itemId]/media/[mediaId]/route";

const PARENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MEDIA = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const STORED_UUID = "3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b";
const STORED_RE = /^[0-9a-f-]{36}\.(jpg|png)$/;

const HOSTILE_NAMES = [
  "../../../etc/passwd.jpg",
  "..\\..\\..\\etc\\passwd.png",
  "a/b/c.jpg",
  "a\\b\\c.png",
  "..",
  ".",
  "....//....//x.jpg",
  "shot.jpg/../../escape.gif",
  // Old code took the extension as everything after the last dot, so these escaped the directory.
  "name.x/../../../escape",
  "name.x\\..\\..\\escape",
];

function uploadForm(name: string, type = "image/jpeg", category = "before"): FormData {
  const form = new FormData();
  form.append("file", new File(["img-bytes"], name, { type }));
  form.append("category", category);
  return form;
}

function post(url: string, form: FormData): NextRequest {
  return new NextRequest(url, { method: "POST", body: form });
}

function visitsUrl(suffix = "") {
  return `http://localhost/api/v1/visits/${PARENT}/media${suffix}`;
}
function vaultUrl(suffix = "") {
  return `http://localhost/api/v1/vault-items/${PARENT}/media${suffix}`;
}

function lastWrittenPath(): string {
  const calls = fsMocks.writeFileSync.mock.calls;
  expect(calls.length).toBe(1);
  return String(calls[0][0]);
}

function insertParams(): unknown[] {
  const call = dbMocks.clientQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO"));
  expect(call).toBeDefined();
  return call![1] as unknown[];
}

/** Rows the session client returns for each statement the routes run. DELETE and INSERT are matched first. */
function rowsFor(sql: string): unknown[] {
  if (sql.includes("DELETE FROM")) return [{ filename: dbMocks.storedFilename.value }];
  if (sql.includes("INSERT INTO")) {
    return [{ id: MEDIA, visit_id: PARENT, original_name: "x", mime_type: "image/jpeg", size_bytes: 1 }];
  }
  if (sql.includes("FROM visits") || sql.includes("FROM property_vault_items")) {
    return [{ id: PARENT, assigned_user_id: null }];
  }
  if (sql.includes("FROM visit_media") || sql.includes("FROM property_vault_item_media")) {
    return [{ filename: dbMocks.storedFilename.value, mime_type: "image/jpeg" }];
  }
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.role = "owner";
  dbMocks.storedFilename.value = `${STORED_UUID}.jpg`;
  dbMocks.withDbSession.mockImplementation(
    async (_session: unknown, fn: (client: { query: unknown }) => Promise<unknown>) =>
      fn({ query: dbMocks.clientQuery }),
  );
  dbMocks.clientQuery.mockImplementation(async (sql: unknown) => ({ rows: rowsFor(String(sql)) }));
});

describe("visit media POST: hostile client filenames", () => {
  it.each(HOSTILE_NAMES)("stores %j only under the visit directory with a constant-shaped name", async (name) => {
    const res = await visitPost(post(visitsUrl(), uploadForm(name)), {} as never);
    expect(res.status).toBe(201);

    const written = lastWrittenPath();
    expect(written.startsWith(`/app/uploads/visits/${PARENT}/`)).toBe(true);
    expect(written.slice(`/app/uploads/visits/${PARENT}/`.length)).toMatch(STORED_RE);

    const [, , , storedName, originalName] = insertParams();
    expect(String(storedName)).toMatch(STORED_RE);
    expect(String(originalName)).not.toMatch(/[\\/]/);
    expect(String(originalName)).not.toMatch(/^\.+$/);
  });

  it("ignores a client extension and uses the MIME allowlist", async () => {
    const res = await visitPost(post(visitsUrl(), uploadForm("evil.php", "image/png")), {} as never);
    expect(res.status).toBe(201);
    expect(lastWrittenPath().endsWith(".png")).toBe(true);
  });

  it("rejects a non-image MIME regardless of client filename", async () => {
    const res = await visitPost(post(visitsUrl(), uploadForm("../../x.jpg", "text/html")), {} as never);
    expect(res.status).toBe(422);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });

  it("rejects a visit id that is not a single safe path segment", async () => {
    const url = `http://localhost/api/v1/visits/..%2F..%2Fetc/media`;
    const res = await visitPost(post(url, uploadForm("a.jpg")), {} as never);
    expect(res.status).toBe(404);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    expect(dbMocks.withDbSession).not.toHaveBeenCalled();
  });
});

describe("visit media image GET and DELETE: stored filename containment", () => {
  const hostileStored = ["../../../../etc/passwd", "..\\..\\secret.jpg", "a/../../x.jpg", ".."];

  it.each(hostileStored)("does not read %j", async (stored) => {
    dbMocks.storedFilename.value = stored;
    const res = await visitImageGet(new NextRequest(visitsUrl(`/${MEDIA}/image`)), {} as never);
    expect(res.status).toBe(404);
    expect(fsMocks.readFileSync).not.toHaveBeenCalled();
  });

  it("reads a legitimate stored file from the visit directory", async () => {
    const res = await visitImageGet(new NextRequest(visitsUrl(`/${MEDIA}/image`)), {} as never);
    expect(res.status).toBe(200);
    expect(fsMocks.readFileSync).toHaveBeenCalledWith(`/app/uploads/visits/${PARENT}/${STORED_UUID}.jpg`);
  });

  it.each(hostileStored)("deletes the row but never unlinks %j outside the directory", async (stored) => {
    dbMocks.storedFilename.value = stored;
    const res = await visitDelete(new NextRequest(visitsUrl(`/${MEDIA}`), { method: "DELETE" }), {} as never);
    expect(res.status).toBe(200);
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("vault item media POST: hostile client filenames", () => {
  it.each(HOSTILE_NAMES)("stores %j only under the vault item directory", async (name) => {
    const res = await vaultPost(post(vaultUrl(), uploadForm(name)), {} as never);
    expect(res.status).toBe(201);

    const written = lastWrittenPath();
    expect(written.startsWith(`/app/uploads/vault-items/${PARENT}/`)).toBe(true);
    expect(written.slice(`/app/uploads/vault-items/${PARENT}/`.length)).toMatch(STORED_RE);

    const params = insertParams();
    expect(String(params[2])).toMatch(STORED_RE);
    expect(String(params[3])).not.toMatch(/[\\/]/);
  });

  it("rejects a non-image MIME", async () => {
    const res = await vaultPost(post(vaultUrl(), uploadForm("a.jpg", "application/pdf")), {} as never);
    expect(res.status).toBe(422);
    expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("vault item media image GET and DELETE: stored filename containment", () => {
  const hostileStored = ["../../../../etc/passwd", "..\\..\\secret.jpg", "a/../../x.jpg"];

  it.each(hostileStored)("does not read %j", async (stored) => {
    dbMocks.storedFilename.value = stored;
    const res = await vaultImageGet(new NextRequest(vaultUrl(`/${MEDIA}/image`)), {} as never);
    expect(res.status).toBe(404);
    expect(fsMocks.readFileSync).not.toHaveBeenCalled();
  });

  it.each(hostileStored)("deletes the row but never unlinks %j", async (stored) => {
    dbMocks.storedFilename.value = stored;
    const res = await vaultDelete(new NextRequest(vaultUrl(`/${MEDIA}`), { method: "DELETE" }), {} as never);
    expect(res.status).toBe(200);
    expect(fsMocks.unlinkSync).not.toHaveBeenCalled();
  });
});
