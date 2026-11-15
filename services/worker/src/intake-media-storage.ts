import path from "node:path";

/**
 * Storage boundary for intake photos, as seen by the worker.
 *
 * The worker cannot import apps/web, so these rules mirror
 * apps/web/lib/uploads/paths.ts (resolveStoredUpload) and
 * apps/web/lib/intake/media-storage.ts. The web side writes files to
 * <UPLOAD_ROOT>/intake/<invite id>/<uuid>.<ext>. Every path the worker deletes
 * goes through resolveIntakeMediaPath, so a bad row cannot point outside that tree.
 */

/** Same mount as the web app and the capture worker (/app/uploads). */
export const UPLOAD_ROOT = "/app/uploads";
export const INTAKE_MEDIA_ROOT = path.join(UPLOAD_ROOT, "intake");

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const STORED_FILENAME = /^[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9]{1,8}$/;

/** Resolved file path for a stored intake photo, or null if either part is unsafe. */
export function resolveIntakeMediaPath(
  inviteId: string,
  filename: string,
  root: string = INTAKE_MEDIA_ROOT,
): string | null {
  if (!SAFE_SEGMENT.test(inviteId) || !STORED_FILENAME.test(filename)) return null;
  const base = path.resolve(root);
  const resolved = path.resolve(base, inviteId, filename);
  if (!resolved.startsWith(base + path.sep)) return null;
  return resolved;
}
