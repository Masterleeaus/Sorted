-- Returns exactly one value. A pre-existing untracked schema is NOT seeded.
SELECT CASE
  WHEN EXISTS (SELECT FROM public.schema_migrations) THEN 'tracked'
  WHEN EXISTS (
    SELECT 1 FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
  ) THEN 'untracked'
  ELSE 'fresh'
END;