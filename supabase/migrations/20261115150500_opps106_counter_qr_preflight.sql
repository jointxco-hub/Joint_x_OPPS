-- OPPS-106 · read-only counter QR preflight.
-- This checks eligibility for an authenticated Café staff member only.
-- Preflight is NOT permission to charge; issuer must re-lock and re-check.
create or replace function public.qs_opps106_counter_qr_preflight(p_order_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $body$
declare
  v_actor uuid := auth.uid();
  v_order record;
  v_paid numeric;
  v_pending integer;
  v_items integer;
  v_configured integer;
  v_allow_payfast boolean;
  v_min numeric;
  v_total_cents bigint;
  v_paid_cents bigint;
  v_min_cents bigint;
  v_metadata jsonb;
begin
  if v_actor is null or p_order_id is null then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  select so.id, so.tenant_id, so.status, so.payment_status,
         so.total_amount, so.opps_order_id, so.channel,
         so.fulfilment_type, so.source_metadata,
         t.slug, t.status as tenant_status,
         coalesce((t.settings->'qsPayment'->>'payfastMinimumAmount')::numeric,50) as minimum
  into v_order
  from commerce.service_orders so
  join public.tenants t on t.id=so.tenant_id
  where so.id=p_order_id;

  if not found or v_order.slug <> 'quick-solution' or
     v_order.tenant_status <> 'active' or
     not exists (
       select 1 from public.tenant_memberships m
       join public.tenant_capabilities cap on cap.tenant_id=m.tenant_id
       where m.tenant_id=v_order.tenant_id
         and m.auth_user_id=v_actor and m.status='active'
         and m.tenant_role in ('owner','admin','member','counter_staff')
         and cap.capability_key='quick_solution' and cap.enabled=true
     ) then
    return jsonb_build_object('ok',false,'reason','NOT_AUTHORIZED');
  end if;

  select coalesce(sum(p.amount) filter(where p.status='completed'),0),
         count(*) filter(where p.status='pending')::integer
  into v_paid,v_pending
  from commerce.service_order_payments p
  where p.service_order_id=p_order_id and p.tenant_id=v_order.tenant_id;

  select count(*)::integer, count(spc.product_id)::integer,
         coalesce(bool_and(
            coalesce((spc.customer_definition->'paymentEligibility'->>'allowPayfast')::boolean,true)
         ),false)
  into v_items,v_configured,v_allow_payfast
  from commerce.service_order_items soi
  left join commerce.service_product_configs spc
    on spc.tenant_id=soi.tenant_id and spc.product_id=soi.product_id
  where soi.order_id=p_order_id and soi.tenant_id=v_order.tenant_id;

  v_min := v_order.minimum;
  v_metadata := coalesce(v_order.source_metadata,'{}'::jsonb);
  if v_order.total_amount is null or v_paid is null or v_min is null
    or v_order.total_amount < 0 or v_paid < 0 or v_min < 0
    or v_order.total_amount > 100000000
    or v_paid > 100000000 then
    return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');
  end if;
  v_total_cents := round(v_order.total_amount*100);
  v_paid_cents := round(v_paid*100);
  v_min_cents := round(v_min*100);

  if v_order.channel <> 'counter' or v_order.opps_order_id is not null
     or v_order.payment_status not in ('unpaid','pending')
     or v_order.status in ('draft','cancelled','completed')
     or v_total_cents <= 0 or v_paid_cents <> 0
     or v_total_cents < v_min_cents or v_pending <> 0
     or v_items <= 0 or v_items <> v_configured or not v_allow_payfast
     or v_metadata->>'quoteRequired' = 'true'
     or v_metadata#>>'{paymentProjectionReview,required}' = 'true'
     or (v_order.fulfilment_type='delivery'
         and v_metadata->>'deliveryFeeStatus' is distinct from 'confirmed')
  then
    return jsonb_build_object('ok',false,'reason','NOT_PAYABLE');
  end if;

  return jsonb_build_object(
    'ok',true,'targetType','cafe_order','targetId',v_order.id,
    'amountCents',v_total_cents,'currency','ZAR',
    'status','eligible','note','Preflight only; issuer must recheck in a transaction'
  );
end
$body$;
revoke all on function public.qs_opps106_counter_qr_preflight(uuid)
  from public,anon,authenticated;
grant execute on function public.qs_opps106_counter_qr_preflight(uuid) to authenticated;
