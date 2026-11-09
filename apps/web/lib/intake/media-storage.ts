import path from "path";
import { UPLOAD_ROOT, resolveStoredUpload } from "@/lib/uploads/paths";

/** Private intake media is not served from /public or through static Next routes. */
export const INTAKE_MEDIA_ROOT = path.join(UPLOAD_ROOT, "intake");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STORED_PHOTO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif|heic|heif)$/i;

/** Reject legacy caller-provided paths and require server-generated photo names. */
export function intakeMediaFilePath(inviteId: string, filename: string): string | null {
  if (!UUID.test(inviteId) || !STORED_PHOTO.test(filename)) return null;
  return resolveStoredUpload(INTAKE_MEDIA_ROOT, inviteId, filename);
}
