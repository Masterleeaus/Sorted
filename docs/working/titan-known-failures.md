# Known titan-platform test failures (owner decision, 2026-11-15)

Decision: keep the 18 failing tests as known debt. They are not deleted and not skipped.
Run: `pnpm --filter @titan-zero/titan-platform test`. Baseline on the designated branch: 1580 tests, 1562 pass, 18 fail.
The same 18 fail on `main`. They are not caused by the current change set.

## Class B: the module or export does not exist in this repo or its git history

- agent-profiles: profile tests (2). `getTitanBusinessOpsAgentProfile` and `assertTitanBusinessOpsAgentCommandAllowed` are not defined.
- native-agents: `assertTitanBusinessOpsAgentCommandAllowed` is not exported by business-ops.
- interface-runtime-native: `PresentationComposer` and `presentReceipt` are not exported.
- directadmin-bridge: `apps/directadmin/zero-core/cockpit.mjs` does not exist.
- five-tier delegation: `titan.worker.place_call_agent` is not in the 62-worker graph (donor copy is identical).
- Builder files (9 tests): `BuilderStudio.tsx`, `StructuredPropEditor.tsx` and `api/v1/titan/builder/route.ts` exist nowhere.

## Class C: behaviour not implemented

- spike balancing (1240): projected-load accounting is not implemented.
- lifecycle Settings (1460): the workforce-lifecycle tab and panel are not wired into `SettingsTabsClient` or `page.tsx`.
- Builder bridge (1076): the semantic planner inserts the summary banner before the card.

## What would change this

Each entry needs one of: the missing module restored from a source with a checksum, a product spec for the behaviour, or a decision to delete the test. Until then the check stays red on PRs that run the titan suite.

## 2026-11-25: dropped tests for features missing from the runtime (issue #91, PR #135)

Owner decision (final, 2026-11-25): drop these tests. Do not build the missing features.

Dropped from `packages/titan-platform/tests/interface-runtime-native.test.mjs`:

- `receipt presenter rejects cross-company projection`. It covered `presentReceipt`, which is not exported or defined anywhere in the runtime.
- `runtime registry rejects duplicate contribution keys`. It covered `runtime.contributions.register` and the `duplicate-interface-contribution` error. The interface runtime exposes no contribution registry.

The first test in the file was rewritten to use `runtime.presentation.compose` instead of `PresentationComposer`. The rewrite is kept. The file now has 4 tests, all passing.
