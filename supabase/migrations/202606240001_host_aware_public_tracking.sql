-- Phase 2 host-aware public tracking.
-- Public tracking remains a one-order lookup, with tenant scope resolved only
-- from an active public_tracking host mapping.

alter table public.orders
  drop constraint if exists orders_order_number_key;

create unique index if not exists idx_orders_tenant_order_number_unique
  on public.orders(tenant_id, order_number);

create or replace function public.get_public_order_tracking_for_host(
  p_lookup text,
  p_hostname text
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  with input as (
    select upper(trim(coalesce(p_lookup, ''))) as raw_lookup
  ),
  resolved_tenant as (
    select domain_row.tenant_id
    from public.tenant_domains domain_row
    join public.tenants tenant on tenant.id = domain_row.tenant_id
    where domain_row.hostname = public.normalize_tenant_hostname(p_hostname)
      and domain_row.surface = 'public_tracking'
      and domain_row.status = 'active'
      and tenant.status = 'active'
    limit 1
  )
  select jsonb_build_object(
    'id', o.id,
    'client_name', o.client_name,
    'order_number', o.order_number,
    'status', o.status,
    'pipeline_stage', o.pipeline_stage,
    'production_method', o.production_method,
    'production_detail_stage', o.production_detail_stage,
    'production_client_update', o.production_client_update,
    'due_date', o.due_date,
    'courier', o.courier,
    'tracking_number', o.tracking_number,
    'pep_code', o.pep_code,
    'portal_message', o.portal_message,
    'portal_attention_items', o.portal_attention_items,
    'portal_show_files', o.portal_show_files,
    'portal_show_balance', o.portal_show_balance,
    'portal_visible_file_urls', o.portal_visible_file_urls,
    'invoice_files', o.invoice_files,
    'total_amount', o.total_amount,
    'deposit_paid', o.deposit_paid
  )
  from resolved_tenant
  join public.orders o on o.tenant_id = resolved_tenant.tenant_id
  cross join input
  where input.raw_lookup <> ''
    and (
      upper(coalesce(o.order_number, '')) = input.raw_lookup
      or upper(coalesce(o.tracking_number, '')) = input.raw_lookup
      or upper(o.id::text) = input.raw_lookup
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(o.invoice_numbers, '[]'::jsonb)) number
        where upper(number) = input.raw_lookup
      )
    )
  order by o.updated_at desc
  limit 1;
$$;

grant execute on function public.get_public_order_tracking_for_host(text, text) to anon, authenticated;
-- Keep the legacy public RPC callable for existing Joint X browser bundles, but
-- do not allow its tenant slug argument to become a hostless tenant selector.
create or replace function public.get_public_order_tracking(
  p_lookup text,
  p_tenant_slug text default 'joint-x'
)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select public.get_public_order_tracking_for_host(p_lookup, 'ops.jointx.co.za');
$$;

grant execute on function public.get_public_order_tracking(text, text) to anon, authenticated;
