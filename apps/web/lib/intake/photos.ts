/**
 * Rules for customer photos attached to a public intake request.
 *
 * Shared by the upload route (server), the delete route, and the intake form
 * (client). Pure functions only: no Node or DOM APIs.
 */

export const MAX_INTAKE_PHOTOS = 8;
export const MAX_INTAKE_PHOTO_BYTES = 10 * 1024 * 1024;

export const INTAKE_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
] as const;

export type IntakePhotoMime = (typeof INTAKE_PHOTO_MIME_TYPES)[number];

export const INTAKE_PHOTO_ACCEPT = INTAKE_PHOTO_MIME_TYPES.join(",");

export function isIntakePhotoMime(value: string): value is IntakePhotoMime {
  return (INTAKE_PHOTO_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Check the declared type and size of a file before it is sent. Used by the
 * form for quick feedback. The server runs the same check again and also
 * checks the file's first bytes.
 */
export function validateIntakePhotoMeta(meta: { type: string; size: number }): string | null {
  if (!Number.isSafeInteger(meta.size) || meta.size <= 0) return "This photo is empty or invalid. Please choose another file.";
  if (meta.size > MAX_INTAKE_PHOTO_BYTES) return "This photo is larger than 10 MB. Please choose a smaller photo.";
  if (!isIntakePhotoMime(meta.type)) return "Only photos (JPG, PNG, WebP, GIF, HEIC) can be attached.";
  return null;
}

/**
 * Identify an image by its leading bytes. Returns the MIME type, or null when
 * the bytes do not match a supported image format. The client's declared type
 * is not trusted on its own.
 */
export function sniffIntakePhotoMime(bytes: Uint8Array): IntakePhotoMime | null {
  const startsWith = (sig: number[], offset = 0) =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  const ascii = (text: string, offset = 0) =>
    startsWith(Array.from(text, (c) => c.charCodeAt(0)), offset);

  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii("RIFF") && ascii("WEBP", 8)) return "image/webp";
  if (ascii("GIF87a") || ascii("GIF89a")) return "image/gif";
  if (ascii("ftyp", 4)) {
    const brand = bytes.length >= 12 ? String.fromCharCode(...bytes.slice(8, 12)) : "";
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

/** Extension used for the server-generated stored filename. */
export const INTAKE_PHOTO_EXTENSION: Record<IntakePhotoMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};
