import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const setupScript = resolve("scripts/setup-garonhome.sh");
test("first-time setup provisions mandatory uploads and backup health status locations", () => {
  const root = mkdtempSync(join(tmpdir(), "sorted-setup-fixture-"));
  const bin = join(root, "bin");
  const deployRoot = join(root, "deploy");
  mkdirSync(bin);
  writeFileSync(join(bin, "sudo"), `#!/usr/bin/env bash
if [[ "$1" == "mkdir" ]]; then shift; exec /bin/mkdir "$@"; fi
if [[ "$1" == "chown" ]]; then exit 0; fi
exit 3
`, { mode: 0o755 });
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash
if [[ "$1" == "network" && "$2" == "inspect" ]]; then exit 0; fi
exit 4
`, { mode: 0o755 });
  try {
    const env = {
      ...process.env,
      PATH: bin + ":" + process.env.PATH,
      FSM_DEPLOY_ROOT: deployRoot,
      PROXY_NETWORK: "test_proxy",
      USER: process.env.USER || "runner",
    };
    const first = spawnSync("bash", [setupScript], { encoding: "utf8", env, timeout: 10000 });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(existsSync(join(deployRoot, "data", "uploads")), true);
    assert.equal(existsSync(join(deployRoot, "backups", "status")), true);
    const target = join(deployRoot, "env", ".env");
    assert.equal(existsSync(target), true);
    writeFileSync(target, "PRESERVE_EXISTING=1\n");
    const second = spawnSync("bash", [setupScript], { encoding: "utf8", env, timeout: 10000 });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(readFileSync(target, "utf8"), "PRESERVE_EXISTING=1\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
