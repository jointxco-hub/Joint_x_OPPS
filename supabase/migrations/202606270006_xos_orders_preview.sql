-- Phase 4C: read-only XOS client-facing Orders preview.
-- Host-scoped, membership-gated, and intentionally client-facing only.

create or replace function public.get_xos_orders_for_host(
  p_hostname text,
  p_limit int default 20
)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
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
$$;

revoke execute on function public.get_xos_orders_for_host(text, int) from public, anon;
grant execute on function public.get_xos_orders_for_host(text, int) to authenticated;

do $$
declare
  demo_tenant_id uuid;
begin
  select id into demo_tenant_id
  from public.tenants
  where slug = 'demo-xos';

  if demo_tenant_id is null then
    insert into public.tenants (slug, name, status)
    values ('demo-xos', 'Demo XOS', 'active')
    returning id into demo_tenant_id;
  end if;

  insert into public.tenant_domains (tenant_id, hostname, surface, status, is_primary, verified_at)
  values (demo_tenant_id, 'demo.xos.jointx.co.za', 'xos_admin', 'active', true, now())
  on conflict (hostname, surface) do update
  set tenant_id = excluded.tenant_id,
      status = excluded.status,
      is_primary = excluded.is_primary,
      verified_at = coalesce(public.tenant_domains.verified_at, excluded.verified_at);

  delete from public.orders
  where tenant_id = demo_tenant_id
    and order_number in ('DEMO-XOS-1001', 'DEMO-XOS-1002', 'DEMO-XOS-1003');

  insert into public.orders (
    tenant_id,
    client_name,
    client_email,
    order_number,
    status,
    pipeline_stage,
    production_method,
    production_detail_stage,
    production_client_update,
    products,
    total_amount,
    due_date,
    tracking_number,
    source,
    created_at
  )
  values
    (
      demo_tenant_id,
      'DEMO-XOS Client',
      'demo-xos-client@example.test',
      'DEMO-XOS-1001',
      'confirmed',
      'artwork_check',
      'dtf',
      'artwork_check',
      'Artwork is being checked before production starts.',
      jsonb_build_array(
        jsonb_build_object('name', 'Demo tees', 'quantity', 24),
        jsonb_build_object('name', 'Demo caps', 'quantity', 12)
      ),
      4800,
      current_date + 7,
      'DEMO-XOS-TRACK-1001',
      'opps',
      now() - interval '2 days'
    ),
    (
      demo_tenant_id,
      'DEMO-XOS Client',
      'demo-xos-client@example.test',
      'DEMO-XOS-1002',
      'in_production',
      'pressing',
      'mixed',
      'pressing',
      'Production is underway and the first batch is being pressed.',
      jsonb_build_array(
        jsonb_build_object('name', 'Demo hoodies', 'quantity', 18)
      ),
      7200,
      current_date + 4,
      'DEMO-XOS-TRACK-1002',
      'opps',
      now() - interval '1 day'
    ),
    (
      demo_tenant_id,
      'DEMO-XOS Client',
      'demo-xos-client@example.test',
      'DEMO-XOS-1003',
      'ready',
      'packing',
      'embroidery',
      'packing',
      'Quality check is complete and the order is being packed.',
      jsonb_build_array(
        jsonb_build_object('name', 'Demo embroidered polos', 'quantity', 30),
        jsonb_build_object('name', 'Demo labels', 'quantity', 30)
      ),
      9500,
      current_date + 1,
      'DEMO-XOS-TRACK-1003',
      'opps',
      now() - interval '3 hours'
    );
end;
$$;
