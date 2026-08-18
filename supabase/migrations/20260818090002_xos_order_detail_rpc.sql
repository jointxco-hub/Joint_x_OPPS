-- XOS 2.5 - Decision 2: client-safe order detail RPC.
--
-- get_xos_orders_for_host() (unchanged, XOS 1/2) only ever returned
-- item_count. orders.products is the only item-storage mechanism in this
-- schema (no separate line-items table) and its real shape includes
-- operator-only fields (catalog_item_id, inventory_item_id, notes, source,
-- selected_addons, selected_print_options) alongside client-relevant ones
-- (name, size, color, quantity, price, image_url). This RPC returns a new,
-- explicitly allowlisted JSON object per item rather than the raw jsonb -
-- it never passes orders.products through unfiltered.
--
-- Security contract matches every other XOS RPC exactly (get_xos_orders_for_host,
-- get_xos_requests_for_host, get_xos_files_for_host, create_xos_request_for_host):
-- SECURITY DEFINER, fixed search_path, tenant derived from hostname via
-- resolve_authenticated_tenant_host(..., 'xos_admin') (requires auth.uid()
-- and active membership via can_access_tenant()), order ownership checked
-- against the resolved tenant (never a browser-supplied tenant id), EXECUTE
-- granted to authenticated only.

create or replace function public.get_xos_order_detail_for_host(
  p_hostname text,
  p_order_number text
)
returns jsonb
language plpgsql
stable
security definer
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
      'image_url', nullif(item->>'image_url', ''),
      'price', nullif(item->>'price', '')::numeric
    )
    order by ord
  ), '[]'::jsonb)
  into items
  from jsonb_array_elements(coalesce(order_row.products, '[]'::jsonb)) with ordinality as t(item, ord);

  result := jsonb_build_object(
    'order_number', order_row.order_number,
    'client_name', left(coalesce(order_row.client_name, 'Client'), 160),
    'status', coalesce(order_row.status, 'confirmed'),
    'stage', left(coalesce(order_row.production_detail_stage, order_row.pipeline_stage, order_row.status, 'confirmed'), 80),
    'created_at', order_row.created_at,
    'due_date', order_row.due_date,
    'total_amount', order_row.total_amount,
    'tracking_reference', nullif(left(coalesce(order_row.tracking_number, ''), 80), ''),
    'items', items
  );

  return result;
end;
$function$;

grant execute on function public.get_xos_order_detail_for_host(text, text) to authenticated;

-- Explicitly no grant to anon - matches get_xos_orders_for_host,
-- get_xos_requests_for_host, get_xos_files_for_host,
-- create_xos_request_for_host. Verify after applying:
--   select grantee, privilege_type from information_schema.routine_privileges
--   where routine_schema = 'public' and routine_name = 'get_xos_order_detail_for_host';
-- Expected: authenticated, postgres, service_role only.
