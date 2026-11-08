import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockSession = {
  userId: "00000000-0000-0000-0000-000000000001",
  accountId: "00000000-0000-0000-0000-000000000002",
  role: "owner" as "owner" | "admin" | "tech",
  traceId: "00000000-0000-0000-0000-000000000099",
};

vi.mock("@/lib/auth/middleware", () => ({
  withAuth: (handler: Function) => (request: NextRequest) => handler(request, mockSession),
}));

const JOB_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// One fake client per test. Responses are routed by SQL text so the order of
// statements inside a handler does not matter.
const mockClientQuery = vi.fn();
const mockWithDbSession = vi.fn();
const mockGetPool = vi.fn();

vi.mock("@/lib/db", () => ({
  withDbSession: (session: unknown, fn: (client: unknown) => Promise<unknown>) =>
    mockWithDbSession(session, fn),
  getPool: () => mockGetPool(),
}));

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const mockSuggestLineItems = vi.fn();
vi.mock("@/lib/estimates/item-suggester", () => ({
  suggestLineItems: (...args: unknown[]) => mockSuggestLineItems(...args),
}));

const mockRunInterviewTurn = vi.fn();
vi.mock("@/lib/estimates/interview-agent", () => ({
  runInterviewTurn: (...args: unknown[]) => mockRunInterviewTurn(...args),
}));

const mockGenerateMaterials = vi.fn();
vi.mock("@/lib/estimates/materials-generator", () => ({
  generateMaterials: (...args: unknown[]) => mockGenerateMaterials(...args),
  MaterialsGenerationError: class MaterialsGenerationError extends Error {},
}));

vi.mock("@/lib/estimates/assessment-summary-loader", () => ({
  loadAssessmentSummary: vi.fn(),
  loadAssessmentSummaryById: vi.fn(),
}));

const mockDraftEstimate = vi.fn();
vi.mock("@/lib/estimates/ai-draft", () => ({
  draftEstimate: (...args: unknown[]) => mockDraftEstimate(...args),
}));

vi.mock("@/lib/estimates/guardrails", () => ({
  validateMaterialsForTrade: () => ({ allowed: [], blocked: [] }),
}));

const mockExtractTmBriefing = vi.fn();
vi.mock("@/lib/estimates/tm-briefing", () => ({
  extractTmBriefing: (...args: unknown[]) => mockExtractTmBriefing(...args),
}));

vi.mock("@/lib/pricing/settings", () => ({
  loadPricingSettings: vi.fn(async () => ({})),
}));

import { POST as aiItems } from "../ai-items/route";
import { POST as aiInterview } from "../ai-interview/route";
import { POST as aiMaterials } from "../ai-materials/route";
import { POST as aiDraft } from "../ai-draft/route";
import { POST as aiTmBriefing } from "../ai-tm-briefing/route";

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000/api/v1/estimates/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Route SQL text to canned rows; unknown statements return no rows. */
function routeSql(table: Array<[RegExp, unknown[]]>) {
  mockClientQuery.mockImplementation(async (sql: string) => {
    const hit = table.find(([re]) => re.test(String(sql)));
    return { rows: hit ? hit[1] : [], rowCount: hit ? hit[1].length : 0 };
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mockSession.role = "owner";
  process.env.ANTHROPIC_API_KEY = "test-key";
  mockWithDbSession.mockImplementation((_session: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query: mockClientQuery })
  );
  mockGetPool.mockReturnValue({
    connect: async () => ({ query: mockClientQuery, release: vi.fn() }),
  });
  routeSql([]);
});

describe("tenant scoping: estimate AI routes", () => {
  it("ai-items reads the price book inside a session", async () => {
    mockSuggestLineItems.mockResolvedValue([]);

    const res = await aiItems(post("ai-items", { description: "replace faucet" }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    expect(String(mockClientQuery.mock.calls[0][0])).toContain("FROM price_book");
  });

  it("ai-interview loads the job context for the caller's account only", async () => {
    routeSql([
      [/FROM jobs j WHERE j\.id = \$1 AND j\.account_id = \$2/, [
        { title: "Fix roof", notes: null, client_id: "client-1", property_id: null },
      ]],
    ]);
    mockRunInterviewTurn.mockResolvedValue({ reply: "ok" });

    const res = await aiInterview(post("ai-interview", {
      messages: [{ role: "user", content: "Roof leaks over the porch" }],
      job_id: JOB_ID,
    }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    const jobCall = mockClientQuery.mock.calls.find(([sql]) => /FROM jobs j/.test(String(sql)));
    expect(jobCall?.[1]).toEqual([JOB_ID, mockSession.accountId]);
    expect(JSON.stringify(mockRunInterviewTurn.mock.calls[0])).toContain("Job: Fix roof");
  });

  it("ai-materials reads saved materials and account settings inside one session", async () => {
    mockGenerateMaterials.mockResolvedValue({ materials: [] });

    const res = await aiMaterials(post("ai-materials", { scope: "Paint two bedrooms", job_type: "paint" }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession).toHaveBeenCalledTimes(1);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    for (const [sql, params] of mockClientQuery.mock.calls) {
      expect(String(sql)).toContain("WHERE");
      expect(params).toEqual([mockSession.accountId]);
    }
  });

  it("ai-draft loads account-scoped job context and materials through the session", async () => {
    routeSql([
      [/FROM jobs j WHERE j\.id = \$1 AND j\.account_id = \$2/, [
        { title: "Kitchen", notes: null, client_id: "client-1", property_id: null },
      ]],
    ]);
    mockDraftEstimate.mockResolvedValue(null);

    const res = await aiDraft(post("ai-draft", { description: "Repaint kitchen", job_id: JOB_ID }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls.every(([session]) => session === mockSession)).toBe(true);
    const jobCall = mockClientQuery.mock.calls.find(([sql]) => /FROM jobs j/.test(String(sql)));
    expect(jobCall?.[1]).toEqual([JOB_ID, mockSession.accountId]);
    expect(JSON.stringify(mockDraftEstimate.mock.calls[0])).toContain("Job: Kitchen");
  });

  it("ai-tm-briefing loads job context inside the session and reads pricing settings separately", async () => {
    routeSql([
      [/FROM jobs j WHERE j\.id = \$1 AND j\.account_id = \$2/, [
        { title: "Drain repair", notes: null, client_id: "client-1", property_id: null },
      ]],
    ]);
    mockExtractTmBriefing.mockResolvedValue({ ok: true });

    const res = await aiTmBriefing(post("ai-tm-briefing", {
      briefing: "Clear the main drain and replace the trap arm.",
      job_id: JOB_ID,
    }));

    expect(res.status).toBe(200);
    expect(mockWithDbSession.mock.calls[0][0]).toBe(mockSession);
    const jobCall = mockClientQuery.mock.calls.find(([sql]) => /FROM jobs j/.test(String(sql)));
    expect(jobCall?.[1]).toEqual([JOB_ID, mockSession.accountId]);
    expect(JSON.stringify(mockExtractTmBriefing.mock.calls[0])).toContain("Job: Drain repair");
  });
});
