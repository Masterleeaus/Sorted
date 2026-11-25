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

## 2026-11-25: deleted tests for source files that were never committed

Decision: the owner chose to delete these tests on 2026-11-25. Git history search found no commit that ever contained the missing files, so the tests cannot pass and are removed rather than kept as debt.

Deleted (file-level failures, no test in these files ran):

- `tests/titan-builder-auto-binding.test.mjs` read `apps/web/app/app/builder/BuilderStudio.tsx` (missing).
- `tests/titan-builder-component-structured.test.mjs` read `apps/web/app/app/builder/StructuredPropEditor.tsx` (missing).
- `tests/titan-builder-pass7.test.mjs` read `apps/web/app/app/builder/BuilderStudio.tsx` (missing).
- `tests/titan-builder-preview-adapter.test.mjs` read `apps/web/app/app/builder/BuilderStudio.tsx` (missing).
- `tests/titan-builder-preview-data.test.mjs` read `apps/web/app/app/builder/BuilderStudio.tsx` (missing).
- `tests/titan-builder-runtime-projection.test.mjs` read `apps/web/app/api/v1/titan/builder/route.ts` (missing).
- `tests/titan-builder-server-projection-static.test.mjs` read `apps/web/app/api/v1/titan/builder/route.ts` (missing).
- `tests/titan-builder-signal-projection.test.mjs` read `apps/web/app/api/v1/titan/builder/route.ts` (missing).
- `tests/titan-builder-structured-props.test.mjs` read `apps/web/app/app/builder/BuilderStudio.tsx` and `StructuredPropEditor.tsx` (missing).
- `tests/directadmin-bridge.test.mjs` imported `apps/directadmin/zero-core/cockpit.mjs` (missing). The file has 61 test definitions; none could run.

Not deleted: the test "Interaction presentation intent becomes review-only Builder proposal" in `tests/titan-builder-runtime-bridge.test.mjs`. It reads no missing file. It fails on a real assertion (summary banner before card), which is the Class C entry above. It stays red until the behaviour is decided.

Still failing, not decided: the five-tier call qualification test (delegation worker not found), `tests/interface-runtime-native.test.mjs` (PresentationComposer), and the Builder bridge test above.
