import fs from "node:fs";
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
