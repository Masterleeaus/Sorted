import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const runtimeDir = dirname(fileURLToPath(import.meta.url));
const runtimeFiles = (await readdir(runtimeDir)).filter(name => name.endsWith(".mjs") && !name.endsWith(".test.mjs"));

test("every active onboarding runtime module imports from a clean workspace", async () => {
  assert.ok(runtimeFiles.length >= 8, "the runtime inventory includes all active modules");
  for (const name of runtimeFiles) {
    const source = await readFile(join(runtimeDir, name), "utf8");
    for (const specifier of source.matchAll(/(?:from\s*|import\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = resolve(runtimeDir, specifier[1]);
      await assert.doesNotReject(() => import(pathToFileURL(target).href), `${name} -> ${specifier[1]}`);
    }
    await assert.doesNotReject(() => import(pathToFileURL(join(runtimeDir, name)).href), name);
  }
});
