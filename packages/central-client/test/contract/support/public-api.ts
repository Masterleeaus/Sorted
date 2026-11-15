import { it } from "vitest";

/**
 * The only seam between the contract harness and the package under test.
 * Tests reach the package through this module, and only by the names listed in
 * `contractTest(requires)`. A name that the package does not export makes its
 * tests pending (reported as todo, never silently passed).
 */

// Public entry of packages/central-client, relative to this file.
const PACKAGE_ENTRY = "../../../src/index.ts";

let entry: Record<string, unknown> = {};
let loadError: string | undefined;

try {
  entry = (await import(/* @vite-ignore */ PACKAGE_ENTRY)) as Record<string, unknown>;
} catch (error) {
  loadError = error instanceof Error ? error.message.split("\n")[0] : "unknown load error";
}

export const packageLoadError = loadError;

export function hasExport(name: string): boolean {
  return entry[name] !== undefined;
}

export function requireExport<T = unknown>(name: string): T {
  if (!hasExport(name)) throw new Error(`central-client does not export ${name}`);
  return entry[name] as T;
}

/**
 * Returns a test registrar. Tests run only when every named export exists;
 * otherwise they are reported as pending with the missing names in the title.
 */
export function contractTest(requires: readonly string[]) {
  const missing = requires.filter((name) => !hasExport(name));
  return (title: string, fn: () => unknown, timeout?: number) => {
    if (missing.length === 0) return it(title, fn, timeout);
    return it.todo(`${title} [pending: missing export ${missing.join(", ")}]`);
  };
}
