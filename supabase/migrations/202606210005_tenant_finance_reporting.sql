-- Phase 2E: tenant-owned finance records and RLS-respecting reporting views.

do $$ declare table_name text; begin
  foreach table_name in array array['finance_budget_buckets','finance_buying_items','money_model_snapshots'] loop
    execute format('alter table public.%I add column if not exists tenant_id uuid references public.tenants(id) on delete restrict', table_name);
    execute format('update public.%I set tenant_id = (select id from public.tenants where slug = ''joint-x'') where tenant_id is null', table_name);
    execute format('create index if not exists %I on public.%I (tenant_id)', 'idx_' || table_name || '_tenant_id', table_name);
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end$$;

drop policy if exists finance_admin_read_budget_buckets on public.finance_budget_buckets;
drop policy if exists finance_admin_insert_budget_buckets on public.finance_budget_buckets;
drop policy if exists finance_admin_update_budget_buckets on public.finance_budget_buckets;
drop policy if exists finance_admin_delete_budget_buckets on public.finance_budget_buckets;
create policy tenant_finance_manage_budget_buckets on public.finance_budget_buckets for all to authenticated using ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id)) with check ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id));

drop policy if exists finance_admin_all_buying_items on public.finance_buying_items;
drop policy if exists finance_ops_read_approved_buying_items on public.finance_buying_items;
create policy tenant_finance_manage_buying_items on public.finance_buying_items for all to authenticated using ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id)) with check ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id));

create policy tenant_finance_manage_money_model on public.money_model_snapshots for all to authenticated using ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id)) with check ((public.is_app_admin() or public.user_finance_level() in (1,2)) and public.can_access_tenant(tenant_id));

create or replace view public.income with (security_invoker = true) as select * from public.transactions where type = 'income';
create or replace view public.expenses with (security_invoker = true) as select * from public.transactions where type = 'expense';
create or replace view public.v_founder_dependency_score with (security_invoker = true) as
with last_30 as (select count(*) filter (where role_key = 'founder') as founder_tags, count(*) as total_tags from public.order_tags where created_at > now() - interval '30 days')
select case when total_tags = 0 then 0::numeric else round((founder_tags::numeric / total_tags::numeric) * 100, 1) end as score_pct, founder_tags, total_tags from last_30;
