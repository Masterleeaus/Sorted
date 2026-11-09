import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-only Node 24 action-policy guard. This never alters CI required checks.
 * Exported for deterministic tests without needing GitHub runner credentials.
 */
export function auditWorkflowActions(files) {
  const invalid = [];
  const modern = new Map([
    ["actions/checkout", "v7"],
    ["actions/setup-node", "v7"],
    ["pnpm/action-setup", "v6"],
    ["actions/upload-artifact", "v7"],
  ]);
  for (const [path, content] of files) {
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*-?\s*uses:\s*([\w.-]+\/[\w.-]+)@(v\d+)\s*$/);
      if (!match) continue;
      const expected = modern.get(match[1]);
      if (expected && match[2] !== expected) invalid.push(`${path}: ${match[1]}@${match[2]} must use ${expected}`);
    }
  }
  return invalid;
}

export function inspectWorkflowDirectory(directory = ".github/workflows") {
  return auditWorkflowActions(
    readdirSync(directory).filter(name => /\.ya?ml$/.test(name))
      .map(name => [join(directory, name), readFileSync(join(directory, name), "utf8")]),
  );
}

if (process.argv[1]?.endsWith("check-action-runtime.mjs")) {
  const failures = inspectWorkflowDirectory();
  if (failures.length) {
    for (const failure of failures) process.stderr.write(failure + "\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("GitHub Actions Node 24 action-version policy passed\n");
  }
}
