-- HOT FIX C1 — deterministic X LAB mirror-row selection. Fixes a single
-- ambiguous SELECT inside _mirror_opps_order_row(), the internal helper
-- behind trg_orders_mirror_to_xlab_orders (AFTER INSERT OR UPDATE OF
-- status, tracking_number, courier, total_amount, deposit_paid,
-- client_name, client_email, client_phone, order_number, products ON
-- public.orders).
--
-- Root cause (read-only investigation, confirmed against live data on
-- OPPS order b4551439-d32e-4a38-ad8e-d146e8a8717a / XL-261006-3936):
-- when the legacy X LAB bridge later tags its own, already-paid
-- xlab_orders row (089db057-...) with opps_order_id/opps_order_number
-- pointing at the OPPS order it was synced into, that source row and
-- the OPPS-created mirror row (9b0fe181-...) both satisfy this
-- function's lookup predicate. The lookup was `limit 1` with no
-- ORDER BY, so Postgres could return either row with no guarantee -
-- confirmed empirically in a rehearsal, where it selected the PAID
-- SOURCE row and flipped its `status` field as an unrelated side effect
-- of an identity-only edit to orders.products.
--
-- Fix: add a deterministic ORDER BY that prefers the row structurally
-- identifiable as the OPPS-created mirror. A genuine mirror row is born
-- with order_number = opps_order_number (both set to the SAME value,
-- p_order.order_number, by this same function's own INSERT branch,
-- never touched again afterward) - a real X LAB source row's
-- order_number is independently assigned by X LAB's own
-- _generate_xlab_order_number() and will not equal opps_order_number.
-- xlab_orders.order_number is additionally UNIQUE, so this equality can
-- match at most one row. created_at desc is a secondary tie-break only.
--
-- This is the ONLY logical change. Every declaration, branch, the
-- INSERT/ON CONFLICT block, owner, SECURITY DEFINER, search_path, and
-- grants are byte-for-byte/functionally identical to the live function
-- (captured and rehearsed against production, see Hot Fix C1 rehearsal
-- report: original body hash aeab499b1755aad73ad5be16d3c915c6, patched
-- hash 540df270744a8794db440c4bf968323c).
--
-- Does not touch: the JV1 identity repair (separate, not yet applied),
-- any payment/transaction table, pricing/resolver functions, Product
-- Configuration V1.2, or any order data. Single-match and no-match
-- lookup paths are unaffected by construction (ORDER BY only matters
-- when LIMIT 1 has more than one candidate row to choose from).

begin;

create or replace function public._mirror_opps_order_row(p_order orders)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_tenant_id uuid;
  v_customer_email text;
  v_status text;
  v_items jsonb;
  v_linked_id uuid;
  v_subtotal numeric;
  v_line_count integer := 0;
  v_line_total_count integer := 0;
begin
  if p_order.order_number is null then
    return;
  end if;

  select xo.id into v_linked_id
  from public.xlab_orders xo
  where xo.opps_order_id = p_order.id::text
     or xo.opps_order_number = p_order.order_number
  order by
    (xo.order_number is distinct from xo.opps_order_number) asc,
    xo.created_at desc
  limit 1;

  v_status := case
    when p_order.payment_status = 'paid' then public.opps_status_to_xlab_status(p_order.status)
    when p_order.payment_status = 'cancelled' then 'cancelled'
    else 'pending_payment'
  end;

  if jsonb_typeof(p_order.products) = 'array' then
    select
      count(item.value),
      count(public.safe_numeric(item.value->>'line_total')),
      sum(public.safe_numeric(item.value->>'line_total'))
    into v_line_count, v_line_total_count, v_subtotal
    from jsonb_array_elements(p_order.products) item(value);
  end if;

  if v_line_count = 0 or v_line_total_count <> v_line_count then
    v_subtotal := greatest(
      coalesce(p_order.total_amount, 0) - coalesce(p_order.shipping_fee, 0),
      0
    );
  else
    v_subtotal := coalesce(v_subtotal, 0);
  end if;

  if v_linked_id is not null then
    update public.xlab_orders xo
    set status = v_status,
        customer_name = coalesce(p_order.client_name, xo.customer_name),
        customer_email = coalesce(p_order.client_email, xo.customer_email),
        customer_phone = coalesce(p_order.client_phone, xo.customer_phone),
        shipping_address = coalesce(p_order.shipping_address, xo.shipping_address),
        shipping_method = coalesce(p_order.shipping_method, xo.shipping_method),
        subtotal = v_subtotal,
        shipping_fee = coalesce(p_order.shipping_fee, xo.shipping_fee),
        marketing_consent = coalesce(p_order.marketing_consent, xo.marketing_consent),
        tracking_number = coalesce(p_order.tracking_number, xo.tracking_number),
        courier = coalesce(p_order.courier, xo.courier),
        total_amount = coalesce(p_order.total_amount, xo.total_amount),
        amount_paid = coalesce(p_order.deposit_paid, xo.amount_paid),
        deposit_paid = coalesce(p_order.deposit_paid, xo.deposit_paid)
    where xo.id = v_linked_id;
    return;
  end if;

  v_tenant_id := p_order.tenant_id;
  if v_tenant_id is null then
    select t.id into v_tenant_id
    from public.tenants t
    where t.slug = 'joint-x'
    limit 1;
  end if;

  v_customer_email := coalesce(
    nullif(trim(p_order.client_email), ''),
    'order-' || lower(p_order.order_number) || '@no-reply.jointx.co.za'
  );
  v_items := public.opps_products_to_xlab_items(p_order.products, p_order.total_amount);

  insert into public.xlab_orders (
    order_number, customer_email, customer_name, customer_phone,
    shipping_address, shipping_method, subtotal, shipping_fee, marketing_consent,
    items, total_amount, status, tracking_number, courier,
    amount_paid, deposit_paid, tenant_id,
    opps_order_id, opps_order_number, synced_to_opps
  )
  values (
    p_order.order_number,
    v_customer_email,
    p_order.client_name,
    p_order.client_phone,
    p_order.shipping_address,
    coalesce(p_order.shipping_method, ''),
    v_subtotal,
    coalesce(p_order.shipping_fee, 0),
    coalesce(p_order.marketing_consent, false),
    v_items,
    coalesce(p_order.total_amount, 0),
    v_status,
    coalesce(p_order.tracking_number, ''),
    coalesce(p_order.courier, ''),
    coalesce(p_order.deposit_paid, 0),
    coalesce(p_order.deposit_paid, 0),
    v_tenant_id,
    p_order.id::text,
    p_order.order_number,
    true
  )
  on conflict (order_number) do update
  set status = excluded.status,
      customer_name = excluded.customer_name,
      customer_email = excluded.customer_email,
      customer_phone = excluded.customer_phone,
      shipping_address = excluded.shipping_address,
      shipping_method = excluded.shipping_method,
      subtotal = excluded.subtotal,
      shipping_fee = excluded.shipping_fee,
      marketing_consent = excluded.marketing_consent,
      tracking_number = excluded.tracking_number,
      courier = excluded.courier,
      total_amount = excluded.total_amount,
      amount_paid = excluded.amount_paid,
      deposit_paid = excluded.deposit_paid,
      opps_order_id = excluded.opps_order_id,
      opps_order_number = excluded.opps_order_number;
end;
$function$;

-- No revoke/grant statements here deliberately: CREATE OR REPLACE
-- FUNCTION never touches an existing function's ACL (grants persist
-- across replacement by OID) - owner, SECURITY DEFINER, search_path,
-- and the existing {postgres=X/postgres,service_role=X/postgres} ACL
-- are all preserved automatically. Verified, not just assumed, in the
-- post-apply check.

commit;
