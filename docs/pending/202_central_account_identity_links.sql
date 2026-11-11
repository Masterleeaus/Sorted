-- Central SSO account links: the product-local account remains authoritative.
-- STAGING DESIGN ONLY: DO NOT APPLY without review of existing RLS
-- policies on users/accounts, ownership and runtime privilege grants.
-- Privileged offline provisioning must independently verify each identity.
-- No browser, email lookup, or service role may INSERT mappings directly.
BEGIN;
CREATE TABLE IF NOT EXISTS central_account_identity_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 issuer text NOT NULL CHECK(length(issuer) BETWEEN 8 AND 256),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'verified' CHECK(status IN ('verified','revoked')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 verified_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(issuer,subject,account_id),
 UNIQUE(account_id,user_id,issuer)
);
CREATE INDEX IF NOT EXISTS central_account_identity_user_idx
 ON central_account_identity_links(account_id,user_id,status);
ALTER TABLE central_account_identity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE central_account_identity_links FORCE ROW LEVEL SECURITY;
REVOKE ALL ON central_account_identity_links FROM PUBLIC;
CREATE OR REPLACE FUNCTION app_central_resolve_account_link(
 p_issuer text,p_subject text,p_account_id uuid
)
RETURNS TABLE (user_id uuid,account_id uuid,role text,revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.account_id,u.role,l.revision
 FROM central_account_identity_links l
 JOIN users u ON u.id=l.user_id AND u.account_id=l.account_id
 WHERE l.issuer=p_issuer AND l.subject=p_subject AND l.account_id=p_account_id
   AND l.status='verified'
 ORDER BY l.revision DESC LIMIT 2;
$$;
REVOKE ALL ON FUNCTION app_central_resolve_account_link(text,text,uuid) FROM PUBLIC;
-- Grant EXECUTE only to the established Sorted application DB login role,
-- after operator review and verified account-link provisioning.
COMMENT ON FUNCTION app_central_resolve_account_link(text,text,uuid) IS
 'Trusted server lookup; no arbitrary account selection or email-based matching. Requires separate Central entitlement check.';
COMMIT;
