/**
 * Tenant key from the verified Central org claim (Sorted issue #40).
 *
 * Contract: the tenant key (company_id / account_id) comes only from the
 * verified Central `org` claim. A request-supplied company_id, account_id,
 * tenant or organisation value in a query string or JSON body is ignored or
 * rejected by the access layer. It never selects the tenant.
 *
 * Status: the verified-claim access layer is NOT on main. On main the session
 * tenant comes from the `users` row keyed by the HS256 `fsm_session` cookie
 * (lib/auth/session.ts), and withTokenAccountContext (api/_lib/account-context.ts)
 * takes its account id from the caller. Nothing on main reads a verified Central
 * `org` claim. These cases are therefore skipped until that layer lands. Each
 * skip carries a TODO(#40) that names the assertion to turn on. Do not
 * un-skip them against the current session code: that would test a different
 * layer.
 */

import { describe, it } from "vitest";

describe("tenant key comes from the verified Central org claim (#40)", () => {
  // TODO(#40): ignore a request-supplied company_id in the query string.
  // Expect the tenant resolved from the verified org claim to be used, and the
  // query value to have no effect on the rows returned or the tenant set in the
  // database context.
  it.skip("ignores a request-supplied company_id query parameter", () => {});

  // TODO(#40): ignore a request-supplied account_id query parameter the same way.
  it.skip("ignores a request-supplied account_id query parameter", () => {});

  // TODO(#40): ignore a company_id in a JSON body on a write route. The row must
  // be written under the verified org's tenant key, or the request rejected.
  it.skip("ignores or rejects a request-supplied company_id body parameter", () => {});

  // TODO(#40): ignore a request-supplied account_id body parameter on a write
  // route, with the same expectation as above.
  it.skip("ignores or rejects a request-supplied account_id body parameter", () => {});

  // TODO(#40): ignore or reject a request-supplied tenant or organisation
  // parameter (query or body). Central derives the tenant, so Sorted must not.
  it.skip("ignores or rejects a request-supplied tenant or organisation parameter", () => {});

  // TODO(#40): refuse a session or token that carries a tenant the verified
  // Central org claim does not back. Expect the request to fail closed before
  // any tenant query runs.
  it.skip("refuses a tenant that the verified org claim does not back", () => {});

  // TODO(#40): positive case. A valid verified org claim sets the tenant key,
  // and the tenant context reaches the database transaction.
  it.skip("derives the tenant key from the verified org claim", () => {});

  // TODO(#40): a user with two memberships sees only the company bound to the
  // active session's verified org claim.
  it.skip("scopes a user with two memberships to the active org only", () => {});

  // TODO(#40): a revoked membership is refused on the next request.
  it.skip("refuses access once a membership is revoked", () => {});
});
