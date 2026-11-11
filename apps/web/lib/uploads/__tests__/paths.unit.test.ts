import { describe, it, expect } from "vitest";
import path from "path";
import {
  imageExtensionForMime,
  isSafePathSegment,
  isStoredFilename,
  resolveStoredUpload,
  sanitizeDisplayName,
} from "../paths";

const ROOT = "/app/uploads/visits";
const UUID = "3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b";

const HOSTILE = [
  "../../../etc/passwd",
  "..\\..\\..\\etc\\passwd",
  "a/b/c.jpg",
  "a\\b\\c.jpg",
  "..",
  ".",
  "....//....//x.jpg",
  "shot.jpg/../../escape",
  "shot.jpg\0.png",
];

describe("imageExtensionForMime", () => {
  it("maps allowed image types to constant extensions", () => {
    expect(imageExtensionForMime("image/jpeg")).toBe("jpg");
    expect(imageExtensionForMime("image/png")).toBe("png");
    expect(imageExtensionForMime("image/heic")).toBe("heic");
  });

  it("returns null for anything else, including prototype keys", () => {
    expect(imageExtensionForMime("text/plain")).toBeNull();
    expect(imageExtensionForMime("constructor")).toBeNull();
    expect(imageExtensionForMime("__proto__")).toBeNull();
    expect(imageExtensionForMime("")).toBeNull();
  });
});

describe("isSafePathSegment", () => {
  it("accepts ids", () => {
    expect(isSafePathSegment(UUID)).toBe(true);
  });

  it.each([["..", "."], ["a/b", "a\\b", "..%2F..", "x y", "", "a.b", "a\0"]])(
    "rejects %s",
    (...values) => {
      for (const v of values) expect(isSafePathSegment(v)).toBe(false);
    },
  );
});

describe("resolveStoredUpload", () => {
  it("resolves a normal stored file beneath the root", () => {
    const resolved = resolveStoredUpload(ROOT, UUID, `${UUID}.jpg`);
    expect(resolved).toBe(path.join(ROOT, UUID, `${UUID}.jpg`));
  });

  it.each(HOSTILE)("rejects hostile stored filename %j", (name) => {
    expect(resolveStoredUpload(ROOT, UUID, name)).toBeNull();
  });

  it.each(["../../etc/passwd", "..", "../visit", "a/b", "..%2Fx", ""])(
    "rejects hostile owner id %j",
    (id) => {
      expect(resolveStoredUpload(ROOT, id, "file.jpg")).toBeNull();
    },
  );

  it("rejects filenames with extension junk that is not an alphanumeric extension", () => {
    expect(isStoredFilename("name.tar.gz")).toBe(false);
    expect(isStoredFilename("name.j/pg")).toBe(false);
    expect(resolveStoredUpload(ROOT, UUID, "name.tar.gz")).toBeNull();
  });

  it("accepts legacy alphanumeric extensions that came from older uploads", () => {
    expect(resolveStoredUpload(ROOT, UUID, `${UUID}.JPEG`)).not.toBeNull();
  });
});

describe("sanitizeDisplayName", () => {
  it("keeps only the last path component for either separator", () => {
    expect(sanitizeDisplayName("../../etc/passwd.jpg")).toBe("passwd.jpg");
    expect(sanitizeDisplayName("..\\..\\win\\hosts.png")).toBe("hosts.png");
    expect(sanitizeDisplayName("a/b/c.jpg")).toBe("c.jpg");
  });

  it("drops leading dots and control characters", () => {
    expect(sanitizeDisplayName("..hidden.jpg")).toBe("hidden.jpg");
    expect(sanitizeDisplayName("ok\r\n.jpg")).toBe("ok.jpg");
  });

  it("falls back for empty or dot-only names", () => {
    expect(sanitizeDisplayName("..")).toBe("upload");
    expect(sanitizeDisplayName("/")).toBe("upload");
    expect(sanitizeDisplayName("")).toBe("upload");
    expect(sanitizeDisplayName(null)).toBe("upload");
  });

  it("caps the length", () => {
    expect(sanitizeDisplayName("a".repeat(400)).length).toBe(255);
  });
});
