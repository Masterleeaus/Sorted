import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDistributionManifest,
  transitionDistribution,
  verifyDistributionArtifact,
} from "../.test-dist/distribution-gateway.js";

const expectedModule = 'export const fixture = "offline-only; no publisher or marketplace certification";\n';
const packageName = "@titan-zero/distribution-offline-fixture";

function npm(args, cwd, env) {
  return execFileSync("npm", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

test("DEVELOPER_SDK fixture packs, verifies, installs, and revokes locally without network access", async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), "titan-distribution-sdk-"));
  t.after(() => rm(scratch, { recursive: true, force: true }));

  const packageRoot = path.join(scratch, "package");
  const firstPack = path.join(scratch, "pack-one");
  const secondPack = path.join(scratch, "pack-two");
  const installRoot = path.join(scratch, "consumer");
  const cache = path.join(scratch, "npm-cache");
  await Promise.all([
    mkdir(path.join(packageRoot, "dist"), { recursive: true }),
    mkdir(firstPack, { recursive: true }),
    mkdir(secondPack, { recursive: true }),
    mkdir(installRoot),
    mkdir(cache),
  ]);
  await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    license: "UNLICENSED",
    files: ["dist"],
    exports: { ".": "./dist/index.js" },
  }, null, 2));
  await writeFile(path.join(packageRoot, "dist", "index.js"), expectedModule);
  await writeFile(
    path.join(installRoot, "package.json"),
    JSON.stringify({ name: "offline-consumer-fixture", version: "1.0.0", private: true }),
  );

  const env = {
    ...process.env,
    npm_config_cache: cache,
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  const packArgs = (destination) => [
    "pack",
    "--offline",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    destination,
  ];
  const firstPackInfo = JSON.parse(npm(packArgs(firstPack), packageRoot, env))[0];
  const secondPackInfo = JSON.parse(npm(packArgs(secondPack), packageRoot, env))[0];
  assert.equal(firstPackInfo.filename, secondPackInfo.filename);

  const firstArtifact = await readFile(path.join(firstPack, firstPackInfo.filename));
  const secondArtifact = await readFile(path.join(secondPack, secondPackInfo.filename));
  assert.deepEqual(firstArtifact, secondArtifact, "local package generation is byte-reproducible");

  const artifact_hash = "sha256:" + createHash("sha256").update(firstArtifact).digest("hex");
  const manifest = createDistributionManifest({
    manifest_id: "fixture:developer-sdk:v1",
    company_id: "fixture-company",
    product_ref: "fixture-product:v1",
    vertical_ref: "fixture-vertical:v1",
    tier_ref: "fixture-tier:v1",
    platform: "DEVELOPER_SDK",
    capability_ids: ["fixture.read"],
    contract_versions: ["fixture-api:v1"],
    artifact_hash,
    provenance_ref: "fixture-source:sha256:offline",
  });
  const verified = verifyDistributionArtifact(manifest, firstArtifact);
  assert.equal(verified.state, "VERIFIED");
  const tampered = Buffer.from(firstArtifact);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => verifyDistributionArtifact(manifest, tampered), /artifact-hash-mismatch/);

  // Publication states below are an in-memory fixture only. npm stays offline;
  // no registry, marketplace, publisher account, or real adapter is contacted.
  const ready = transitionDistribution(verified, "READY_TO_SUBMIT");
  const submitted = transitionDistribution(ready, "SUBMITTED");
  const reviewing = transitionDistribution(submitted, "REVIEWING");
  const publishedFixture = transitionDistribution(reviewing, "PUBLISHED");

  npm([
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    path.join(firstPack, firstPackInfo.filename),
  ], scratch, env);

  const installedModule = await readFile(
    path.join(installRoot, "node_modules", "@titan-zero", "distribution-offline-fixture", "dist", "index.js"),
    "utf8",
  );
  assert.equal(installedModule, expectedModule);

  const revokedFixture = transitionDistribution(publishedFixture, "REVOKED");
  assert.equal(revokedFixture.state, "REVOKED");
  npm([
    "uninstall",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    "--prefix",
    installRoot,
    packageName,
  ], scratch, env);
  await assert.rejects(
    stat(path.join(installRoot, "node_modules", "@titan-zero", "distribution-offline-fixture")),
    { code: "ENOENT" },
  );
  assert.throws(() => transitionDistribution(revokedFixture, "PUBLISHED"), /distribution-transition-invalid/);
});
