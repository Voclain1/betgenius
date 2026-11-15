WITH schema_parts AS (
 SELECT 'columns' AS kind, c.table_name || '.' || c.column_name AS name,
        row_to_json(c)::text AS definition
 FROM information_schema.columns c WHERE c.table_schema = 'public'
 UNION ALL SELECT 'index', tablename || '.' || indexname, indexdef
 FROM pg_indexes WHERE schemaname = 'public'
 UNION ALL SELECT 'constraint', r.relname || '.' || c.conname, pg_get_constraintdef(c.oid)
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'view', viewname, definition FROM pg_views WHERE schemaname='public'
 UNION ALL SELECT 'routine', p.oid::text, pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')
 UNION ALL SELECT 'trigger', t.oid::text, pg_get_triggerdef(t.oid)
 FROM pg_trigger t JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public'
), ddl AS (
 SELECT pid, usename, application_name, state, xact_start,
        md5(query) AS query_fingerprint
 FROM pg_stat_activity
 WHERE datname=current_database() AND pid<>pg_backend_pid()
 AND state IN ('active','idle in transaction')
 AND query ~* '\m(CREATE|ALTER|DROP|TRUNCATE|REINDEX|CLUSTER)\M|VACUUM[[:space:]]+FULL'
), ddl_locks AS (
 SELECT a.pid,a.application_name,l.mode,l.granted,n.nspname AS namespace,c.relname AS relation
 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
 LEFT JOIN pg_class c ON c.oid=l.relation LEFT JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE a.datname=current_database() AND a.pid<>pg_backend_pid()
 AND l.mode IN ('AccessExclusiveLock','ShareRowExclusiveLock','ShareLock')
)
SELECT json_build_object(
 'at',clock_timestamp(), 'database',current_database(), 'role',current_user,
 'server_address',inet_server_addr()::text, 'server_port',inet_server_port(),
 'server_version',current_setting('server_version'),
 'read_only',current_setting('transaction_read_only'),
 'cluster_id',(SELECT system_identifier::text FROM pg_control_system()),
 'in_recovery',pg_is_in_recovery(),
 'schema_fingerprint',(SELECT md5(string_agg(kind || ':' || name || ':' || definition,E'\n' ORDER BY kind,name)) FROM schema_parts),
 'paid_quota_table_present',to_regclass('public."PaidQuotaAttempt"') IS NOT NULL,
 'ddl_candidates',COALESCE((SELECT json_agg(ddl) FROM ddl),'[]'::json),
 'ddl_locks',COALESCE((SELECT json_agg(ddl_locks) FROM ddl_locks),'[]'::json),
 'counts',json_build_object('User',(SELECT count(*) FROM "User"), 'Prediction',(SELECT count(*) FROM "Prediction"),
   'Subscription',(SELECT count(*) FROM "Subscription"), 'PaymentAttempt',(SELECT count(*) FROM "PaymentAttempt"))
) AS evidence;
