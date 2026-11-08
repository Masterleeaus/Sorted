import path from "path";
import { UPLOAD_ROOT, resolveStoredUpload } from "../uploads/paths";

export type VisitPhoto = {
  category: string;
  visitId: string;
  filename: string;
  mimeType: string;
};

/** After shots first — that's what the customer should see on the bill. Cap at 4. */
export function selectDayPhotoRecap(photos: VisitPhoto[], limit = 4): VisitPhoto[] {
  const after = photos.filter((p) => p.category === "after");
  const before = photos.filter((p) => p.category === "before");
  return [...after, ...before].slice(0, limit);
}

/** Absolute path of a stored visit photo, or null when the ids would leave the visits upload root. */
export function visitMediaPath(visitId: string, filename: string): string | null {
  return resolveStoredUpload(path.join(UPLOAD_ROOT, "visits"), visitId, filename);
}
