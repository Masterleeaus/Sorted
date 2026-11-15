// Generates the compiled output the tests import from:
//   .test-dist            entry modules listed in tsconfig.test.json (rootDir src)
//   .cleaning-test-dist   src/verticals/cleaning/*.ts            (rootDir src)
//   .licensed-trades-test-dist  src/verticals/licensed-trades/*.ts (rootDir src/verticals/licensed-trades)
//   .lifecycle-test-dist  src/workforce-lifecycle/*.ts           (rootDir src)
//   .context-test-dist    src/workforce-context/*.ts             (rootDir src/workforce-context)
//
// tsc emits JavaScript even when it reports type errors. Exit code 2 means
// "diagnostics present, outputs generated": the diagnostics are printed and the
// build continues so the tests can load. Any other non-zero exit fails the build.

import { readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = process.platform === "win32" ? "tsc.cmd" : "tsc";
const TOLERATED_EXIT_CODES = new Set([0, 2]);

const sourceFiles = (dir) =>
  readdirSync(join(packageRoot, dir))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => `${dir}/${name}`);

const explicitFlags = [
  "--target", "ES2022",
  "--module", "NodeNext",
  "--moduleResolution", "NodeNext",
  "--strict",
  "--skipLibCheck",
];

const groups = [
  {
    name: "test-dist",
    outDir: ".test-dist",
    args: [
      "-p", "tsconfig.test.json",
      "--noEmit", "false",
      "--outDir", ".test-dist",
      "--module", "NodeNext",
      "--moduleResolution", "NodeNext",
      "--isolatedModules", "false",
    ],
  },
  {
    name: "cleaning-test-dist",
    outDir: ".cleaning-test-dist",
    args: [...explicitFlags, "--rootDir", "src", "--outDir", ".cleaning-test-dist",
      ...sourceFiles("src/verticals/cleaning")],
  },
  {
    name: "licensed-trades-test-dist",
    outDir: ".licensed-trades-test-dist",
    args: [...explicitFlags, "--rootDir", "src/verticals/licensed-trades", "--outDir", ".licensed-trades-test-dist",
      ...sourceFiles("src/verticals/licensed-trades")],
  },
  {
    name: "lifecycle-test-dist",
    outDir: ".lifecycle-test-dist",
    args: [...explicitFlags, "--rootDir", "src", "--outDir", ".lifecycle-test-dist",
      ...sourceFiles("src/workforce-lifecycle")],
  },
  {
    name: "context-test-dist",
    outDir: ".context-test-dist",
    args: [...explicitFlags, "--rootDir", "src/workforce-context", "--outDir", ".context-test-dist",
      ...sourceFiles("src/workforce-context")],
  },
];

for (const group of groups) {
  rmSync(join(packageRoot, group.outDir), { recursive: true, force: true });
}

let failed = false;
for (const group of groups) {
  console.log(`[build-test-outputs] ${group.name} -> ${group.outDir}`);
  const result = spawnSync(tsc, group.args, {
    cwd: packageRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error || !TOLERATED_EXIT_CODES.has(result.status)) {
    console.error(`[build-test-outputs] ${group.name} failed (exit ${result.status ?? result.error?.message})`);
    failed = true;
    break;
  }
  if (result.status === 2) {
    console.warn(`[build-test-outputs] ${group.name} emitted with type diagnostics (see above)`);
  }
}

process.exit(failed ? 1 : 0);
