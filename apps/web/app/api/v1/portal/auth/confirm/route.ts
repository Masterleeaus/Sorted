import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createPortalSession, PORTAL_SESSION_COOKIE } from "@/lib/portal/session";
import { appUrl } from "@/lib/email/mailer";

const SESSION_DAYS = 30;

// POST: atomically consume the magic link and create a session.
// Called from the /portal/auth/confirm page after explicit user interaction,
// ensuring prefetchers and email scanners never burn the token.
export async function POST(request: NextRequest) {
  const { token } = await request.json().catch(() => ({ token: null }));

  if (!token) {
    return NextResponse.redirect(new URL("/portal/login?error=invalid", appUrl()));
  }

  // Consumes the link in one statement through a bounded resolver (migration 204),
  // because clients is RLS-protected and no account is known yet.
  const rows = await query<{ client_id: string; portal_token: string }>(
    `SELECT client_id::text, portal_token::text
     FROM consume_portal_magic_link($1::uuid)`,
    [token]
  );

  if (rows.length === 0) {
    return NextResponse.redirect(new URL("/portal/login?error=expired", appUrl()));
  }

  const { client_id, portal_token } = rows[0];
  const sessionToken = await createPortalSession(client_id);

  const response = NextResponse.redirect(new URL(`/portal/${portal_token}`, appUrl()));
  response.cookies.set(PORTAL_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    path: "/",
  });

  return response;
}
