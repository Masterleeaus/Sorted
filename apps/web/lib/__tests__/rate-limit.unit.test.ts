import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  checkRateLimit,
  getClientIp,
  getTrustedProxyCount,
  UNKNOWN_CLIENT_IP,
  LOGIN_RATE_LIMIT,
  SENSITIVE_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  INTAKE_IP_RATE_LIMIT,
  INTAKE_TOKEN_RATE_LIMIT,
  _resetStore,
  type RateLimitConfig,
} from "../rate-limit";

beforeEach(() => {
  _resetStore();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// checkRateLimit — basic allow / deny
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  const config: RateLimitConfig = { limit: 3, windowSeconds: 60 };

  it("allows requests within limit", () => {
    const r1 = checkRateLimit("test:ip", config);
    const r2 = checkRateLimit("test:ip", config);
    const r3 = checkRateLimit("test:ip", config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("denies requests exceeding limit", () => {
    checkRateLimit("test:ip", config);
    checkRateLimit("test:ip", config);
    checkRateLimit("test:ip", config);

    const r4 = checkRateLimit("test:ip", config);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("isolates different keys", () => {
    checkRateLimit("key:a", config);
    checkRateLimit("key:a", config);
    checkRateLimit("key:a", config);
    // key:a is at limit — key:b should still be allowed
    const result = checkRateLimit("key:b", config);
    expect(result.allowed).toBe(true);
  });

  it("returns resetAt in the future", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const result = checkRateLimit("test:reset", config);
    expect(result.resetAt).toBeGreaterThan(nowSeconds);
  });

  it("slides the window — old entries expire and allow new requests", () => {
    const shortConfig: RateLimitConfig = { limit: 2, windowSeconds: 10 };
    checkRateLimit("slide:ip", shortConfig);
    checkRateLimit("slide:ip", shortConfig);
    // At limit now

    expect(checkRateLimit("slide:ip", shortConfig).allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(11_000);

    const after = checkRateLimit("slide:ip", shortConfig);
    expect(after.allowed).toBe(true);
  });

  it("remaining counts down correctly", () => {
    const r1 = checkRateLimit("count:ip", config);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit("count:ip", config);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit("count:ip", config);
    expect(r3.remaining).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getTrustedProxyCount / getClientIp
// ---------------------------------------------------------------------------

describe("getTrustedProxyCount", () => {
  const original = process.env.TRUSTED_PROXY_COUNT;
  afterEach(() => {
    if (original === undefined) delete process.env.TRUSTED_PROXY_COUNT;
    else process.env.TRUSTED_PROXY_COUNT = original;
  });

  it("defaults to 0 when unset", () => {
    delete process.env.TRUSTED_PROXY_COUNT;
    expect(getTrustedProxyCount()).toBe(0);
  });

  it("parses small non-negative integers", () => {
    process.env.TRUSTED_PROXY_COUNT = "1";
    expect(getTrustedProxyCount()).toBe(1);
    process.env.TRUSTED_PROXY_COUNT = " 2 ";
    expect(getTrustedProxyCount()).toBe(2);
  });

  it.each(["", "abc", "-1", "1.5", "99", "1e2"])("fails closed to 0 for %j", (value) => {
    process.env.TRUSTED_PROXY_COUNT = value;
    expect(getTrustedProxyCount()).toBe(0);
  });
});

describe("getClientIp", () => {
  const xff = (value: string) =>
    new Request("http://localhost/", { headers: { "x-forwarded-for": value } });

  it("ignores X-Forwarded-For when no proxy is trusted (default)", () => {
    expect(getClientIp(xff("1.2.3.4, 5.6.7.8"), 0)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("ignores X-Real-IP even when a proxy is trusted", () => {
    const req = new Request("http://localhost/", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(getClientIp(req, 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("returns unknown when no IP headers are present", () => {
    expect(getClientIp(new Request("http://localhost/"), 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("with one trusted proxy, uses the rightmost entry and ignores attacker prefixes", () => {
    // Client sent "6.6.6.6"; the trusted proxy appended the real peer 5.6.7.8.
    expect(getClientIp(xff("6.6.6.6, 5.6.7.8"), 1)).toBe("5.6.7.8");
    expect(getClientIp(xff("1.1.1.1, 2.2.2.2, 3.3.3.3, 5.6.7.8"), 1)).toBe("5.6.7.8");
  });

  it("with one trusted proxy, a single overwritten entry is the client", () => {
    expect(getClientIp(xff("5.6.7.8"), 1)).toBe("5.6.7.8");
  });

  it("with two trusted proxies, skips the proxy-appended entry to reach the client", () => {
    // Client 5.6.7.8 -> proxy 10.0.0.1 -> proxy 10.0.0.2 -> app.
    expect(getClientIp(xff("5.6.7.8, 10.0.0.1"), 2)).toBe("5.6.7.8");
  });

  it("with two trusted proxies, ignores attacker prefixes in a multi-proxy chain", () => {
    expect(getClientIp(xff("6.6.6.6, 7.7.7.7, 5.6.7.8, 10.0.0.1"), 2)).toBe("5.6.7.8");
  });

  it("returns unknown when the chain is shorter than the trusted hop count", () => {
    // Request did not traverse the two expected proxies; do not trust the value.
    expect(getClientIp(xff("5.6.7.8"), 2)).toBe(UNKNOWN_CLIENT_IP);
  });

  it.each([
    ["not-an-ip", "garbage"],
    ["host name", "api.example.com"],
    ["ip with port", "1.2.3.4:5678"],
    ["empty entry", "1.2.3.4, "],
    ["ip with path", "1.2.3.4/32"],
  ])("returns unknown for malformed address (%s)", (_label, value) => {
    expect(getClientIp(xff(value), 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("returns unknown when the selected entry is malformed even if others are valid", () => {
    // Trusted entry (rightmost for N=1) is malformed; the valid prefix must not be used.
    expect(getClientIp(xff("1.2.3.4, bogus"), 1)).toBe(UNKNOWN_CLIENT_IP);
  });

  it("trims whitespace around the selected entry", () => {
    expect(getClientIp(xff("  10.0.0.1  ,  5.6.7.8  "), 1)).toBe("5.6.7.8");
  });

  it("accepts and lower-cases IPv6 addresses", () => {
    expect(getClientIp(xff("1.1.1.1, 2001:DB8::1"), 1)).toBe("2001:db8::1");
  });

  it("reads TRUSTED_PROXY_COUNT when no count is passed", () => {
    const original = process.env.TRUSTED_PROXY_COUNT;
    try {
      process.env.TRUSTED_PROXY_COUNT = "1";
      expect(getClientIp(xff("6.6.6.6, 5.6.7.8"))).toBe("5.6.7.8");
      delete process.env.TRUSTED_PROXY_COUNT;
      expect(getClientIp(xff("6.6.6.6, 5.6.7.8"))).toBe(UNKNOWN_CLIENT_IP);
    } finally {
      if (original === undefined) delete process.env.TRUSTED_PROXY_COUNT;
      else process.env.TRUSTED_PROXY_COUNT = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Preset configs — sanity checks
// ---------------------------------------------------------------------------

describe("preset configs", () => {
  it("LOGIN_RATE_LIMIT allows 5 requests then denies", () => {
    _resetStore();
    for (let i = 0; i < LOGIN_RATE_LIMIT.limit; i++) {
      expect(checkRateLimit("login:x", LOGIN_RATE_LIMIT).allowed).toBe(true);
    }
    expect(checkRateLimit("login:x", LOGIN_RATE_LIMIT).allowed).toBe(false);
  });

  it("SENSITIVE_RATE_LIMIT has higher limit than LOGIN", () => {
    expect(SENSITIVE_RATE_LIMIT.limit).toBeGreaterThan(LOGIN_RATE_LIMIT.limit);
  });

  it("intake presets are bounded per IP and per token", () => {
    expect(INTAKE_IP_RATE_LIMIT.limit).toBeGreaterThan(0);
    expect(INTAKE_TOKEN_RATE_LIMIT.limit).toBeGreaterThan(0);
    expect(INTAKE_TOKEN_RATE_LIMIT.limit).toBeLessThanOrEqual(INTAKE_IP_RATE_LIMIT.limit);
  });

  it("GENERAL_RATE_LIMIT has higher limit than SENSITIVE", () => {
    expect(GENERAL_RATE_LIMIT.limit).toBeGreaterThan(
      SENSITIVE_RATE_LIMIT.limit
    );
  });
});
