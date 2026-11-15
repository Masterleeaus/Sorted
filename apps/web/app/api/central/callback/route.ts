import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import {
  CENTRAL_CALLBACK_PATH,
  CENTRAL_LOGIN_COOKIE,
  finishCentralSignIn,
} from "@/lib/central/sorted-sign-in";

export const dynamic = "force-dynamic";

/**
 * Completes Titan Central sign-in. Returns 404 unless TITAN_SORTED_CENTRAL_ENABLED is "true".
 * On success it issues the same session cookie as the existing login route.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const result = await finishCentralSignIn({
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
    pendingCookie: request.cookies.get(CENTRAL_LOGIN_COOKIE)?.value,
  });

  if (result.kind === "disabled") {
    return new NextResponse(null, { status: 404 });
  }

  const destination = result.kind === "signed_in" ? "/" : "/login?error=central_sign_in";
  const response = NextResponse.redirect(new URL(destination, request.url), { status: 302 });
  response.cookies.set(CENTRAL_LOGIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: CENTRAL_CALLBACK_PATH,
    maxAge: 0,
  });

  if (result.kind === "signed_in") {
    // Same session code the password login uses. setSessionCookie writes through
    // next/headers, which route handlers merge into the returned redirect.
    const token = await createSession({
      userId: result.user.userId,
      accountId: result.user.accountId,
      role: result.user.role,
    });
    await setSessionCookie(token);
  }
  return response;
}
