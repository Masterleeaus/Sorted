import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet } from "jose";
import { CentralConfigError, readCentralOidcConfig } from "@/lib/central/config";
import {
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_PATH,
  LoginStateError,
  openLoginTransaction,
} from "@/lib/central/login-state";
import {
  OidcError,
  exchangeAuthorizationCode,
  fetchDiscovery,
  stateMatches,
  verifyIdToken,
} from "@/lib/central/oidc";
import { organisationFromVerifiedClaims, TenantError } from "@/lib/central/tenant";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

function fail(code: string, status: number): NextResponse {
  const res = NextResponse.json({ error: { code } }, { status });
  res.cookies.set(LOGIN_STATE_COOKIE, "", { path: LOGIN_STATE_PATH, maxAge: 0, httpOnly: true });
  return res;
}

/**
 * Completes Central sign-in: checks state, exchanges the code with PKCE,
 * verifies the ID token for Sorted's audience, and checks the organisation claim.
 *
 * Creating a Sorted session needs a verified local account link, which the
 * product side does not provide yet (Central docs/LINKING.md). Until it does,
 * this route verifies and then refuses. It never creates a session from the
 * Central identity alone.
 */
export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has("error")) return fail("central_sign_in_denied", 400);
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code || !state) return fail("invalid_callback", 400);

  try {
    const config = readCentralOidcConfig(process.env);
    const tx = openLoginTransaction(request.cookies.get(LOGIN_STATE_COOKIE)?.value, Math.floor(Date.now() / 1000));
    if (!stateMatches(tx.state, state)) return fail("state_mismatch", 400);

    const discovery = await fetchDiscovery(config.origin, fetch);
    const { idToken } = await exchangeAuthorizationCode({
      discovery,
      config,
      code,
      verifier: tx.verifier,
      fetch,
    });
    const claims = await verifyIdToken({
      idToken,
      issuer: discovery.issuer,
      audience: config.audience,
      nonce: tx.nonce,
      jwks: createRemoteJWKSet(new URL(discovery.jwks_uri)),
      now: Math.floor(Date.now() / 1000),
    });
    organisationFromVerifiedClaims(claims as { org?: unknown });

    logger.warn("central sign-in verified; no local account link");
    return fail("account_link_required", 403);
  } catch (error) {
    if (error instanceof CentralConfigError) {
      logger.error("central sign-in not configured", undefined, { variable: error.variable });
      return fail("central_not_configured", 503);
    }
    if (error instanceof LoginStateError) return fail(error.code, 400);
    if (error instanceof OidcError) {
      logger.warn("central sign-in refused", { code: error.code });
      return fail(error.code === "token_exchange_failed" || error.code === "discovery_failed" ? "central_unavailable" : "invalid_id_token", 401);
    }
    if (error instanceof TenantError) return fail(error.code, 403);
    logger.error("central sign-in callback failed", error);
    return fail("central_unavailable", 503);
  }
}
