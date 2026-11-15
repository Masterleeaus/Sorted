import { describe, expect, it } from "vitest";
import { codeChallengeS256, generateCodeVerifier } from "./pkce";
import { CentralClientError } from "./errors";

describe("PKCE", () => {
  it("matches the RFC 7636 appendix B S256 vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("generates a 43 character base64url verifier from 32 random bytes", () => {
    const verifier = generateCodeVerifier(() => Buffer.alloc(32, 1));
    expect(verifier).toHaveLength(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallengeS256(verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects verifiers that are too short or use characters outside the RFC set", () => {
    expect(() => codeChallengeS256("short")).toThrow(CentralClientError);
    expect(() => codeChallengeS256("a".repeat(42) + "+")).toThrow(CentralClientError);
  });
});
