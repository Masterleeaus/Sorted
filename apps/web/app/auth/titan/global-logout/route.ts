import { NextResponse } from "next/server";
import { CentralConfigError, readCentralOidcConfig } from "@/lib/central/config";
import { globalLogoutUrl } from "@/lib/central/oidc";
import { clearSessionCookie } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Signs out of Sorted, then sends the browser to Central's global logout.
 * The local session cookie is cleared first, so a Central configuration
 * problem never leaves the Sorted session in place.
 */
export async function POST() {
  await clearSessionCookie();
  try {
    const config = readCentralOidcConfig(process.env);
    return NextResponse.redirect(globalLogoutUrl(config), 303);
  } catch (error) {
    if (error instanceof CentralConfigError) {
      logger.error("central global logout not configured", undefined, { variable: error.variable });
      return NextResponse.json(
        { signedOutLocally: true, signedOutCentrally: false, reason: "central_not_configured", variable: error.variable },
        { status: 503 },
      );
    }
    throw error;
  }
}
