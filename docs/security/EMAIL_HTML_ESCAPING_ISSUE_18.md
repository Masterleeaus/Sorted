# Issue #18 — HTML email injection protection

This pass secures all seven shared HTML email template modules and the portal
magic-link email. The two contexts are untrusted text and navigable URLs.

- Encode customer-supplied fields with `escapeEmailText`; no raw HTML is accepted.
- Use `safeEmailHref` for all dynamic anchor attributes and buttons. HTTPS with
  a valid host, loopback HTTP and safe local paths are accepted; script/data/file,
  protocol-relative, credentials, backslashes and controls are rejected.
- HTML attribute values are escaped after URL validation.
- Plain-text email builders preserve original human-readable input.
- Customer legal identity and branding are retained, not replaced by platform names.
- Portal login token generation and delivery are unchanged.

Test with `pnpm --filter @ai-fsm/email-templates test` and
`pnpm --filter @ai-fsm/web exec vitest run lib/email/__tests__/portal-magic-link.test.ts`.
This pass does not prove all other ad hoc emails elsewhere in the monorepo safe;
verify broader renderers separately before declaring #18 closed.
