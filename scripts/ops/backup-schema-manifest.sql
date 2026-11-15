WITH parts AS (
 SELECT 'table' AS kind, tablename AS name, tablename AS definition FROM pg_tables WHERE schemaname='public'
 UNION ALL
 SELECT 'column',table_name||'.'||column_name,json_build_array(ordinal_position,data_type,udt_name,is_nullable,column_default,character_maximum_length,numeric_precision,numeric_scale)::text
 FROM information_schema.columns WHERE table_schema='public'
 UNION ALL SELECT 'index',tablename||'.'||indexname,indexdef FROM pg_indexes WHERE schemaname='public'
 UNION ALL SELECT 'constraint',r.relname||'.'||c.conname,pg_get_constraintdef(c.oid)
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'
)
SELECT json_build_object(
 'schema_fingerprint',(SELECT md5(string_agg(kind||':'||name||':'||definition,E'\n' ORDER BY kind,name)) FROM parts),
 'table_count',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'invalid_indexes',(SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT i.indisvalid),
 'unvalidated_constraints',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' AND NOT c.convalidated)
) AS manifest;
