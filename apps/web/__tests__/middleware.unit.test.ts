import { describe, it, expect } from "vitest";
import { middleware, buildContentSecurityPolicy } from "../middleware";
import { NextRequest } from "next/server";

function makeRequest(path = "/app/jobs"): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

describe("security headers middleware", () => {
  it("sets X-Frame-Options: DENY", async () => {
    const res = middleware(makeRequest());
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = middleware(makeRequest());
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("sets Referrer-Policy", async () => {
    const res = middleware(makeRequest());
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("sets Permissions-Policy disabling unused APIs", async () => {
    const res = middleware(makeRequest());
    const policy = res.headers.get("Permissions-Policy") ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
  });

  it("allows microphone on /app/capture only", async () => {
    const capture = middleware(makeRequest("/app/capture"));
    expect(capture.headers.get("Permissions-Policy") ?? "").toContain("microphone=(self)");
    const elsewhere = middleware(makeRequest("/app"));
    expect(elsewhere.headers.get("Permissions-Policy") ?? "").toContain("microphone=()");
    expect(elsewhere.headers.get("Permissions-Policy") ?? "").not.toContain("microphone=(self)");
  });

  it("sets Content-Security-Policy with frame-ancestors none", async () => {
    const res = middleware(makeRequest());
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("sets Strict-Transport-Security", async () => {
    const res = middleware(makeRequest());
    const hsts = res.headers.get("Strict-Transport-Security") ?? "";
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
  });

  it("applies headers to API routes", async () => {
    const res = middleware(makeRequest("/api/v1/jobs"));
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("applies headers to auth routes", async () => {
    const res = middleware(makeRequest("/api/v1/auth/login"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("buildContentSecurityPolicy", () => {
  function directive(csp: string, name: string): string {
    return csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " ")) ?? "";
  }

  it("never includes 'unsafe-eval' in production", () => {
    const csp = buildContentSecurityPolicy("production");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
  });

  it("allows 'unsafe-eval' outside production for next dev", () => {
    expect(directive(buildContentSecurityPolicy("development"), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildContentSecurityPolicy("test"), "script-src")).toContain("'unsafe-eval'");
    expect(directive(buildContentSecurityPolicy(undefined), "script-src")).toContain("'unsafe-eval'");
  });

  it("keeps the non-script directives identical in production and development", () => {
    const prod = buildContentSecurityPolicy("production");
    const dev = buildContentSecurityPolicy("development");
    for (const name of ["default-src", "style-src", "img-src", "font-src", "connect-src"]) {
      expect(directive(prod, name)).toBe(directive(dev, name));
    }
    expect(prod.split(";").map((d) => d.trim())).toEqual(
      expect.arrayContaining([
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "default-src 'self'",
        "img-src 'self' data: https://*.tile.openstreetmap.org",
        "connect-src 'self'",
        "font-src 'self'",
      ])
    );
  });

  it("serves the production policy from the middleware response", () => {
    const res = middleware(makeRequest());
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});
