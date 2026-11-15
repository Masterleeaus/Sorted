# Issue #13 — GitHub Actions Node 24 runtime refresh

All repository workflow action invocations now use reviewed major versions
that support the Node 24 GitHub Actions runtime:

- `actions/checkout@v7` — checkout and Git authentication cleanup
- `actions/setup-node@v7` — Node version installation and pnpm cache
- `pnpm/action-setup@v6` — uses the repository's pinned pnpm 9.12.0
- `actions/upload-artifact@v7` — E2E report artifact upload

The application under test remains on the original `node-version: 20`
and pinned `pnpm@9.12.0`; action runtime upgrades must not silently
change application compatibility.

`scripts/check-action-runtime.mjs` rejects regressions to deprecated
action majors across every workflow. Required CI lint, typecheck, build,
unit, database integration and E2E gates remain enabled.

Verification required before closing: run GitHub CI and confirm there
are no remaining Node 20 *action runtime* deprecation warnings, and
exercise the report-artifact step when the upstream storage tests pass.
Missing SQLite sources, Knip dead-code debt and unavailable external
Claude credentials are separate blockers and have not been bypassed.
