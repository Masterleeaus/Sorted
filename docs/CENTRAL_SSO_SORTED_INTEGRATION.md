# Sorted — Titan Central SSO integration gate
Central issue #26 requires verified Sorted `account_id` ownership, not a login by
email or the legacy `field` assumption. This pass adds a real Sorted-side
read-only mapping query, migration 202, verification contracts and test cases.

**No public SSO route has been enabled.** Preserve Sorted's existing native
login, account RLS, session cookies and API contract. The candidate SQL is parked under `docs/pending/` because existing
user/account RLS and function ownership privileges require review.
An operator must
independently provision exact (issuer, subject, account, user) mappings and
grant the trusted read function only to the dedicated Sorted runtime role.
The Central company UUID must be mapped to exactly one Sorted account UUID;
`authoriseCentralCompany` must check current Central membership and Sorted
entitlement before local user resolution. The app must verify OIDC PKCE
server-side and pass a short-lived verified identity, never accept this data
from a request body or query string. The existing Sorted HS256 cookie is
not yet bound to a revocable Central session generation, therefore the
bridge is **not production-ready** and is intentionally not mounted.

Before enabling: verify a real Logto client, browser binding, link revocation,
tenant account RLS, session invalidation on company switch, replay protection,
product account status, and logout under real PostgreSQL. Do not close Central
issue #26 without this evidence.
