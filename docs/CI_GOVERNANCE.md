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

## Deployment and Monitoring Safety Gate

The `lint` job and `pnpm gate` both syntax-check the deployment entrypoint, SSH wrapper, healthcheck monitor, backup/restore scripts and deployment helper. The existing `node --test scripts/tests/*.test.mjs` suite includes runtime tests for safe branch arguments, bounded web readiness, production backup preflight, and explicit failed monitoring status.

These checks verify source logic and isolated test doubles; they do **not** deploy to `garonhome.local`, prove ntfy message delivery or demonstrate a real PostgreSQL recovery. A release must also pass the complete required test and E2E jobs. For production, run a verified encrypted backup and obtain owner approval before calling the deployment entrypoint.

## Serialized backup run and local artifact release rule

CI and the local quality gate exercise the process lock, active/interrupted status markers, successful status cleanup, and streaming verification of each local encrypted artifact against its recorded manifest. The deployment preflight invokes that local integrity audit after the backup freshness gate and before any PostgreSQL mutation. These read-only tests reject mismatched, missing or duplicated artifact metadata. Local mock-based verification remains separate from real offsite restore-drill approval.



The backup source and CLI tests require **cryptographic SHA-256 read-back** for each encrypted remote artifact and the manifest. An older name/size-only success record is not accepted by `scripts/check-backup-health.mjs`. Local legacy backup files are not rewritten, and historical offsite sets are not deleted by a broad age-only command. Incomplete or corrupt remote copies must remain visible to the operator.

The restore preflight additionally checks that an encrypted uploads archive is a readable gzip tar and that the encrypted environment contains PostgreSQL credentials before stopping services. The scratch verification command rejects archive traversal paths and uses SQL-quoted scratch database identifiers. These tests prove validation logic with fixtures, **not** a live Google Drive download, correct encryption, or a successful production restore.

## Recovery approval and bounded transfers

The recovery regression subgate now checks the shared `scripts/lib/backup-policy.sh` helper for bounded rclone timeouts, safe named remotes, approved destructive restore targets, and uploads-only archive member paths. Both the CI lint job and the local gate run `bash -n` on the helper and the scripts that source it.

The backup script records `INCOMPLETE` on invalid remote settings rather than preserving a misleading green status. Alert hook messages are passed as discrete arguments to an executable path; they are never evaluated as shell commands. A destructive restore requires `FSM_RESTORE_CONFIRM_DB` to equal the target database and fails before stopping services when absent or wrong. Fixture-based tests cannot substitute for an operator-approved recovery rehearsal using real encryption, PostgreSQL, and offsite reads.

## Release Manifest

The browser smoke is scoped by `tests/e2e/core-flow.spec.ts` and the release expectations in this document. If the launch spine changes, update both in the same PR.
