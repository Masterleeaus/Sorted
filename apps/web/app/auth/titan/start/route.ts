import { NextResponse } from "next/server";
import { CentralConfigError, readCentralOidcConfig } from "@/lib/central/config";
import { createAuthorizationRequest, fetchDiscovery } from "@/lib/central/oidc";
import {
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  LOGIN_STATE_PATH,
  sealLoginTransaction,
} from "@/lib/central/login-state";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/** Starts sign-in through Central: PKCE, state and nonce, sealed in a host-only cookie. */
export async function GET() {
  try {
    const config = readCentralOidcConfig(process.env);
    const discovery = await fetchDiscovery(config.origin, fetch);
    const request = createAuthorizationRequest(discovery, config);

    const res = NextResponse.redirect(request.url, 303);
    res.cookies.set(LOGIN_STATE_COOKIE, sealLoginTransaction({
      state: request.state,
      nonce: request.nonce,
      verifier: request.verifier,
      iat: Math.floor(Date.now() / 1000),
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: LOGIN_STATE_PATH,
      maxAge: LOGIN_STATE_MAX_AGE_SECONDS,
    });
    return res;
  } catch (error) {
    if (error instanceof CentralConfigError) {
      logger.error("central sign-in not configured", undefined, { variable: error.variable });
      return NextResponse.json(
        { error: { code: "central_not_configured", variable: error.variable } },
        { status: 503 },
      );
    }
    logger.error("central sign-in start failed", error);
    return NextResponse.json({ error: { code: "central_unavailable" } }, { status: 503 });
  }
}
