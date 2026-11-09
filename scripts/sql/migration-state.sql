-- Returns exactly one value. A pre-existing untracked schema is NOT seeded.
SELECT CASE
  WHEN EXISTS (SELECT FROM public.schema_migrations) THEN 'tracked'
  WHEN to_regclass('public.clients') IS NOT NULL THEN 'untracked'
  ELSE 'fresh'
END;