import { sign, type KeyObject } from "node:crypto";

/**
 * Compact JWS helpers written for the harness, independent of the package under test,
 * so that fixture tokens are not produced by the code they check.
 */

export function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function signCompactEdDSA(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  privateKey: KeyObject,
): string {
  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = sign(null, Buffer.from(signingInput, "ascii"), privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Applies a fixture patch: `null` deletes a member, any other value sets it. */
export function applyPatch(base: Record<string, unknown>, patch: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}
