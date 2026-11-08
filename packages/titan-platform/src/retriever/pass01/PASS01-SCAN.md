# TZ-FINISH-RETRIEVER-NATIVE-001 — Pass 1

Merge 52 is a standalone Business Ops canonical, not the old browser-extension runtime.

## Authoritative result

- No `packages/titan-platform/src/retriever/`, `apps/web/lib/retriever/`, or root `retriever/` native execution subsystem existed at scan start.
- The old Retriever bundle, Monica compatibility boundary, Retriever adapter, and side-panel bridge are retained under `packages/titan-platform/src/ported/` or `packages/titan-zero-migration-source/`.
- `@ai-fsm/titan-platform` does **not** export those Retriever files, and its TypeScript compilation roots do not include the `src/ported/` tree directly.
- No non-ported standalone consumer directly references the retained Retriever runtime files.
- Therefore the old donor is currently reference/migration material in Merge 52, but native standalone Retriever execution is also absent.

## Required convergence path

Pass 2 must build the typed native Retriever executor by extending the existing Titan company/authority runtime seams, not by reviving the old browser-extension background runtime. Passes 3-8 then migrate lifecycle and UI/browser adapter behavior and prove parity before any reference retirement in Pass 9.

The machine-readable dependency map is `REMAINING-DEPENDENCY-MAP.json`.
