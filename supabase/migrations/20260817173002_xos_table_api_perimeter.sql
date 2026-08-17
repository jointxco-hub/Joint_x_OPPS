-- XOS 1: keep the Data API available to OPPS staff without treating arbitrary
-- tenant membership as operational table authority.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- TRUNCATE bypasses RLS. REFERENCES/TRIGGER are not browser capabilities.
do $$
declare r record;
begin
  for r in select format('%I.%I', schemaname, tablename) qualified_name
           from pg_tables where schemaname = 'public'
  loop
    execute format('revoke truncate, references, trigger on table %s from anon, authenticated', r.qualified_name);
  end loop;
end;
$$;

-- Live Security Advisor tables with RLS disabled: all are internal OPPS data.
do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'bug_reports','calendar_events','goals','ideas','kpis','offer_scores',
    'onboarding_flows','order_stages','personal_notes','qbrs','roles','sops',
    'stage_role_rules','time_allocations','twelve_week_cycles','user_roles',
    'users','weekly_scores','weekly_tasks'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('drop policy if exists xos1_opps_staff_only on public.%I', v_table);
      execute format('create policy xos1_opps_staff_only on public.%I for all to authenticated using (public.is_opps_staff()) with check (public.is_opps_staff())', v_table);
      execute format('revoke all privileges on table public.%I from public, anon', v_table);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);
    end if;
  end loop;
end;
$$;

-- Existing permissive policies keep tenant/row scope. The restrictive policy
-- supplies the independent staff-authority requirement.
do $$
declare
  v_table text;
  v_tables constant text[] := array[
    'client_assets','clients','expense_attachments','finance_budget_buckets',
    'finance_buying_items','folders','inventory','inventory_images',
    'inventory_legacy_mappings','inventory_movements','inventory_products',
    'inventory_supplier_products','inventory_supplier_variants','inventory_variants',
    'managed_client_workspaces','money_model_snapshots','opps_activity_events',
    'opps_invoice_activity','opps_invoice_export_settings','opps_invoice_exports',
    'opps_invoice_item_templates','opps_invoice_item_versions','opps_invoice_items',
    'opps_invoice_number_sequences','opps_invoices','opps_work_acknowledgements',
    'opps_work_reports','ops_tasks','order_exceptions',
    'order_production_readiness_checks','order_stage_history','order_tags','orders',
    'products','projects','purchase_orders','social_campaigns','social_deliverables',
    'social_integrations','social_sync_events','suppliers','tasks','tenants',
    'tenant_memberships','transactions'
  ];
begin
  foreach v_table in array v_tables loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('alter table public.%I enable row level security', v_table);
      execute format('drop policy if exists xos1_require_opps_staff on public.%I', v_table);
      execute format('create policy xos1_require_opps_staff on public.%I as restrictive for all to authenticated using (public.is_opps_staff()) with check (public.is_opps_staff())', v_table);
      execute format('revoke all privileges on table public.%I from public, anon', v_table);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);
    end if;
  end loop;
end;
$$;

-- Customer-own product reads remain. Only policies labelled Staff are changed.
drop policy if exists "Staff manage client products" on public.client_products;
create policy "Staff manage client products" on public.client_products
for all to authenticated
using (public.is_opps_staff() and tenant_id is not null and public.can_access_tenant(tenant_id))
with check (public.is_opps_staff() and tenant_id is not null and public.can_access_tenant(tenant_id));

drop policy if exists "Staff manage client product artwork" on public.client_product_artwork;
create policy "Staff manage client product artwork" on public.client_product_artwork
for all to authenticated
using (public.is_opps_staff() and exists (
  select 1 from public.client_products cp
  where cp.id = client_product_artwork.client_product_id
    and cp.tenant_id is not null and public.can_access_tenant(cp.tenant_id)
))
with check (public.is_opps_staff() and exists (
  select 1 from public.client_products cp
  where cp.id = client_product_artwork.client_product_id
    and cp.tenant_id is not null and public.can_access_tenant(cp.tenant_id)
));

drop policy if exists "Staff manage client product order links" on public.client_product_order_links;
create policy "Staff manage client product order links" on public.client_product_order_links
for all to authenticated
using (public.is_opps_staff() and exists (
  select 1 from public.client_products cp
  where cp.id = client_product_order_links.client_product_id
    and cp.tenant_id is not null and public.can_access_tenant(cp.tenant_id)
))
with check (public.is_opps_staff() and exists (
  select 1 from public.client_products cp
  where cp.id = client_product_order_links.client_product_id
    and cp.tenant_id is not null and public.can_access_tenant(cp.tenant_id)
));

-- XOS requests/files remain RPC-only. Preserve their deny-by-default/admin RLS.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'client_quote_requests','client_messages','client_profile_requests',
    'client_file_links','client_file_folders'
  ] loop
    if to_regclass(format('public.%I', v_table)) is not null then
      execute format('revoke all privileges on table public.%I from public, anon', v_table);
      execute format('revoke truncate, references, trigger on table public.%I from authenticated', v_table);
    end if;
  end loop;
end;
$$;

commit;
