import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/auth/titan/start/route";

describe("GET /auth/titan/start without Central configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CENTRAL_")) delete process.env[key];
    }
    delete process.env.APP_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("answers 503 and names the first missing variable, never a value", async () => {
    const res = await GET();
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; variable: string } };
    expect(body.error).toEqual({ code: "central_not_configured", variable: "CENTRAL_ORIGIN" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
