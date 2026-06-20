-- Public tracking exposes one explicitly requested Joint X order, never an order list.

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
  with input as (
    select
      upper(trim(coalesce(p_lookup, ''))) as raw_lookup,
      regexp_replace(upper(trim(coalesce(p_lookup, ''))), '[^A-Z0-9-]', '', 'g') as normalized_lookup
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
  from public.orders o
  join public.tenants t on t.id = o.tenant_id and t.slug = lower(trim(p_tenant_slug)) and t.status = 'active'
  cross join input
  where input.raw_lookup <> ''
    and (
      upper(coalesce(o.order_number, '')) = input.raw_lookup
      or upper(coalesce(o.tracking_number, '')) = input.raw_lookup
      or upper(o.id::text) = input.raw_lookup
      or exists (select 1 from unnest(coalesce(o.invoice_numbers, '{}'::text[])) number where upper(number) = input.raw_lookup)
    )
  order by o.updated_at desc
  limit 1;
$$;

grant execute on function public.get_public_order_tracking(text, text) to anon, authenticated;
