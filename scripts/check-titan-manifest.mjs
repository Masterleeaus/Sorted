#!/usr/bin/env node
/**
 * Titan donor provenance report (issue #9). Report-only, non-blocking.
 * Not wired into CI. Uses Node built-ins only (no dependencies).
 *
 * Checks docs/generated/titan-donor-manifest.json against the working tree:
 *   1. Every manifest path (donor file, integrated copy, declared extra copy)
 *      exists and still has the recorded sha256. Mismatch or missing = error.
 *   2. Duplicate-content groups under the scanned roots that the manifest
 *      does not declare = warning ("unexpected duplicate").
 *   3. Bundle-like files under packages/titan-platform/src that are not listed
 *      in docs/generated/bundled-assets-provenance.md = warning.
 *
 * Usage:
 *   node scripts/check-titan-manifest.mjs [--root <dir>]
 *
 * Exit code: 1 when there are errors (checksum drift or missing files).
 * Warnings (unexpected duplicates) never change the exit code.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST_REL = "docs/generated/titan-donor-manifest.json";
/** Trees whose content-duplicates are scanned for undeclared copies. */
const SCAN_ROOTS = ["titan-donor", "packages/titan-platform/src", "packages/workforce"];
const SKIP_DIRS = new Set(["node_modules", ".git", ".test-dist", ".cleaning-test-dist", "dist"]);

function parseArgs(argv) {
  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let root = defaultRoot;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      root = path.resolve(argv[i + 1] ?? "");
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return { root };
}

function sha256File(absPath) {
  return crypto.createHash("sha256").update(fs.readFileSync(absPath)).digest("hex");
}

function walkFiles(absDir, out = []) {
  if (!fs.existsSync(absDir)) return out;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(path.join(absDir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(absDir, entry.name));
    }
  }
  return out;
}

function toRel(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function checkDeclaredPath(root, relPath, expectedSha, label, errors) {
  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) {
    errors.push(`${label}: missing file ${relPath}`);
    return;
  }
  const actual = sha256File(abs);
  if (actual !== expectedSha) {
    errors.push(`${label}: checksum drift ${relPath} (manifest ${expectedSha.slice(0, 12)}, actual ${actual.slice(0, 12)})`);
  }
}

const ASSET_DOC_REL = "docs/generated/bundled-assets-provenance.md";
const BUNDLE_PATTERNS = [/\.iife\.[^/]+$/, /\/assets\/[^/]+$/, /\.compat\.(ts|js|css)$/, /\.min\.(ts|js|mjs|css)$/, /\.bundle\.json$/];
const LARGE_FILE_BYTES = 1_000_000;

/** Bundle-like files under the Titan platform source that the provenance inventory does not list. */
function checkBundleCoverage(root, warnings) {
  const docPath = path.join(root, ASSET_DOC_REL);
  const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, "utf8") : "";
  for (const abs of walkFiles(path.join(root, "packages/titan-platform/src"))) {
    const rel = toRel(root, abs);
    const bundleLike = BUNDLE_PATTERNS.some((re) => re.test(rel)) || fs.statSync(abs).size >= LARGE_FILE_BYTES;
    if (bundleLike && !doc.includes("`" + rel + "`")) {
      warnings.push(`unlisted bundle asset (add to ${ASSET_DOC_REL}): ${rel}`);
    }
  }
}

export function runCheck(root) {
  const errors = [];
  const warnings = [];
  const manifestPath = path.join(root, MANIFEST_REL);
  if (!fs.existsSync(manifestPath)) {
    return { errors: [`manifest not found: ${MANIFEST_REL}`], warnings, summary: {} };
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const declared = new Set();

  // 1. Manifest entries: checksums and existence.
  for (const entry of manifest.entries) {
    declared.add(entry.donorPath);
    checkDeclaredPath(root, entry.donorPath, entry.sha256, "donor", errors);
    if (entry.integratedPath) {
      declared.add(entry.integratedPath);
      if (entry.status === "imported-modified") {
        // Locally edited after import: check against the recorded integrated checksum.
        checkDeclaredPath(root, entry.integratedPath, entry.integratedSha256, "integrated", errors);
      } else {
        checkDeclaredPath(root, entry.integratedPath, entry.sha256, "integrated", errors);
      }
    }
    for (const extra of entry.otherIdenticalPaths ?? []) {
      declared.add(extra);
      checkDeclaredPath(root, extra, entry.sha256, "declared copy", errors);
    }
  }
  for (const group of manifest.knownInternalDuplicateGroups ?? []) {
    for (const p of group.paths) {
      declared.add(p);
      checkDeclaredPath(root, p, group.sha256, "known duplicate", errors);
    }
  }

  // 2. Undeclared duplicate content under the scanned roots.
  const byHash = new Map();
  let scannedFiles = 0;
  for (const scanRoot of SCAN_ROOTS) {
    for (const abs of walkFiles(path.join(root, scanRoot))) {
      scannedFiles += 1;
      const rel = toRel(root, abs);
      const h = sha256File(abs);
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(rel);
    }
  }
  checkBundleCoverage(root, warnings);
  let unexpectedGroups = 0;
  for (const [h, paths] of byHash) {
    if (paths.length < 2) continue;
    const undeclared = paths.filter((p) => !declared.has(p));
    if (undeclared.length === 0) continue;
    unexpectedGroups += 1;
    warnings.push(
      `unexpected duplicate (${h.slice(0, 12)}): ${paths.sort().join(", ")}`,
    );
  }

  return {
    errors,
    warnings,
    summary: {
      manifestEntries: manifest.entries.length,
      statusCounts: manifest.statusCounts,
      declaredPaths: declared.size,
      scannedFiles,
      unexpectedDuplicateGroups: unexpectedGroups,
    },
  };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const { errors, warnings, summary } = runCheck(root);
  console.log("Titan donor manifest report (non-blocking)");
  console.log(`Root: ${root}`);
  for (const e of errors) console.log(`ERROR   ${e}`);
  for (const w of warnings) console.log(`WARN    ${w}`);
  console.log(`Summary: ${JSON.stringify(summary)}`);
  console.log(errors.length ? `Result: ${errors.length} error(s)` : "Result: checksums match");
  process.exitCode = errors.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
