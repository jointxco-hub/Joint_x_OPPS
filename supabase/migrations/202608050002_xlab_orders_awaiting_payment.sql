-- Staff visibility into X LAB orders sitting in 'pending_payment'.
--
-- Why this exists: OPPS's Orders screen (Orders.jsx) reads dataClient's
-- Order entity, which maps only to public.orders. Orders created by
-- approve_client_quote_request / submit_repeat_order_request live in
-- public.xlab_orders and only reach public.orders once the client pays and
-- sync-to-opps runs. Until then, an approved-but-unpaid order was only ever
-- visible in the moment of approval (the Client Requests dialog) and then
-- disappeared from view. This gives staff a persistent list to follow up on.
--
-- Read-only, tenant-scoped like the rest of the internal client-request RPCs.
-- Does not touch orders.status, PayFast, or sync-to-opps.

create or replace function public.get_client_orders_awaiting_payment(
  p_limit int default 50
)
returns table (
  id uuid,
  order_number text,
  customer_name text,
  customer_email text,
  total_amount numeric,
  created_at timestamptz,
  source_quote_request_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
begin
  if not public.can_manage_internal_client_requests() then
    raise exception 'Not authorised to view client orders.';
  end if;

  return query
  select
    xo.id,
    xo.order_number,
    xo.customer_name,
    xo.customer_email,
    xo.total_amount,
    xo.created_at,
    xo.source_quote_request_id
  from public.xlab_orders xo
  where xo.status = 'pending_payment'
    and xo.tenant_id in (select public.current_user_tenant_ids())
  order by xo.created_at desc
  limit safe_limit;
end;
$$;

grant execute on function public.get_client_orders_awaiting_payment(int) to authenticated;
revoke execute on function public.get_client_orders_awaiting_payment(int) from anon;
