import { createHash, randomBytes } from "node:crypto";
import { CentralClientError } from "./errors";

/** RFC 7636 section 4.1: 43 to 128 characters from the unreserved set. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export type RandomBytesSource = (size: number) => Buffer;

/** 32 random bytes encode to a 43 character base64url verifier. */
export function generateCodeVerifier(random: RandomBytesSource = randomBytes): string {
  return random(32).toString("base64url");
}

/** S256 code challenge: base64url(SHA-256(ascii(verifier))). */
export function codeChallengeS256(verifier: string): string {
  if (!VERIFIER_PATTERN.test(verifier)) {
    throw new CentralClientError("pkce_invalid", "code verifier is malformed");
  }
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
