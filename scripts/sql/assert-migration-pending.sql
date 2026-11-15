-- Run after migration-lock.sql, before applying the migration file.
-- A second concurrent deploy cannot replay a migration after the first commits.
SELECT set_config('sorted.migration_filename', :'migration_filename', true);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.schema_migrations
    WHERE filename = current_setting('sorted.migration_filename')
  ) THEN
    RAISE EXCEPTION 'migration already applied by another deployment: %',
      current_setting('sorted.migration_filename');
  END IF;
END $$;