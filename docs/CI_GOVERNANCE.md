# CI Governance

## Required Checks

Branch protection for `main` should require these stable CI check names:

- `lint`
- `typecheck`
- `build`
- `test`
- `e2e-smoke`

The `e2e-smoke` job is the release-manifest browser smoke. It runs `tests/e2e/core-flow.spec.ts` against a migrated, seeded PostgreSQL database and a production Next.js server.

## Branch Protection Command

After `e2e-smoke` has run at least once on `main`, update required status checks with:

```bash
gh api repos/Masterleeaus/Sorted/branches/main/protection/required_status_checks \
  --method PATCH \
  --field strict=true \
  --field contexts='["lint","typecheck","build","test","e2e-smoke"]'
```

The backup, SQL migration and seed safety subgate is also run by `pnpm gate` locally via `node --test scripts/tests/*.test.mjs`. Shell syntax is checked for the production deploy and migration scripts. Mocked rclone/Docker/GPG and psql tests verify failure handling and transaction invocation; they do not replace real encrypted offsite scratch restores or PostgreSQL migration integration tests.

The required `test` job still runs the complete original storage test suite. A separate diagnostic step reports whether the four SHA-256-pinned SQLite migration sources are missing or modified; it uses `continue-on-error` **only for diagnostics**, not for the unit tests. Missing donor/native SQL is a source-recovery blocker, not an acceptable reason to fabricate migrations, relax integrity hashes, or declare CI green. See `docs/working/legacy-migration-safety.md`.

Do not remove a required check to merge a feature PR. If a required check itself is broken, use a short-lived documented bypass and restore the full list immediately after the fix lands.

## CI Jobs

| Check | Depends on | Purpose |
|---|---|---|
| `lint` | none | Workspace ESLint, backup/restore shell syntax and Node regression tests, Knip, plus migration-prefix checks. A failing backup test blocks lint before Knip runs. |
| `typecheck` | none | TypeScript `--noEmit` across workspaces. |
| `build` | `lint`, `typecheck` | Production build with build-time env placeholders only. |
| `test` | `lint`, `typecheck` | Unit and DB integration tests against PostgreSQL. |
| `e2e-smoke` | `build`, `test` | Required release spine: login, client, job, visit, estimate, invoice, payment. |

## Release Manifest

The browser smoke is scoped by `tests/e2e/core-flow.spec.ts` and the release expectations in this document. If the launch spine changes, update both in the same PR.
