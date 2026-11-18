-- psql requires migration_filename supplied via -v.
SELECT count(*) FROM public.schema_migrations WHERE filename = :'migration_filename';