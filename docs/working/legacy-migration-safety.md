# Sorted legacy SQL migration safety and pinned native source recovery

**Status:** Source hardening on a draft PR; **not a production migration authorization**.

## Boundaries

Sorted currently has a PostgreSQL migration chain under `db/migrations`. Titan Central's eventual shared company_id registry and authoritative migration history are separately tracked by issue #26. Do **not** run the Sorted legacy chain against Central's shared database until ownership and ordering have been reconciled, and do not claim this hardening implements the canonical company_id migration.

The two existing runners are `scripts/db-migrate.sh` (local/scratch) and `scripts/deploy-garonhome.sh` (production Docker Compose). Both now source `scripts/lib/migration-safety.sh` and use the SQL contracts under `scripts/sql/`.

## Migration safeguards

1. Only files matching the versioned `NNN_name.sql` filename contract participate. The known development seed `002_seed_dev.sql` is omitted by exact name. Unexpected SQL filenames or an empty directory abort.
2. A database with `clients` but no migration tracking history is **untracked**. The runners abort and require human reconciliation. They never silently mark the full chain applied.
3. Each new migration and the tracking-row INSERT execute in a single `psql -1` transaction with `ON_ERROR_STOP=1`; SQL failure rolls back its tracking row. An advisory transaction lock and a second pending check reject concurrent replay.
4. Filename values are passed as psql variables and quoted as SQL literals. Reserved PostgreSQL databases are rejected by the shell preflight. Runners refuse unknown tracking states or unexpected applied counts.
5. Demo seeding refuses declared `NODE_ENV=production` or `FSM_DEPLOY_ENV=production`. Seed content is **not** part of production migrations.

**Scope limitation:** This does not turn the current legacy file list into an approved Central migration chain. It also does not prove that every legacy SQL file is safe to wrap in a single transaction. Review any file with `CREATE INDEX CONCURRENTLY`, `VACUUM`, explicit `BEGIN/COMMIT` or other transaction-incompatible statements before enabling deployment. Stop on a failed disposable-PostgreSQL gate; do not disable the transaction boundary to force progress.

## Disposable verification before a deploy

Run with a disposable PostgreSQL instance and admin credentials:

```bash
node --test scripts/tests/migration-safety.test.mjs \
  scripts/tests/migration-sql-contract.test.mjs \
  scripts/tests/db-migrate-failure.test.mjs \
  scripts/tests/deploy-migration-contract.test.mjs
MIGRATION_DATABASE_URL=postgresql://test:test@localhost:5432/sorted_scratch \
  POSTGRES_DB=sorted_scratch POSTGRES_USER=test \
  bash scripts/db-migrate.sh
```

Verify `schema_migrations` matches actual schema state and rerun to prove idempotence. Intentionally break a disposable migration and confirm both data changes and tracking INSERT roll back. Never use a live business database for these checks, and never use the production deployment script to test migration failure behavior.

## Pinned SQLite donor/native sources — independent blocker

The storage package pins these **exact original bytes** by SHA-256 in `packages/storage/src/company-native-schema-manifest.ts`:

| Required file | SHA-256 |
|---|---|
| `db/sqlite/001_canonical.sql` | `fde73791fc94d10bb2a5758cb006428cf6ee9d8dca571a65dd30e32e8bdbede9` |
| `db/sqlite/005_work_order_completion.sql` | `a295984f85fcdb169a0e2ab91d90abaab4b7eac53e868d829a2f97f440b094ee` |
| `db/sqlite/company-native/0001_work_orders.sql` | `9efd5eafd9af06d0aa0b67b22c064859166956efd9b4d217af611c0e755b3013` |
| `db/sqlite/company-native/0002_visit_tasks.sql` | `def828afc351554735fdc38615d6b67ad1d90c6195ca0b714ed4194b2db5906c` |

Run `node scripts/check-native-sqlite-provenance.mjs` for an explicit read-only JSON report. It exits nonzero when any source is missing or its hash differs. Restore the original bytes from an authoritative donor/archive, compare the pinned hashes, then rerun the actual storage suite and provenance check. **Do not invent SQL, alter hashes, skip test files, or represent missing source as successful validation.**

## Integration dependencies and closure

Issue #26 remains open until the complete Central company_id schema ownership, migration registry, RLS, two-company isolation and worker/API tests are verified. Issue #6 remains open while web runtime RLS cutover is incomplete. Backup and restore issues #22/#24 require a real offsite encrypted restore drill, not just mock-based scripts.

Keep draft PRs unmerged until the mandatory `lint`, `typecheck`, `build`, `test` and `e2e-smoke` checks are green and source recovery is attested.
