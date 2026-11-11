# Native SQLite schema source recovery

## Status (2026-11-09)

The `COMPANY_NATIVE_FSM` SQLite migration manifest references four SQL source files that are not present in the tracked `main` tree or the available `claude/relaxed-ride-p7km75` branch. The two new company-native migrations are also absent from path-specific Git history inspected during the audit. This is **not** evidence that equivalent SQL can safely be generated.

| Required path | Expected SHA-256 |
| --- | --- |
| `db/sqlite/001_canonical.sql` | `fde73791fc94d10bb2a5758cb006428cf6ee9d8dca571a65dd30e32e8bdbede9` |
| `db/sqlite/005_work_order_completion.sql` | `a295984f85fcdb169a0e2ab91d90abaab4b7eac53e868d829a2f97f440b094ee` |
| `db/sqlite/company-native/0001_work_orders.sql` | `9efd5eafd9af06d0aa0b67b22c064859166956efd9b4d217af611c0e755b3013` |
| `db/sqlite/company-native/0002_visit_tasks.sql` | `def828afc351554735fdc38615d6b67ad1d90c6195ca0b714ed4194b2db5906c` |

These hashes are taken from `packages/storage/src/company-native-schema-manifest.ts`. The manifest also pins exact post-migration SQLite schema fingerprints for both existing profiles. Migration bytes and resulting schema structure **both** have to match.

## Recovery procedure

1. Recover the original SQL files from an authoritative developer archive, matching historical repository, verified release artifact or backup. Preserve exact bytes, including whitespace and line endings.
2. Restore each file at the same path above. Compute `sha256sum <path>` or its platform equivalent and compare all four hashes. Do **not** update the manifest hashes to accommodate guessed or rewritten source.
3. Run `pnpm --filter @titan-zero/storage test:unit`. The native migration, backup, provisioning and attestation tests must pass, including the exact schema fingerprint checks.
4. Run the full CI gate (typecheck, lint, build, unit/integration and E2E) before any deployment. In particular, do not certify or promote a company placement to READY without verified attestation.
5. If original matching files cannot be recovered, treat the native SQLite migration profile as **unavailable**. A newly designed schema must have its own separately reviewed migration/version and compatibility plan; it must not impersonate the attested v1/v2 profiles.

## Runtime behaviour

`initializeFreshCompanyNativeStore` rejects an existing/non-empty schema before loading migration sources. For a fresh store, unreadable or mismatched SQL raises `company-native-schema-migration-source-mismatch` **before any schema writes**. The initializer repeats the freshness check within the transaction to defend against concurrent modification.

The tests that require the four exact files are intentionally not skipped. The repository remains unready for new native SQLite placements until those sources are recovered and verified.
