-- supabase/migrations/20260823111657_xos_3a_commerce_trigger_search_path_hardening.sql

alter function commerce.sync_variant_tenant_id()
  set search_path = pg_catalog;

alter function commerce.sync_product_link_tenant_id()
  set search_path = pg_catalog;
