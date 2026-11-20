-- OPPS-106 READ-ONLY source/restore inventory: NO user records.
-- Execute independently against production and against an isolated restore.
-- Compare recorded values and inspect intentional differences.
select current_database() as database_name,
 current_setting('server_version') as postgres_version,
 (select count(*) from pg_class c
   join pg_namespace n on n.oid=c.relnamespace
   where c.relkind in ('r','p') and n.nspname in ('public','commerce','auth','storage'))
   as table_count,
 (select count(*) from pg_trigger t
   join pg_class c on c.oid=t.tgrelid
   join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and n.nspname in ('public','commerce','auth','storage'))
   as custom_trigger_count,
 (select count(*) from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','commerce'))
   as app_function_count,
 (select count(*) from pg_policies
   where schemaname in ('public','commerce','storage'))
   as rls_policy_count,
 (select count(*) from supabase_migrations.schema_migrations
   where name like 'opps106_%') as opps106_migration_count,
 to_regclass('qr_payments.payment_requests') is not null as qr_schema_present,
 md5(pg_get_functiondef('commerce.qs_project_manual_receipt(uuid)'::regprocedure))
   as finance_original_md5,
 md5(pg_get_functiondef('commerce._qs_sync_opps_payment_ledger(uuid,uuid)'::regprocedure))
   as opps_handoff_original_md5,
 md5(pg_get_functiondef('public.enforce_workspace_order_update_scope()'::regprocedure))
   as workspace_scope_original_md5;
