import { NextResponse, type NextRequest } from "next/server";

/**
 * Builds the global Content-Security-Policy.
 *
 * Production: no 'unsafe-eval'. Next.js production output and React's
 * production build do not evaluate strings.
 *
 * Development exceptions (only when NODE_ENV !== "production"):
 *   - 'unsafe-eval' in script-src: Next dev uses eval-based source maps and
 *     React dev call-stack reconstruction. Needed for `next dev` only.
 *
 * Still-broad allowances (see docs/working/csp-inventory.md):
 *   - script-src 'unsafe-inline': Next.js App Router emits inline bootstrap
 *     scripts. A nonce is blocked on dynamic rendering (see inventory doc).
 *   - style-src 'unsafe-inline': React `style={{}}` props across the app.
 */
export function buildContentSecurityPolicy(nodeEnv: string | undefined = process.env.NODE_ENV): string {
  const isDevelopment = nodeEnv !== "production";
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(isDevelopment ? ["'unsafe-eval'"] : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    // OpenStreetMap tiles for the day map (TASK-026) — external tile images.
    "img-src 'self' data: https://*.tile.openstreetmap.org",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

/**
 * Next.js Edge Middleware — adds security response headers to every response.
 *
 * Runs at the Edge before route handlers. This is the canonical place for
 * response-level security controls that apply globally.
 */
export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // ── Security headers ──────────────────────────────────────────────
  // Prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");

  // Prevent MIME-type sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // Referrer policy — send origin only on cross-origin. Job report share
  // links (TASK-162) are bearer URLs: never leak them, never index them.
  const shareReport = request.nextUrl.pathname.startsWith("/portal/reports/");
  response.headers.set("Referrer-Policy", shareReport ? "no-referrer" : "strict-origin-when-cross-origin");
  if (shareReport) response.headers.set("X-Robots-Tag", "noindex, nofollow");

  // Permissions policy — disable unused browser features. Capture (TASK-115)
  // needs the microphone on this origin; keep it off everywhere else.
  const capturePage = request.nextUrl.pathname === "/app/capture";
  response.headers.set(
    "Permissions-Policy",
    capturePage
      ? "camera=(self), microphone=(self), geolocation=(), payment=()"
      : "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // Content-Security-Policy — see buildContentSecurityPolicy() above.
  response.headers.set("Content-Security-Policy", buildContentSecurityPolicy());

  // Strict-Transport-Security — enforce HTTPS (respected by browsers after first visit)
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  return response;
}

/**
 * Match all routes except Next.js internals and static assets.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)",
  ],
};
