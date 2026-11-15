import path from "path";
import { UPLOAD_ROOT, resolveStoredUpload } from "@/lib/uploads/paths";

/** Intake photos live beside the other upload roots: <UPLOAD_ROOT>/intake/<invite id>/<file>. */
export const INTAKE_MEDIA_ROOT = path.join(UPLOAD_ROOT, "intake");

/** Resolved file path for a stored intake photo, or null if the parts are unsafe. */
export function intakeMediaFilePath(inviteId: string, filename: string): string | null {
  return resolveStoredUpload(INTAKE_MEDIA_ROOT, inviteId, filename);
}
