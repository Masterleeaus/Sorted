-- Executed in the SAME psql --single-transaction invocation as the SQL file.
-- Atomic bookkeeping: a failing migration never leaves an applied marker.
INSERT INTO public.schema_migrations(filename) VALUES (:'migration_filename');