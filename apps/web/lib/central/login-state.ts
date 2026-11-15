/**
 * Sealed login transaction for the Central sign-in redirect.
 *
 * The state, nonce and PKCE verifier travel in a host-only, httpOnly cookie,
 * sealed with AES-256-GCM (lib/crypto, key from APP_ENCRYPTION_KEY). Sorted
 * never writes the unsealed values to the database, a log or the URL.
 */

import { decryptJson, encryptJson } from "@/lib/crypto";

export const LOGIN_STATE_COOKIE = "fsm_titan_login";
export const LOGIN_STATE_PATH = "/auth/titan";
export const LOGIN_STATE_MAX_AGE_SECONDS = 600;

export interface LoginTransaction {
  readonly state: string;
  readonly nonce: string;
  readonly verifier: string;
  /** Issued-at, seconds since epoch. */
  readonly iat: number;
}

export class LoginStateError extends Error {
  readonly code: "invalid_login_state" | "expired_login_state";

  constructor(code: "invalid_login_state" | "expired_login_state", message: string) {
    super(message);
    this.name = "LoginStateError";
    this.code = code;
  }
}

export function sealLoginTransaction(tx: LoginTransaction): string {
  return encryptJson(tx).toString("base64url");
}

export function openLoginTransaction(sealed: string | undefined, now: number): LoginTransaction {
  if (!sealed) throw new LoginStateError("invalid_login_state", "no login transaction");
  let tx: LoginTransaction;
  try {
    tx = decryptJson<LoginTransaction>(Buffer.from(sealed, "base64url"));
  } catch {
    throw new LoginStateError("invalid_login_state", "login transaction could not be opened");
  }
  if (
    typeof tx !== "object" || tx === null ||
    typeof tx.state !== "string" || typeof tx.nonce !== "string" ||
    typeof tx.verifier !== "string" || typeof tx.iat !== "number"
  ) {
    throw new LoginStateError("invalid_login_state", "login transaction is malformed");
  }
  if (now - tx.iat > LOGIN_STATE_MAX_AGE_SECONDS || tx.iat > now + 30) {
    throw new LoginStateError("expired_login_state", "login transaction has expired");
  }
  return tx;
}
