-- Serialize migration transactions on a single PostgreSQL database.
-- The lock is held until the transaction containing the migration commits.
SELECT pg_advisory_xact_lock(164721109);