# Titan donor provenance and canonical trees

Status: working note for issue #9. Date: 2026-11-08.
Machine-readable map: `docs/generated/titan-donor-manifest.json`.
Check (report only, not in CI): `pnpm check:titan-manifest`.

## Which tree is canonical

| Tree | Role | May edit? |
| --- | --- | --- |
| `packages/titan-platform/src/` (incl. `src/ported/`) | **Build source** for the Titan platform package. Its `package.json` exports, its `tsconfig.json` and `apps/web` imports of `@titan-zero/titan-platform` all resolve here. | Yes. All updates go here. |
| `apps/web/app/titan/`, `apps/web/lib/titan/`, `apps/web/app/api/v1/titan/`, `apps/web/app/app/` | Build source for the web app's Titan surfaces (byte-identical to donor `workforce/apps/web` files, mostly with the `workforce/` prefix dropped). | Yes. |
| `titan-donor/` | **Preserved evidence only.** Nothing in the repo imports, builds or exports from it (checked by search of all tracked files). | No. Do not edit. Do not delete in this pass. |
| `packages/workforce/` | **Retired** copy. Its own `package.json` says `status: retired`, `production: false`, canonical owner `services/workforce`. No importers. | No new edits. Removal is a separate decision (see issue #4). |

Evidence for the choice:

- `packages/titan-platform/package.json` exports point at `./src/...`, and `./src/ported/...` for the `titan-connect` and `ai-core` subpaths.
- `packages/titan-platform/tsconfig.json` lists `src/ported/...` files.
- No tracked file references the string `titan-donor` outside that folder.
- All 250 donor files under `titan-donor/workforce/packages/titan-platform/src/` are byte-identical to the file at the same relative path under `packages/titan-platform/src/`.

## What the manifest records

One entry per donor file (371 total):

- `donorPath`, `bytes`, `sha256` of the donor file.
- `status`:
  - `imported-identical`: 250. Same relative path under `packages/titan-platform/src/`.
  - `imported-identical-relocated`: 78. Same bytes at another tracked path, mostly under `apps/web`.
  - `not-integrated`: 43. No identical tracked copy. Includes `services/workforce` source (31 files), which is not in this repo, plus a few `ui/` and `postgres-zero-patch-backup/` files.
- `integratedPath`: the copy builds use, or null.
- `otherIdenticalPaths`: other tracked copies, including the retired `packages/workforce/` copies.

The manifest also lists 7 `knownInternalDuplicateGroups` inside `packages/titan-platform/src/ported/` (locale files and two JSON pairs). These are kept, not deleted.

## Check behaviour

`scripts/check-titan-manifest.mjs` (Node built-ins only):

1. Errors (exit 1): a manifest path is missing, or its sha256 no longer matches. A change to an integrated copy is drift on purpose. Re-hash it in the manifest in the same change, and say why in the commit.
2. Warnings (exit 0): content duplicates under `titan-donor/`, `packages/titan-platform/src/` and `packages/workforce/` that include a file the manifest does not declare.

Use `--root <dir>` to point it at a copy, for example a fixture in a scratch folder.

## Import and update process

1. Bring new donor material into `titan-donor/` only as evidence, with its source named in the commit message.
2. Copy the file that builds should use into `packages/titan-platform/src/` (or the app tree). Edit only that copy.
3. Add or update the manifest entry: `donorPath`, `sha256`, `bytes`, `status`, `integratedPath`.
4. Run `pnpm check:titan-manifest`. It must report 0 errors. Read any warnings.
5. Do not remove a donor file or an integrated copy in the same change as the import. Duplicate removal is a separate, reviewed change.

## Decisions taken in this pass (no behaviour change)

- No file was deleted or moved. No source code changed.
- The checker is report-only and is not added to CI.
- The donor tree stays in git as evidence.

## Open for the owner

- Keep or retire `packages/workforce/` (issue #4 also covers it).
- Whether `titan-donor/` should move to a release artifact or stay in git (issue #1).
- Whether the 7 known duplicate groups inside `src/ported/` should keep one copy.
