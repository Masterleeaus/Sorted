import fs from "node:fs";
import { MAX_INTAKE_PHOTO_BYTES } from "./photos";
import path from "node:path";

/**
 * Write a private media file only if every existing path component is a real
 * directory. A symlinked uploads parent could otherwise redirect writes outside
 * the configured storage boundary despite safe generated filenames.
 */
export function writePrivateIntakeFile(filePath: string, bytes: Uint8Array): void {
  const dir = path.dirname(filePath);
  const resolved = path.resolve(dir);
  const parts = resolved.split(path.sep).filter(Boolean);
  let current = path.parse(resolved).root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Private media storage path is not a directory");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fs.mkdirSync(current, { mode: 0o700 });
    }
  }
  fs.writeFileSync(filePath, bytes, { flag: "wx", mode: 0o600 });
}

/** Read only bounded regular files beneath real (non-symlinked) parent directories.
 * The caller must first enforce authenticated tenant and booking ownership.
 */
export function readPrivateIntakeFile(filePath: string): Uint8Array | null {
  const resolved = path.resolve(filePath);
  let directory = path.dirname(resolved);
  while (true) {
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    } catch { return null; }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  let fd: number | undefined;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_INTAKE_PHOTO_BYTES) return null;
    return new Uint8Array(fs.readFileSync(fd));
  } catch { return null; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** Only a real, regular file is removable; never follow a symlink. */
export function removePrivateIntakeFile(filePath: string): "deleted" | "missing" {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Refusing to remove nonregular intake media");
    }
    fs.unlinkSync(filePath);
    return "deleted";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}
