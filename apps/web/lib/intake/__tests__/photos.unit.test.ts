import { describe, it, expect } from "vitest";
import {
  MAX_INTAKE_PHOTO_BYTES,
  sniffIntakePhotoMime,
  validateIntakePhotoMeta,
} from "../photos";

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));

describe("validateIntakePhotoMeta", () => {
  it("accepts an allowed type within the size limit", () => {
    expect(validateIntakePhotoMeta({ type: "image/jpeg", size: 1024 })).toBeNull();
    expect(validateIntakePhotoMeta({ type: "image/heic", size: MAX_INTAKE_PHOTO_BYTES })).toBeNull();
  });

  it("rejects an empty file", () => {
    expect(validateIntakePhotoMeta({ type: "image/png", size: 0 })).toMatch(/empty/);
  });

  it("rejects a file over 10 MB", () => {
    expect(validateIntakePhotoMeta({ type: "image/png", size: MAX_INTAKE_PHOTO_BYTES + 1 })).toMatch(/10 MB/);
  });

  it("rejects a non-image type, including a missing type", () => {
    expect(validateIntakePhotoMeta({ type: "application/pdf", size: 10 })).toMatch(/Only photos/);
    expect(validateIntakePhotoMeta({ type: "", size: 10 })).toMatch(/Only photos/);
    expect(validateIntakePhotoMeta({ type: "image/svg+xml", size: 10 })).toMatch(/Only photos/);
  });
});

describe("sniffIntakePhotoMime", () => {
  it("identifies JPEG, PNG, WebP, GIF, HEIC and HEIF by their leading bytes", () => {
    expect(sniffIntakePhotoMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffIntakePhotoMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe("image/png");
    expect(sniffIntakePhotoMime(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))).toBe("image/webp");
    expect(sniffIntakePhotoMime(new Uint8Array(ascii("GIF89a")))).toBe("image/gif");
    expect(sniffIntakePhotoMime(new Uint8Array([0, 0, 0, 24, ...ascii("ftypheic")]))).toBe("image/heic");
    expect(sniffIntakePhotoMime(new Uint8Array([0, 0, 0, 24, ...ascii("ftypmif1")]))).toBe("image/heif");
  });

  it("returns null for a text file, an empty file and a truncated header", () => {
    expect(sniffIntakePhotoMime(new Uint8Array(ascii("hello, this is not a photo")))).toBeNull();
    expect(sniffIntakePhotoMime(new Uint8Array(0))).toBeNull();
    expect(sniffIntakePhotoMime(bytes(0xff, 0xd8))).toBeNull();
  });

  it("returns null for an ftyp box with a non-image brand (e.g. MP4)", () => {
    expect(sniffIntakePhotoMime(new Uint8Array([0, 0, 0, 24, ...ascii("ftypisom")]))).toBeNull();
  });
});
