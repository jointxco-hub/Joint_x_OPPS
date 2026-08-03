-- AUTHORITATIVE READ-ONLY BOOTSTRAP VALIDATION. PROPOSED, UNEXECUTED.
-- Set opps.phase0a_bootstrap_validation_stage to bootstrap|baseline|phase0a.
begin read only;
do $$ declare stage text:=current_setting('opps.phase0a_bootstrap_validation_stage',true); rel text; n bigint; cols text[]; begin
 if stage is null or stage not in ('bootstrap','baseline','phase0a') then raise exception 'Set a valid validation stage.'; end if;
 foreach rel in array array['users','clients','projects','orders','suppliers','inventory','purchase_orders','transactions','finance_budget_buckets','finance_buying_items','tasks','ops_tasks','folders','client_assets','order_stages','order_tags','order_exceptions','order_stage_history','money_model_snapshots','client_quote_requests','client_messages','client_profile_requests','client_tech_pack_templates','client_tech_packs','client_special_instructions','client_approvals','client_contract_templates','client_contract_acceptances'] loop
  if to_regclass('public.'||rel) is null then raise exception 'Required table public.% is missing.',rel; end if;
  if stage='bootstrap' then execute format('select count(*) from public.%I',rel) into n; if n<>0 then raise exception 'Bootstrap relation public.% contains rows.',rel; end if; end if;
 end loop;
 select array_agg(column_name order by ordinal_position) into cols from information_schema.columns where table_schema='public' and table_name='active_orders';
 if coalesce(cardinality(cols),0)<>25 then raise exception 'active_orders must have 25 columns.'; end if;
 select array_agg(column_name order by ordinal_position) into cols from information_schema.columns where table_schema='public' and table_name='v_orders';
 if coalesce(cardinality(cols),0)<>33 then raise exception 'v_orders must have 33 columns.'; end if;
 select array_agg(column_name order by ordinal_position) into cols from information_schema.columns where table_schema='public' and table_name='v_purchase_orders';
 if coalesce(cardinality(cols),0)<>16 then raise exception 'v_purchase_orders must have 16 columns.'; end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers' and column_name='id' and data_type='uuid')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='suppliers' and column_name='type' and data_type='text')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='purchase_orders' and column_name='supplier_ids' and data_type='ARRAY' and udt_name='_uuid')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='purchase_orders' and column_name='tax' and data_type='numeric')
 or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='inventory' and column_name='preferred_supplier_id' and data_type='uuid') then raise exception 'Required legacy type drift detected.'; end if;
 if exists(select 1 from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relname in ('inventory_products','inventory_variants','inventory_supplier_products','inventory_supplier_variants','inventory_legacy_mappings','inventory_reservations','inventory_allocations','inventory_product_versions')) then raise exception 'Inventory Phase 1 object detected.'; end if;
 if stage in ('baseline','phase0a') then
  if to_regprocedure('public.current_user_tenant_ids()') is null or to_regprocedure('public.can_access_tenant(uuid)') is null or to_regprocedure('public.current_user_app_role()') is null or to_regprocedure('public.is_app_admin()') is null or to_regprocedure('public.assign_purchasing_tenant()') is null or to_regprocedure('public.get_storefront_catalog_for_host(text,integer)') is null then raise exception 'Required baseline helper/function is missing.'; end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.inventory'::regclass and tgname='trg_inventory_tenant' and not tgisinternal) then raise exception 'Inventory tenant trigger is missing.'; end if;
 end if;
 if stage='phase0a' then
  foreach rel in array array['active_orders','v_orders','v_purchase_orders'] loop
   if not exists(select 1 from pg_class c join pg_namespace nsp on nsp.oid=c.relnamespace where nsp.nspname='public' and c.relname=rel and coalesce(c.reloptions,'{}') @> array['security_invoker=true']) then raise exception 'public.% is not security_invoker.',rel; end if;
   if has_table_privilege('anon','public.'||rel,'SELECT') then raise exception 'anon still has SELECT on public.%.',rel; end if;
  end loop;
 end if;
end $$;
rollback;



