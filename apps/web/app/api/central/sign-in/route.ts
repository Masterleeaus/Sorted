import { NextResponse } from "next/server";
import {
  CENTRAL_LOGIN_COOKIE,
  CENTRAL_LOGIN_COOKIE_MAX_AGE_SECONDS,
  CENTRAL_CALLBACK_PATH,
  startCentralSignIn,
} from "@/lib/central/sorted-sign-in";

export const dynamic = "force-dynamic";

/** Starts Titan Central sign-in. Returns 404 unless TITAN_SORTED_CENTRAL_ENABLED is "true". */
export async function GET() {
  const result = await startCentralSignIn();

  if (result.kind === "disabled") {
    return new NextResponse(null, { status: 404 });
  }
  if (result.kind === "unavailable") {
    return NextResponse.json({ error: { code: "CENTRAL_UNAVAILABLE", message: "Sign-in is unavailable" } }, { status: 503 });
  }

  const response = NextResponse.redirect(result.location, { status: 302 });
  response.cookies.set(CENTRAL_LOGIN_COOKIE, result.pendingCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: CENTRAL_CALLBACK_PATH,
    maxAge: CENTRAL_LOGIN_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
