/**
 * Resolve where to send the user after a successful login.
 *
 * Titan Go is one PWA. Owners/admins land on the conversational Command
 * surface on every device; technicians land on Today. The legacy workspace
 * cookie is still readable for backward compatibility, but it no longer
 * changes the Titan Go landing destination.
 */

export type PostLoginRole = "owner" | "admin" | "tech" | string;

const COOKIE_MODE = "dv_ws_mode";
const COMMAND_ROOT = "/app";
const FIELD_WORK_ROOT = "/app/my-work";
export const CAPTURE_PATH = "/app/capture";

/** Open-redirect allowlist: honor `next` only when it is exactly /app/capture. */
export function allowlistedPostLoginNext(
  next: string | null | undefined,
): string | null {
  return next === CAPTURE_PATH ? CAPTURE_PATH : null;
}

export function loginRedirectForPath(pathname: string | null | undefined): string {
  return pathname === CAPTURE_PATH ? `/login?next=${CAPTURE_PATH}` : "/login";
}

export function pathnameFromHeaders(headerList: {
  get(name: string): string | null;
}): string {
  const candidates = [
    headerList.get("x-matched-path"),
    headerList.get("x-invoke-path"),
    headerList.get("next-url"),
    headerList.get("x-url"),
    headerList.get("x-forwarded-uri"),
    headerList.get("x-original-uri"),
    headerList.get("x-pathname"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const path =
        raw.startsWith("http://") || raw.startsWith("https://")
          ? new URL(raw).pathname
          : raw.split("?")[0];
      if (path) return path;
    } catch {
      continue;
    }
  }
  return "";
}

/** Legacy reader retained while old installs may still carry the cookie. */
export function readWorkspaceModeCookie(
  cookieSource: string | null | undefined,
): "field" | "office" | null {
  if (!cookieSource) return null;
  const m = cookieSource.match(new RegExp(`(?:^|; )${COOKIE_MODE}=([^;]*)`));
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  return v === "field" || v === "office" ? v : null;
}

export function resolvePostLoginHref(
  role: PostLoginRole,
  opts: { cookieHeader?: string | null; isPhone?: boolean; next?: string | null } = {},
): string {
  const allowedNext = allowlistedPostLoginNext(opts.next);
  if (allowedNext) return allowedNext;

  if (role === "tech") return FIELD_WORK_ROOT;
  return COMMAND_ROOT;
}
