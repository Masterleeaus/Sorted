# Carry PR 30 onto main: merge decisions

Date: 2026-11-15
Branch: issue/carry-30-field-rebrand (merge of origin/fix/issue-29-sorted-field-identity, no-ff, no rebase)
Rule applied: keep main's tenant logic (company_id, BOOKING_ACCOUNT_ID, injected projections, removed store).
Apply PR 30's intent on top where it does not reintroduce account-only predicates or removed code.

## Conflicted files (19)

| File | Kept | Why |
|---|---|---|
| .github/workflows/ci.yml | PR 30 (checkout v7, setup-node v7, pnpm/action-setup v6) | PR 30 is the Node 24 action-major change; the repo guard `scripts/check-action-runtime.mjs` and its test require these majors. Verify in CI. |
| .github/workflows/claude-code-review.yml | PR 30 (checkout v7) | Same as above. |
| .github/workflows/claude.yml | PR 30 (checkout v7) | Same as above. |
| apps/web/app/api/v1/portal/request-access/route.ts | main | Main has BOOKING_ACCOUNT_ID fail-closed and company_id lookups. Main's `portalMagicLinkHtml` from `@ai-fsm/email-templates` is used. PR 30's local alias import removed (its helper is superseded). |
| apps/web/lib/attention/email.ts | main escaping (`hrefAttr`), PR 30 wording | Product wording "Sorted Field" taken from PR 30 (field identity). Open: confirm product name in this footer. |
| packages/email-templates/src/layout.ts | main | `escape.ts` (main, commit 888d0c4) is the single escaping source. PR 30's `escapeEmailText` / `safeEmailHref` removed as duplicates. |
| packages/email-templates/src/automation.ts | main | Main escapes all dynamic values. PR 30 wording unchanged where not in conflict. |
| packages/email-templates/src/estimate.ts | main | Same as above. |
| packages/email-templates/src/intake.ts | main | Main escapes BRAND. |
| packages/email-templates/src/invoice.ts | main | Same as above. |
| packages/email-templates/src/review.ts | main | Same as above. |
| packages/email-templates/src/visit.ts | main | Same as above. |
| packages/onboarding/package.json | main scripts and deps, plus test-only devDependencies from PR 30 | Main removed the titan-platform runtime dependency on purpose (injection). PR 30's payments test imports canonical projections, so `@titan-zero/titan-platform` and `tsx` are added as devDependencies only. `test` script uses `node --import tsx`. |
| packages/onboarding/runtime/payments-communications-setup.mjs | main injection design, PR 30 authority guard | Main injects `settingsProjections` and fails closed. PR 30's `workforceGlobalDefaults` now comes from the factory, not the save payload. A save payload carrying it is rejected. Owner strings use main's paths. |
| packages/storage/src/company-native-store-initializer.ts | deleted (main) | Main removed the company-native store (commit f63eb12). PR 30's hardening applied to code that no longer exists. |
| packages/storage/src/company-native-store-initializer.test.ts | deleted (main) | Same as above. |
| services/worker/src/notification/enqueue.ts | main | Cancel helper keeps main's signature `(client, entityType, entityId, eventType, accountId)` and `company_id` predicate. PR 30 used `account_id` in the WHERE clause and a different argument order. PR 30's doc comment kept. |
| services/worker/src/notification/enqueue.test.ts | main, plus PR 30 tests | Main tests kept. PR 30 ownership/retry tests carried. PR 30 cancel test ported to main signature and `company_id`. |
| services/worker/src/workflow-events.test.ts | main | Main test kept. PR 30 cancellation tests moved to new `workflow-events.cancellation.test.ts` and ported to `company_id`. |
| services/worker/src/workflow-events.ts (auto-merged, fixed) | main signature | Auto-merge had passed `account_id` twice. Now passes `(client, entity_type, entity_id, event_type, account_id)`. |
| pnpm-lock.yaml (auto-merged, regenerated) | generated | Regenerated with `pnpm install --lockfile-only` after the onboarding manifest change. `--frozen-lockfile` passes. |

## Other edits made during the merge

- `packages/email-templates/src/escape.ts`: `safeUrl` now also rejects URLs with embedded credentials (`user:pass@host`). This is PR 30's intent, applied to main's helper.
- `packages/email-templates/src/__tests__/urls.security.test.ts` and `html-escape.security.test.ts`: PR 30 tests ported to main's `escape.ts` helpers. Relative-path allow case dropped because main fails closed on relative URLs. Leading-space case dropped because main trims input.
- `apps/web/lib/email/__tests__/portal-magic-link.test.ts`: PR 30 test now imports `portalMagicLinkHtml` from `@ai-fsm/email-templates`.
- Deleted `apps/web/lib/email/portal-magic-link.ts` (PR 30 duplicate of main's `packages/email-templates/src/portal.ts`).

## Open items for review

1. Footer product name in `apps/web/lib/attention/email.ts` ("Sorted Field"). Confirm.
2. Node 24 action majors (ci.yml, claude*.yml). Confirm they exist and pass in CI.
3. `scripts/check-titan-manifest.mjs` exits 1 on main too (checksum drift in `apps/web/lib/titan/interface-runtime/live-context.ts` and its contract test). Not caused by this merge. Not fixed here.
