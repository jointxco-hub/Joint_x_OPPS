-- XOS 2.7A/B - tenant identity + client-facing status polish.
--
-- Phase A (OPPS tenant identity) is entirely frontend-side: tenants is
-- already readable cross-tenant by OPPS staff via the existing
-- xos1_require_opps_staff RLS policy (unchanged, not touched here), and
-- orders.tenant_id is already returned in every order row. No backend
-- change was needed for Phase A.
--
-- Phase B (client-facing status polish) needs two additional fields that
-- neither XOS-facing RPC currently returns at all: fulfillment_type (for
-- "Ready for collection" vs "Ready for dispatch" wording) and
-- payment_status (shown as its own, separate badge - never merged into
-- production-progress wording). Confirmed live via pg_get_functiondef
-- before writing this: neither field appears anywhere in either function
-- body today.
--
-- This migration ONLY adds those two fields to each function's existing
-- output projection. Every other line - authorization
-- (resolve_authenticated_tenant_host), tenant scoping, the is_archived
-- filter, truncation/sanitization of every other field, grants,
-- SECURITY DEFINER, search_path - is byte-identical to the currently
-- deployed functions. No table, column, RLS policy, or grant is touched.
-- No order-number generation, PayFast, checkout, or is_test/
-- excluded_from_reports work is part of this migration.

create or replace function public.get_xos_orders_for_host(p_hostname text, p_limit integer DEFAULT 20)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  safe_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_number', order_row.order_number,
      'client_name', order_row.client_name,
      'status', order_row.status,
      'stage', order_row.stage,
      'created_at', order_row.created_at,
      'due_date', order_row.due_date,
      'total_amount', order_row.total_amount,
      'fulfillment_type', order_row.fulfillment_type,
      'payment_status', order_row.payment_status,
      'item_count', order_row.item_count,
      'tracking_reference', order_row.tracking_reference,
      'summary', order_row.summary
    )
    order by order_row.created_at desc
  ), '[]'::jsonb)
  into result
  from (
    select
      o.order_number,
      left(coalesce(o.client_name, 'Client'), 160)::text as client_name,
      coalesce(o.status, 'confirmed')::text as status,
      left(coalesce(o.production_detail_stage, o.pipeline_stage, o.status, 'confirmed'), 80)::text as stage,
      o.created_at,
      o.due_date,
      o.total_amount,
      o.fulfillment_type,
      coalesce(o.payment_status, 'pending')::text as payment_status,
      case
        when jsonb_typeof(coalesce(o.products, '[]'::jsonb)) = 'array'
          then jsonb_array_length(coalesce(o.products, '[]'::jsonb))
        else 0
      end as item_count,
      nullif(left(coalesce(o.tracking_number, ''), 80), '')::text as tracking_reference,
      left(coalesce(o.production_client_update, 'Client-facing progress update pending.'), 280)::text as summary
    from public.orders o
    where o.tenant_id = resolved_tenant_id
      and coalesce(o.is_archived, false) = false
    order by o.created_at desc
    limit safe_limit
  ) order_row;

  return result;
end;
$function$;

revoke all on function public.get_xos_orders_for_host(text, integer) from public;
revoke all on function public.get_xos_orders_for_host(text, integer) from anon;
grant execute on function public.get_xos_orders_for_host(text, integer)
  to authenticated, service_role, postgres;

create or replace function public.get_xos_order_detail_for_host(
  p_hostname text,
  p_order_number text
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  resolved_tenant_id uuid;
  clean_order_number text := left(trim(coalesce(p_order_number, '')), 80);
  order_row public.orders%rowtype;
  items jsonb;
  result jsonb;
begin
  select tenant_id
  into resolved_tenant_id
  from public.resolve_authenticated_tenant_host(p_hostname, 'xos_admin')
  limit 1;

  if resolved_tenant_id is null then
    raise exception 'XOS access denied.';
  end if;

  if clean_order_number = '' then
    raise exception 'Order number is required.';
  end if;

  select *
  into order_row
  from public.orders o
  where o.order_number = clean_order_number
    and o.tenant_id = resolved_tenant_id
    and coalesce(o.is_archived, false) = false
  limit 1;

  if order_row.order_number is null then
    raise exception 'Order not found.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', left(coalesce(item->>'name', 'Item'), 160),
      'size', nullif(left(coalesce(item->>'size', ''), 40), ''),
      'color', nullif(left(coalesce(item->>'color', ''), 40), ''),
      'quantity', nullif(item->>'quantity', '')::numeric,
      'image_url', coalesce(
        nullif(item->>'image_url', ''),
        (
          select nullif(product.primary_image_url, '')
          from commerce.products product
          where product.id::text = nullif(item->>'commerce_product_id', '')
            and product.tenant_id = resolved_tenant_id
          limit 1
        )
      ),
      'price', coalesce(
        nullif(item->>'price', ''),
        nullif(item->>'unit_price', '')
      )::numeric
    )
    order by ord
  ), '[]'::jsonb)
  into items
  from jsonb_array_elements(
    coalesce(order_row.products, '[]'::jsonb)
  ) with ordinality as t(item, ord);

  result := jsonb_build_object(
    'order_number', order_row.order_number,
    'client_name', left(coalesce(order_row.client_name, 'Client'), 160),
    'status', coalesce(order_row.status, 'confirmed'),
    'stage', left(coalesce(
      order_row.production_detail_stage,
      order_row.pipeline_stage,
      order_row.status,
      'confirmed'
    ), 80),
    'created_at', order_row.created_at,
    'due_date', order_row.due_date,
    'total_amount', order_row.total_amount,
    'fulfillment_type', order_row.fulfillment_type,
    'payment_status', coalesce(order_row.payment_status, 'pending'),
    'tracking_reference',
      nullif(left(coalesce(order_row.tracking_number, ''), 80), ''),
    'items', items
  );

  return result;
end;
$function$;

revoke all on function public.get_xos_order_detail_for_host(text, text) from public;
revoke all on function public.get_xos_order_detail_for_host(text, text) from anon;
grant execute on function public.get_xos_order_detail_for_host(text, text)
  to authenticated, service_role, postgres;
